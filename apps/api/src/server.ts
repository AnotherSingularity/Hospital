import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { MAX_REQUEST_TEXT_BYTES, ResolveRequestSchema, type ApiError } from '@cadence/domain';
import { InMemoryAuditSink } from '@cadence/audit';
import { InMemoryCatalogRepository, ResolverService, UnknownTenantError } from '@cadence/resolver';

/**
 * Prototype API. NOT HIPAA-ready. Must not process PHI.
 *
 * Authentication here is a development token, deliberately trivial and
 * deliberately not a credential system. Production would require real identity,
 * per-actor authorization, and a customer responsibility matrix that does not
 * exist yet. See docs/threat-model.md.
 */

export const DEV_TOKEN = process.env.CADENCE_DEV_TOKEN ?? 'dev-token-not-a-secret';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 240;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now: number): boolean {
  const bucket = rateBuckets.get(key);
  if (bucket === undefined || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function fail(
  reply: FastifyReply,
  status: number,
  code: ApiError['error']['code'],
  message: string,
  traceId: string,
  details?: Array<{ path: string; message: string }>,
): FastifyReply {
  const body: ApiError = { error: { code, message, traceId, ...(details ? { details } : {}) } };
  return reply.status(status).send(body);
}

export interface BuildOptions {
  audit?: InMemoryAuditSink;
}

export function buildServer(options: BuildOptions = {}): FastifyInstance {
  const audit = options.audit ?? new InMemoryAuditSink();
  const repo = new InMemoryCatalogRepository();
  const service = new ResolverService(repo, audit);

  const app = Fastify({
    // Request bodies are never logged. Only metadata reaches the logger.
    logger: false,
    bodyLimit: MAX_REQUEST_TEXT_BYTES,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  app.decorateRequest('tenantId', '');
  app.decorateRequest('actorId', '');

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header(
      'content-security-policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const traceId = String(request.id);
    if (error.statusCode === 413) {
      return fail(reply, 413, 'payload_too_large', 'Request body is too large.', traceId);
    }
    // Never echo the error message: it can contain the request body.
    return fail(reply, 500, 'internal_error', 'The request could not be processed.', traceId);
  });

  app.setNotFoundHandler((request, reply) =>
    fail(reply, 404, 'invalid_request', 'No such endpoint.', String(request.id)),
  );

  /* --- health ---------------------------------------------------------- */
  app.get('/health/live', async () => ({ status: 'live' }));
  app.get('/health/ready', async () => ({
    status: 'ready',
    dataClassification: 'synthetic-only',
    phiAuthorized: false,
  }));

  /* --- auth + tenant scoping ------------------------------------------- */
  const requireTenant = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const traceId = String(request.id);
    const token = request.headers.authorization;
    if (token !== `Bearer ${DEV_TOKEN}`) {
      await fail(reply, 401, 'unauthorized', 'Missing or invalid development token.', traceId);
      return;
    }
    const tenantHeader = request.headers['x-cadence-tenant'];
    const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      await fail(reply, 400, 'invalid_request', 'x-cadence-tenant header is required.', traceId);
      return;
    }
    if (!repo.knownTenant(tenantId)) {
      audit.emit({
        schemaVersion: '1.0.0',
        channel: 'security',
        eventType: 'tenant.denied',
        tenantId,
        actorId: 'anonymous',
        traceId,
        occurredAt: new Date().toISOString(),
        inputFieldNames: [],
        resultState: null,
        candidateIds: [],
        ruleIds: [],
        ruleSetVersion: null,
        latencyMs: null,
        outcome: 'error',
        errorCode: 'unknown_tenant',
      });
      await fail(reply, 404, 'unknown_tenant', 'Unknown tenant.', traceId);
      return;
    }
    if (rateLimited(`${tenantId}:${request.ip}`, Date.now())) {
      await fail(reply, 429, 'rate_limited', 'Too many requests.', traceId);
      return;
    }
    (request as FastifyRequest & { tenantId: string }).tenantId = tenantId;
    (request as FastifyRequest & { actorId: string }).actorId =
      typeof request.headers['x-cadence-actor'] === 'string'
        ? request.headers['x-cadence-actor']
        : 'dev-operator';
  };

  /* --- resolver -------------------------------------------------------- */
  app.post('/v1/resolve', { preHandler: requireTenant }, async (request, reply) => {
    const traceId = String(request.id);
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const actorId = (request as FastifyRequest & { actorId: string }).actorId;

    const parsed = ResolveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(
        reply,
        400,
        'invalid_request',
        'Request body did not match the expected schema.',
        traceId,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    try {
      const { result } = service.resolve({
        tenantId,
        actorId,
        traceId,
        text: parsed.data.text,
        hints: parsed.data.hints,
      });
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof UnknownTenantError) {
        return fail(reply, 404, 'unknown_tenant', 'Unknown tenant.', traceId);
      }
      throw error;
    }
  });

  /* --- read-only catalog and rule set ---------------------------------- */
  app.get('/v1/visit-types', { preHandler: requireTenant }, async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const visitTypes = repo.listVisitTypes(tenantId).filter((v) => v.active);
    return reply.status(200).send({ tenantId, count: visitTypes.length, visitTypes });
  });

  app.get('/v1/rule-sets/active', { preHandler: requireTenant }, async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;
    const ruleSet = repo.activeRuleSet(tenantId);
    return reply.status(200).send(ruleSet);
  });

  /* No mutation endpoints exist. There is no booking, hold, cancel, or
     write-back route in this prototype, by design. */

  return app;
}
