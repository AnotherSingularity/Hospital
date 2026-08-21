# Threat model

Synthetic proof of concept. **Not HIPAA-ready. Must not process PHI.**

Method: assets, actors, trust boundaries, then threats by class with mitigations
and residual risk. Threat classes follow the set required by the audit:
spoofing, tenant-boundary failure, malicious rule content, prompt injection,
audit leakage, stale configuration, unauthorized publication, and denial of
service.

## 1. Assets

| Asset                         | Why it matters                                                                           | Current classification   |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| Configured rule corpus        | The organization's operational and safety policy. Its integrity is the product.          | Synthetic                |
| Visit-type catalog            | Determines what can be scheduled. Leaks reveal service lines and capacity.               | Synthetic                |
| Governance metadata           | Approver identity, effective windows, source references. Forgery defeats accountability. | Synthetic                |
| Audit records                 | Evidence of what the system did.                                                         | Synthetic, metadata only |
| Request text                  | In production would contain PHI. **Prohibited here.**                                    | Prohibited               |
| Availability and appointments | **Not present.** No integration exists.                                                  | N/A                      |

## 2. Actors

**Legitimate:** the scheduler operating the workbench; the rule author; the
clinical approver; the platform operator.

**Adversarial:** an external unauthenticated attacker; an authenticated user of
tenant A seeking tenant B's configuration; a malicious or careless rule author; a
caller supplying crafted request text; a compromised dependency; an insider with
production access.

## 3. Trust boundaries

```text
 [browser]  ──1──►  [API]  ──2──►  [resolver service]  ──3──►  [repository]
                      │                    │
                      └──4──► [audit sink] │
                                           └──5──► [rule corpus / catalog]
```

1. **Browser to API.** Fully untrusted. Zod-validated, size-limited,
   token-checked, tenant-scoped, rate-limited.
2. **API to service.** Tenant identity is mandatory and explicit.
3. **Service to repository.** Every method takes a tenant argument.
4. **Service to audit.** Allowlist-only construction; fail-closed scanning.
5. **Corpus to engine.** Rules are validated data. A rule is never executed.

## 4. Threats

### T-01 Spoofing — impersonating a legitimate actor

**Vector.** Forged or replayed token; forged actor header; forged tenant header.

**Mitigations.** Bearer token required on every non-health endpoint. Unknown
tenants are rejected and recorded on the security channel. No credentials are
stored in the repository; the secret scanner runs in CI.

**Residual risk — significant, and acknowledged.** The development token is a
shared static string and is not authentication. There is no user identity, no
session management, no expiry, no rotation, no MFA, and no per-actor
authorization. The actor header is self-asserted, so audit attribution is
unreliable. **The tenant header is trusted after the token check; in production
tenant must derive from the authenticated principal.** This is the weakest area
of the prototype and is acceptable only because the data is synthetic.

### T-02 Tenant-boundary failure

**Vector.** Requesting another tenant's catalog or rules; naming a foreign
identifier in request text; a query missing its tenant predicate.

**Mitigations.** Defence in depth, five layers:

1. No repository method exists without a tenant argument.
2. Rows are re-filtered on their own `tenantId` after lookup.
3. A rule set whose `tenantId` differs from the request is refused.
4. The service verifies at its **exit boundary** that no emitted identifier lies
   outside the tenant catalog, and throws if one does.
5. `db/schema.sql` adds fail-closed row-level security — if `app.tenant_id` is
   unset, no row matches — explicitly as a backstop behind an application-layer
   predicate, not as a substitute for one.

Negative tests exist at engine, service, API, and browser layers. Cross-tenant
count is a CI-blocking gate.

**Residual risk.** Caches, queues, object storage, metrics, exports, and backups
do not exist yet; each will need its own tenant namespacing when it does. Shared
cache keys without a tenant namespace are prohibited by design.

### T-03 Malicious rule content

**Vector.** A rule author submits content designed to execute code, exhaust
resources, address unintended data, or quietly weaken a safety control.

**Mitigations.** Rules are validated JSON, never executable code. Operators and
field paths are allowlisted. Nesting is capped at depth 6 and 128 nodes; arrays
are bounded; strings are length-limited. Unknown operators evaluate to `false`.
Duplicate ids, rule-set id mismatches, self-supersession, and supersession cycles
are rejected. Safety rules may not use `allow_candidate`. A safety rule requires a
clinical approver distinct from the author. Six deliberately invalid rule sets
are tested as rejected.

**Residual risk.** A syntactically valid rule expressing bad policy is
indistinguishable from a good one to the engine. Only clinical governance catches
that. There is no rule-level test-case requirement before publication.

### T-04 Prompt and instruction injection

**Vector.** Request text carrying instructions, fabricated identifiers, JSON
payloads, script tags, SQL fragments, path traversal, or Unicode obfuscation.

**Mitigations.** **Structural, not heuristic.** There is no instruction-following
component to hijack. Text is lexicon-matched into a validated schema; identifiers
are catalog objects; escalation messages come only from configured rules. Unicode
is normalized NFKD, combining marks stripped, invisible and control characters
removed. Output is escaped by React; the API sets a strict CSP, `nosniff`, and
`DENY` framing. Twelve injection fixtures pass, and an E2E test asserts a
fabricated identifier never reaches the DOM.

**Residual risk.** This mitigation is a property of not having a model. Enabling
the model adapter reintroduces the entire threat class and invalidates the safety
case.

### T-05 Audit leakage

**Vector.** PHI or secrets reaching audit records, application logs, or error
responses.

**Mitigations.** Audit events are built from an allowlist; no field can carry
free text. A deep scanner throws on any forbidden key. The schema is strict, so
unknown keys are rejected. Request bodies and authorization headers are never
logged. Error handlers never echo the body — validation errors return field paths
and messages only, and unexpected errors return a generic message with a trace
id. Workflow and security events are separate channels. Audit rows are
append-only in the schema.

**Residual risk.** The scanner matches known key names and shapes. A novel field
name carrying sensitive content would pass. Retention, access review, integrity
protection, export, and legal-hold procedures are undefined.

### T-06 Stale configuration

**Vector.** A retired, expired, or superseded rule set or visit type is applied.

**Mitigations.** Rule sets are usable only when `approved` and inside their
effective window; expiry throws rather than degrading. Review dates must follow
effective dates. Inactive entries are never proposed and are omitted from the
published catalog. No caching exists in MVP0. Every result carries the rule-set
version, and audit records it.

**Residual risk.** Nothing forces a review to occur at the review date. When
caching is added it will need short TTLs, tenant-scoped keys, source timestamps,
and mandatory revalidation.

### T-07 Unauthorized publication

**Vector.** A rule reaching production without required approval; a safety rule
self-approved; approval metadata forged.

**Mitigations.** Status, approver, author, clinical approver, effective and review
dates, and source reference are all required by schema. Safety-tagged rules
require a clinical approver distinct from the author — enforced in code and
mirrored as a database constraint. Only `approved` sets are usable.

**Residual risk — significant.** There is **no authoring interface, no approval
workflow, no cryptographic signing, and no immutable publication log.** Approval
metadata is self-asserted text. A production system needs signed, logged
publication with rollback. MVP1's read-only authoring and review workflow is the
next step.

### T-08 Denial of service

**Vector.** Oversized bodies; high request volume; deeply nested rules; expensive
retrieval.

**Mitigations.** Body limit 4 KB at transport, 2000 characters at schema.
In-process rate limiting, 240 requests per minute per tenant and IP. Rule depth
and node caps. Retrieval is a bounded linear scan over a bounded catalog.
Measured p95 is 5.64 ms.

**Residual risk.** Rate limiting is per-process and resets on restart, so it is
ineffective across instances. No global quota, request timeout, circuit breaker,
or backpressure. No load testing at realistic catalog sizes.

### T-09 Supply chain

**Vector.** A compromised or malicious dependency.

**Mitigations.** Dependencies are pinned through the lockfile; CI uses `npm ci`,
which fails on drift. `npm audit` at high severity and a secret scan run in CI.
The dependency surface is deliberately small, and the resolver core makes no
network calls at all.

**Residual risk.** No SBOM, no provenance attestation, no pinning by digest, no
automated update review.

### T-10 Insider access to production

Out of scope for a synthetic prototype and listed so it is not forgotten.
Production access governance, break-glass procedures, access review, and
separation of duties are all undefined and are prerequisites to handling PHI.

## 5. Summary of the largest residual risks

1. **Authentication is a placeholder** (T-01). No identity, no authorization, and
   a self-asserted tenant header.
2. **No publication workflow** (T-07). Approval metadata is unverified text.
3. **Rule-corpus correctness is unverifiable by the system** (T-03). The engine
   faithfully executes a wrong rule.
4. **Enabling any model adapter reintroduces T-04 entirely** and invalidates the
   safety case.
5. **Operational security is undefined** (T-05, T-08, T-09, T-10): retention,
   incident response, disaster recovery, subprocessors, access review.

None of these are blockers for a synthetic prototype. All are blockers for PHI.
