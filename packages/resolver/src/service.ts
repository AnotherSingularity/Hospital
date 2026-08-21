import type { ResolutionResult, RuleSet, SchedulingIntent, VisitType } from '@cadence/domain';
import {
  InMemoryAuditSink,
  buildResolveCompletedEvent,
  buildSecurityEvent,
  type AuditSink,
} from '@cadence/audit';
import { CATALOGS, RULE_SETS, TENANTS } from '@cadence/fixtures';
import { resolve, type ResolverConfig } from './resolve.js';

/**
 * Tenant scope is mandatory on every repository method. There is no method that
 * reads a catalog or rule set without a tenant argument, so a cross-tenant read
 * cannot be expressed in the type system, let alone executed.
 */

export class UnknownTenantError extends Error {
  constructor(tenantId: string) {
    super(`unknown tenant: ${tenantId}`);
    this.name = 'UnknownTenantError';
  }
}

export interface CatalogRepository {
  listVisitTypes(tenantId: string): readonly VisitType[];
  activeRuleSet(tenantId: string): RuleSet;
  knownTenant(tenantId: string): boolean;
}

/**
 * In-memory implementation for MVP0. A PostgreSQL implementation of this same
 * interface is sketched in db/schema.sql; it must apply the identical tenant
 * predicate at the query layer, not only in row-level security.
 */
export class InMemoryCatalogRepository implements CatalogRepository {
  knownTenant(tenantId: string): boolean {
    return TENANTS.some((t) => t.id === tenantId);
  }

  listVisitTypes(tenantId: string): readonly VisitType[] {
    if (!this.knownTenant(tenantId)) throw new UnknownTenantError(tenantId);
    const catalog = CATALOGS[tenantId] ?? [];
    // Belt and braces: filter again on the row's own tenantId.
    return catalog.filter((v) => v.tenantId === tenantId);
  }

  activeRuleSet(tenantId: string): RuleSet {
    if (!this.knownTenant(tenantId)) throw new UnknownTenantError(tenantId);
    const ruleSet = RULE_SETS[tenantId];
    if (ruleSet === undefined) throw new UnknownTenantError(tenantId);
    if (ruleSet.tenantId !== tenantId) throw new UnknownTenantError(tenantId);
    return ruleSet;
  }
}

export interface ResolveCommand {
  tenantId: string;
  actorId: string;
  traceId: string;
  text: string;
  hints?: Partial<SchedulingIntent>;
}

export interface ResolveOutcome {
  result: ResolutionResult;
  latencyMs: number;
}

export class ResolverService {
  constructor(
    private readonly repo: CatalogRepository = new InMemoryCatalogRepository(),
    private readonly audit: AuditSink = new InMemoryAuditSink(),
    private readonly config: Partial<ResolverConfig> = {},
    private readonly clock: () => Date = () => new Date(),
  ) {}

  resolve(command: ResolveCommand): ResolveOutcome {
    const startedAt = performance.now();

    if (!this.repo.knownTenant(command.tenantId)) {
      this.audit.emit(
        buildSecurityEvent({
          eventType: 'tenant.denied',
          tenantId: command.tenantId,
          actorId: command.actorId,
          traceId: command.traceId,
          occurredAt: this.clock().toISOString(),
          errorCode: 'unknown_tenant',
        }),
      );
      throw new UnknownTenantError(command.tenantId);
    }

    const catalog = this.repo.listVisitTypes(command.tenantId);
    const ruleSet = this.repo.activeRuleSet(command.tenantId);

    const result = resolve(
      {
        text: command.text,
        hints: command.hints,
        catalog,
        ruleSet,
        tenantId: command.tenantId,
      },
      { traceId: command.traceId, config: this.config, now: this.clock },
    );

    // Invariant enforced at the exit boundary, not only at construction:
    // no identifier may leave the service that is not in this tenant's catalog.
    const permitted = new Set(catalog.map((v) => v.id));
    for (const candidate of result.candidates) {
      if (!permitted.has(candidate.visitTypeId)) {
        throw new Error(
          `resolver produced identifier ${candidate.visitTypeId} outside tenant ${command.tenantId} catalog`,
        );
      }
    }

    const latencyMs = performance.now() - startedAt;

    this.audit.emit(
      buildResolveCompletedEvent({
        tenantId: command.tenantId,
        actorId: command.actorId,
        traceId: command.traceId,
        occurredAt: this.clock().toISOString(),
        // Field NAMES only. The values never reach the audit record.
        inputFieldNames: Object.entries(result.intent)
          .filter(([, v]) => v !== undefined && (!Array.isArray(v) || v.length > 0))
          .map(([k]) => k),
        latencyMs,
        result,
      }),
    );

    return { result, latencyMs };
  }
}
