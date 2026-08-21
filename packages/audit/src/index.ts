import { z } from 'zod';
import type { ResolutionResult, ResolutionState } from '@cadence/domain';

/**
 * Audit events (P1.3).
 *
 * The event is built from an explicit allowlist. Raw free text, names, dates of
 * birth, MRNs, audio, transcripts, prompts, and secrets are structurally excluded:
 * there is no field on the schema that could carry them, and `assertNoForbiddenContent`
 * fails closed if a caller smuggles one in via a widened type.
 *
 * Security audit data is emitted on a separate channel from workflow data so the two
 * can carry different retention, access, and legal-hold rules. See docs/data-governance.md.
 */

export const FORBIDDEN_AUDIT_KEYS = [
  'text',
  'rawText',
  'procedureText',
  'input',
  'prompt',
  'transcript',
  'audio',
  'name',
  'patientName',
  'firstName',
  'lastName',
  'dob',
  'dateOfBirth',
  'mrn',
  'ssn',
  'phone',
  'email',
  'address',
  'authorization',
  'token',
  'secret',
  'password',
  'apiKey',
] as const;

export const AuditChannelSchema = z.enum(['workflow', 'security']);
export type AuditChannel = z.infer<typeof AuditChannelSchema>;

export const AuditEventSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    channel: AuditChannelSchema,
    eventType: z.enum([
      'resolve.requested',
      'resolve.completed',
      'resolve.rejected',
      'tenant.denied',
      'ruleset.read',
      'catalog.read',
    ]),
    tenantId: z.string(),
    actorId: z.string(),
    traceId: z.string(),
    occurredAt: z.string().datetime(),
    /** Field NAMES only from the input schema. Never field values. */
    inputFieldNames: z.array(z.string()).default([]),
    resultState: z.string().nullable().default(null),
    candidateIds: z.array(z.string()).default([]),
    ruleIds: z.array(z.string()).default([]),
    ruleSetVersion: z.number().int().nullable().default(null),
    latencyMs: z.number().nonnegative().nullable().default(null),
    outcome: z.enum(['ok', 'error']).default('ok'),
    errorCode: z.string().nullable().default(null),
  })
  .strict();

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export class AuditRedactionError extends Error {
  constructor(key: string) {
    super(`audit event contains forbidden key "${key}"`);
    this.name = 'AuditRedactionError';
  }
}

const FORBIDDEN = new Set<string>(FORBIDDEN_AUDIT_KEYS.map((k) => k.toLowerCase()));

/** Deep scan. Throws rather than silently dropping, so a leak fails the build. */
export function assertNoForbiddenContent(value: unknown, path = 'event'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenContent(v, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key.toLowerCase())) throw new AuditRedactionError(`${path}.${key}`);
    assertNoForbiddenContent(child, `${path}.${key}`);
  }
}

export interface AuditSink {
  emit(event: AuditEvent): void;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  emit(event: AuditEvent): void {
    const parsed = AuditEventSchema.parse(event);
    assertNoForbiddenContent(parsed);
    this.events.push(parsed);
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }

  byChannel(channel: AuditChannel): readonly AuditEvent[] {
    return this.events.filter((e) => e.channel === channel);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export interface ResolveAuditInput {
  tenantId: string;
  actorId: string;
  traceId: string;
  occurredAt: string;
  inputFieldNames: string[];
  latencyMs: number;
  result: ResolutionResult;
}

/** Builds a completed-resolution event from an allowlist. The result object is never spread. */
export function buildResolveCompletedEvent(input: ResolveAuditInput): AuditEvent {
  const event: AuditEvent = {
    schemaVersion: '1.0.0',
    channel: 'workflow',
    eventType: 'resolve.completed',
    tenantId: input.tenantId,
    actorId: input.actorId,
    traceId: input.traceId,
    occurredAt: input.occurredAt,
    inputFieldNames: [...input.inputFieldNames].sort(),
    resultState: input.result.state satisfies ResolutionState,
    candidateIds: input.result.candidates.map((c) => c.visitTypeId),
    ruleIds: [
      ...new Set([
        ...input.result.evidence.map((e) => e.ruleId),
        ...input.result.missingFields.map((m) => m.ruleId),
      ]),
    ].sort(),
    ruleSetVersion: input.result.ruleSetVersion,
    latencyMs: input.latencyMs,
    outcome: 'ok',
    errorCode: null,
  };
  assertNoForbiddenContent(event);
  return AuditEventSchema.parse(event);
}

export function buildSecurityEvent(params: {
  eventType: 'tenant.denied' | 'resolve.rejected';
  tenantId: string;
  actorId: string;
  traceId: string;
  occurredAt: string;
  errorCode: string;
}): AuditEvent {
  const event: AuditEvent = {
    schemaVersion: '1.0.0',
    channel: 'security',
    eventType: params.eventType,
    tenantId: params.tenantId,
    actorId: params.actorId,
    traceId: params.traceId,
    occurredAt: params.occurredAt,
    inputFieldNames: [],
    resultState: null,
    candidateIds: [],
    ruleIds: [],
    ruleSetVersion: null,
    latencyMs: null,
    outcome: 'error',
    errorCode: params.errorCode,
  };
  assertNoForbiddenContent(event);
  return AuditEventSchema.parse(event);
}
