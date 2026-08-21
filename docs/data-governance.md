# Data governance

**This prototype is not HIPAA-ready and is not authorized to process PHI.**

## 1. Classification

Every byte of data in this repository is **synthetic and fictional**. The
organizations, catalog entries, codes, aliases, departments, capabilities, device
flags, rules, approver names, and request strings were all invented for this
proof of concept. None derives from any real health system's configuration, any
employer materials, any call transcript, or any licensed code set.

## 2. Prohibited data

Do not introduce any of the following into this repository, its database, its
logs, or its runtime — including in a screenshot, a test fixture, a bug report,
or a commit message.

### Prohibited absolutely

| Category                         | Examples                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected health information     | Names, dates of birth, MRNs, account numbers, addresses, phone numbers, email addresses, insurance identifiers, any of the 18 HIPAA identifiers |
| Clinical content                 | Diagnoses, orders, notes, results, medication lists                                                                                             |
| Call audio or transcripts        | Recordings, transcriptions, summaries, or derived text                                                                                          |
| Production credentials           | API keys, tokens, passwords, connection strings, certificates                                                                                   |
| Employer proprietary material    | Real visit-type tables, scheduling protocols, department configuration, internal documentation, screenshots of a production system              |
| Licensed code sets               | CPT, HCPCS, or any content not expressly licensed or supplied under an authorized agreement                                                     |
| Real payer or clearinghouse data | Eligibility responses, authorization records, remittance data                                                                                   |

### A note on the employer question

Anyone with access to a health system's scheduling configuration through their
employment **must not** contribute that configuration, or anything derived from
it, to this project. That includes visit-type tables, protocol documents,
screenshots, and paraphrases assembled from memory. Domain knowledge about how
scheduling _works in general_ is a person's own; a specific employer's
configuration is the employer's, and using it can breach confidentiality
obligations, employment agreements, and trade-secret protections regardless of
intent. A real corpus enters this system one way only: under a contract with the
organization that owns it.

## 3. Data currently held

| Store                 | Contents                                             | Lifetime           |
| --------------------- | ---------------------------------------------------- | ------------------ |
| `packages/fixtures`   | Fictional catalog, rule sets, labelled cases         | Source-controlled  |
| In-memory repository  | The above, loaded at start                           | Process lifetime   |
| In-memory audit sink  | Metadata-only events                                 | Process lifetime   |
| `.eval-out/`          | Evaluation report, aggregate metrics and fixture ids | Git-ignored, local |
| PostgreSQL (optional) | Schema only; the prototype does not use it           | Local container    |

There is deliberately **no patient entity** in the domain model, **no patient or
appointment table** in the schema, **no free-text column** in audit storage, and
**no audio path** anywhere in the tree. These are absences by design, not gaps
awaiting implementation.

## 4. Audit fields

### Permitted

Tenant id, actor id, trace id, timestamp, **input schema field names**, result
state, candidate ids, rule ids and versions, rule-set version, latency, outcome,
error code.

### Forbidden

Raw free text, request bodies, prompts, transcripts, audio, names, dates of
birth, MRNs, SSNs, phone numbers, email addresses, addresses, authorization
headers, tokens, secrets, passwords, API keys.

### How this is enforced

Not by convention. By construction:

1. The event schema is `.strict()` — no field exists that could carry free text,
   and unknown keys are rejected outright.
2. Events are built from an explicit allowlist. The result object is never
   spread into an event.
3. `assertNoForbiddenContent` deep-scans every event and **throws** on a
   forbidden key rather than silently dropping it, so a leak fails the build
   rather than passing quietly.
4. `InMemoryAuditSink.emit` validates and scans before storing; a rejected event
   is not stored at all.
5. Tests assert that raw request text does not appear in serialized output, and
   that every forbidden key name throws.
6. Fastify logging is disabled; request bodies and authorization headers are
   never logged. Error handlers never echo the body.

### Channels

**Workflow** and **security** events are separate channels so they can carry
different retention, access, integrity, and legal-hold rules. Security events —
unknown tenant, rejected request — record no result content at all.

## 5. Retention assumptions

These are **assumptions to be replaced by policy**, not policy.

| Data                        | Assumption                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Workflow audit              | Retained for operational review; production retention set by customer policy and counsel                               |
| Security audit              | Retained longer than workflow audit; integrity-protected                                                               |
| Evaluation output           | Ephemeral, regenerate on demand                                                                                        |
| Request text                | **Never persisted.** Held only in memory for the duration of one request                                               |
| Availability / patient data | **Not cached.** Caching was rejected for MVP0: stale availability and cache-key leakage are hazards in their own right |

Undefined and required before production: retention periods, deletion procedures,
export format, legal-hold handling, backup retention, and audit integrity
protection.

## 6. Data flow

```text
scheduler types request
  └─► browser (in memory, not stored)
        └─► POST /v1/resolve (TLS in production; not stored, not logged)
              └─► parsed into SchedulingIntent (in memory)
                    ├─► matched against tenant catalog + rules (read-only)
                    ├─► result returned to browser (no-store)
                    └─► audit event: FIELD NAMES ONLY, never values
```

Nothing leaves the process. No outbound network call exists in the resolver path.

## 7. Multi-tenancy

Tenant scope is mandatory at every layer that currently exists: authentication
check, repository method signature, row re-filtering, rule-set tenant match,
service exit-boundary verification, and fail-closed row-level security in the
schema.

Layers that do not yet exist — cache, object storage, queues, metrics, exports,
backups — each require their own tenant namespacing when added. **Shared cache
keys without a tenant namespace are prohibited.**

## 8. Prerequisites before any real data

Each is substantive work, not a checkbox:

1. Counsel-led covered-entity and business-associate analysis
2. A signed BAA where applicable
3. A security risk analysis under the HIPAA Security Rule — a control list is not
   a compliance determination
4. Completed threat model with mitigations implemented, particularly real
   authentication and authorization
5. Data-flow inventory and control matrix
6. Customer responsibility matrix
7. Incident response and breach notification plans
8. Disaster recovery, with tested backup and restore
9. Retention, deletion, and legal-hold design
10. Subprocessor inventory and vendor controls
11. Production access governance, access review, separation of duties
12. Clinical governance body owning the rule corpus, with emergency rollback
13. Per-EHR capability matrix and adapter contract before any integration claim
14. Insurance review

## 9. Data portability

Rules are exportable in the documented JSON format. This is deliberate.

Retention earned through data captivity was explicitly rejected: a customer who
cannot leave has no way to signal that the product stopped being worth keeping,
and a vendor who relies on that signal being unavailable stops hearing it.
Compete on governance, workflow quality, measurement, and integration instead.
