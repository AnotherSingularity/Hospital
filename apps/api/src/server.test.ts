import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { InMemoryAuditSink } from '@cadence/audit';
import { DEV_TOKEN, buildServer } from './server.js';

let app: FastifyInstance;
let audit: InMemoryAuditSink;

const auth = (tenant = 'meridian-imaging') => ({
  authorization: `Bearer ${DEV_TOKEN}`,
  'x-cadence-tenant': tenant,
});

beforeAll(async () => {
  audit = new InMemoryAuditSink();
  app = buildServer({ audit });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('9. API validation, size limits, and structured errors', () => {
  it('serves liveness and readiness without auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.json()).toMatchObject({
      phiAuthorized: false,
      dataClassification: 'synthetic-only',
    });
  });

  it('rejects a missing development token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: { 'x-cadence-tenant': 'meridian-imaging' },
      payload: { text: 'chest xray' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('rejects a missing tenant header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      payload: { text: 'chest xray' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('rejects an unknown tenant and records a security event', async () => {
    const before = audit.byChannel('security').length;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth('ghost-tenant'),
      payload: { text: 'chest xray' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('unknown_tenant');
    expect(audit.byChannel('security').length).toBe(before + 1);
  });

  it('returns structured validation errors without echoing the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('invalid_request');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.traceId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('"text":"');
  });

  it('enforces the schema length limit on text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: 'a'.repeat(2500) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('enforces the transport body limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: 'x'.repeat(64 * 1024) },
    });
    expect([400, 413]).toContain(res.statusCode);
    expect(['payload_too_large', 'invalid_request']).toContain(res.json().error.code);
  });

  it('returns a structured 404 for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('resolves a well-formed request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: 'chest xray' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('resolved');
    expect(body.candidates[0].visitTypeId).toBe('VT-XR-CHEST-2V');
    expect(body.traceId).toBeTruthy();
  });

  it('accepts operator-supplied hints to answer a missing-information prompt', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: 'knee xray' },
    });
    expect(first.json().state).toBe('needs_information');

    const second = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: 'knee xray', hints: { laterality: 'left' } },
    });
    expect(second.json().state).toBe('resolved');
  });

  it('sets no-store and hardened security headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: 'chest xray' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
  });

  it('exposes no mutation endpoints', async () => {
    for (const url of ['/v1/appointments', '/v1/book', '/v1/resolve/confirm']) {
      const res = await app.inject({ method: 'POST', url, headers: auth(), payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('7. cross-tenant reads fail closed at the API layer', () => {
  it('returns only the requesting tenant catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/visit-types', headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(
      body.visitTypes.every((v: { tenantId: string }) => v.tenantId === 'meridian-imaging'),
    ).toBe(true);
    expect(body.visitTypes.some((v: { id: string }) => v.id.startsWith('VT-NG-'))).toBe(false);
  });

  it('returns only the requesting tenant rule set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/rule-sets/active',
      headers: auth('northgate-ortho'),
    });
    expect(res.json().tenantId).toBe('northgate-ortho');
    expect(res.json().id).toBe('RS-NORTHGATE-ORTHO');
  });

  it('does not leak a foreign identifier named in the request text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      headers: auth(),
      payload: { text: 'VT-NG-XR-KNEE-4V knee xray left' },
    });
    const ids = res.json().candidates.map((c: { visitTypeId: string }) => c.visitTypeId);
    expect(ids).not.toContain('VT-NG-XR-KNEE-4V');
  });

  it('omits retired entries from the published catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/visit-types', headers: auth() });
    expect(res.json().visitTypes.some((v: { id: string }) => v.id === 'VT-XR-WRIST-RETIRED')).toBe(
      false,
    );
  });
});
