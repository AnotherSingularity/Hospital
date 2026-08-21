import { describe, expect, it } from 'vitest';
import {
  AuditEventSchema,
  AuditRedactionError,
  FORBIDDEN_AUDIT_KEYS,
  InMemoryAuditSink,
  assertNoForbiddenContent,
  buildResolveCompletedEvent,
  buildSecurityEvent,
} from './index.js';

const baseResult = {
  state: 'resolved' as const,
  candidates: [
    {
      visitTypeId: 'VT-XR-CHEST-2V',
      code: 'XR401',
      displayName: 'X-Ray Chest 2 View',
      durationMinutes: 10,
      score: 60,
      components: [],
      instructions: [],
    },
  ],
  missingFields: [],
  evidence: [
    { ruleId: 'R-ALLOW-001', ruleSetVersion: 4, sourceRef: 'ref', explanation: 'in scope' },
  ],
  traceId: 'trace-1',
  intent: {
    procedureText: 'chest xray for Jane Q. Patient dob 1980-01-01 mrn 12345',
    deviceFlags: [],
  },
  parseEvidence: [],
  confidenceBand: 'high' as const,
  separationMargin: 30,
  ruleSetVersion: 4,
  schemaVersion: '1.0.0',
};

describe('8. audit serialization excludes forbidden content', () => {
  it('never copies the raw request text into the event', () => {
    const event = buildResolveCompletedEvent({
      tenantId: 'meridian-imaging',
      actorId: 'op-1',
      traceId: 'trace-1',
      occurredAt: new Date().toISOString(),
      inputFieldNames: ['procedureText', 'deviceFlags'],
      latencyMs: 3,
      result: baseResult,
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('Jane');
    expect(serialized).not.toContain('1980-01-01');
    expect(serialized).not.toContain('12345');
    expect(serialized).not.toContain('chest xray');
  });

  it('keeps only field names, ids, versions, and timings', () => {
    const event = buildResolveCompletedEvent({
      tenantId: 'meridian-imaging',
      actorId: 'op-1',
      traceId: 'trace-1',
      occurredAt: new Date().toISOString(),
      inputFieldNames: ['procedureText'],
      latencyMs: 3,
      result: baseResult,
    });
    expect(event.candidateIds).toEqual(['VT-XR-CHEST-2V']);
    expect(event.ruleIds).toEqual(['R-ALLOW-001']);
    expect(event.inputFieldNames).toEqual(['procedureText']);
    expect(event.resultState).toBe('resolved');
  });

  it('throws on every forbidden key rather than silently dropping it', () => {
    for (const key of FORBIDDEN_AUDIT_KEYS) {
      expect(() => assertNoForbiddenContent({ [key]: 'value' })).toThrow(AuditRedactionError);
    }
  });

  it('detects a forbidden key nested inside the event', () => {
    expect(() =>
      assertNoForbiddenContent({ meta: { nested: [{ transcript: 'call audio text' }] } }),
    ).toThrow(AuditRedactionError);
  });

  it('rejects unknown top-level keys via the strict schema', () => {
    expect(() =>
      AuditEventSchema.parse({
        schemaVersion: '1.0.0',
        channel: 'workflow',
        eventType: 'resolve.completed',
        tenantId: 't',
        actorId: 'a',
        traceId: 'tr',
        occurredAt: new Date().toISOString(),
        rawText: 'should not be allowed',
      }),
    ).toThrow();
  });

  it('separates security events from workflow events', () => {
    const sink = new InMemoryAuditSink();
    sink.emit(
      buildSecurityEvent({
        eventType: 'tenant.denied',
        tenantId: 'ghost',
        actorId: 'anonymous',
        traceId: 'tr-9',
        occurredAt: new Date().toISOString(),
        errorCode: 'unknown_tenant',
      }),
    );
    expect(sink.byChannel('security')).toHaveLength(1);
    expect(sink.byChannel('workflow')).toHaveLength(0);
  });

  it('refuses to store an event that carries forbidden content', () => {
    const sink = new InMemoryAuditSink();
    const rogue = {
      schemaVersion: '1.0.0',
      channel: 'workflow',
      eventType: 'resolve.completed',
      tenantId: 't',
      actorId: 'a',
      traceId: 'tr',
      occurredAt: new Date().toISOString(),
      inputFieldNames: [],
      resultState: null,
      candidateIds: [],
      ruleIds: [],
      ruleSetVersion: null,
      latencyMs: null,
      outcome: 'ok',
      errorCode: null,
      mrn: '000111222',
    } as unknown as Parameters<InMemoryAuditSink['emit']>[0];
    expect(() => sink.emit(rogue)).toThrow();
    expect(sink.all()).toHaveLength(0);
  });
});
