# Cadence Overlay Resolver

A constrained, read-only resolver that maps a written scheduling request to a
finite, locally configured visit-type catalog — or refuses to.

> ## Read this before running anything
>
> **This is a proof of concept on entirely synthetic data.**
>
> - The catalog, rules, organizations, device flags, and every request string are
>   **invented**. "Meridian Valley Imaging" and "Northgate Orthopedic Partners" do
>   not exist.
> - It is **not clinically validated**.
> - It is **not HIPAA-ready** and is **not authorized to process PHI**. Do not
>   enter real patient information, real employer materials, production
>   credentials, proprietary visit-type tables, or licensed code sets.
> - It **cannot book anything**. There is no endpoint that creates, holds,
>   changes, or cancels an appointment, and no EHR, payer, clearinghouse, or
>   telephony integration exists.
> - It **never infers clinical suitability** — not device compatibility, not
>   contrast safety, not pregnancy or renal risk, not medical necessity. It
>   reproduces approved, versioned, configured rules and routes to named humans.
> - Passing the evaluation gates demonstrates that the engine behaves correctly on
>   data its authors wrote. It is **not** evidence that schedulers benefit. See
>   [`docs/evaluation.md`](docs/evaluation.md#what-these-numbers-do-not-show).

## What it does

Retrieval proposes candidates. Deterministic, versioned rules decide. The
resolver emits exactly one of five states:

| State               | Meaning                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `resolved`          | One candidate satisfies every required constraint, with adequate separation from the next.         |
| `needs_information` | A configured rule requires a field the request did not state. Only configured questions are asked. |
| `ambiguous`         | Several candidates remain materially equivalent.                                                   |
| `blocked`           | An approved configured rule prohibits progression and names an escalation path.                    |
| `no_match`          | No configured visit type satisfies the request.                                                    |

Precedence is `blocked` > `needs_information` > `no_match` > `ambiguous` > `resolved`.

**Safety invariant:** if the system lacks information required by a configured
safety or eligibility rule, it cannot output `resolved`.

## Requirements

- Node.js 20 or later (developed on 22)
- npm 10 or later
- Docker, optional, only for the PostgreSQL container the MVP does not use

## Setup

```bash
npm install
```

## Commands

| Command                           | What it does                                                |
| --------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                     | Runs the API and the web workbench together                 |
| `npm run dev:api`                 | API only, on `http://127.0.0.1:8787`                        |
| `npm run dev:web`                 | Workbench only, on `http://127.0.0.1:5173`                  |
| `npm run lint`                    | ESLint, zero warnings tolerated                             |
| `npm run format` / `format:check` | Prettier                                                    |
| `npm run typecheck`               | Project-references build                                    |
| `npm test`                        | Unit and integration tests (Vitest)                         |
| `npm run test:e2e`                | End-to-end tests (Playwright); starts both servers          |
| `npm run eval`                    | Offline evaluation; writes `.eval-out/evaluation.{json,md}` |
| `npm run eval -- --gate`          | Same, but exits non-zero if any gate fails                  |
| `npm run build`                   | Typecheck and production web build                          |
| `npm run audit:deps`              | `npm audit` at high severity                                |
| `npm run audit:secrets`           | Repository secret and PHI-shape scan                        |
| `npm run ci`                      | Everything CI runs, in order                                |

First E2E run only:

```bash
npx playwright install chromium --with-deps
```

Optional local PostgreSQL, for developing the persistence adapter. The proof of
concept runs entirely in memory and does not need it:

```bash
docker compose up -d    # applies db/schema.sql, listens on host port 5433
```

## Using the workbench

```bash
npm run dev
# open http://127.0.0.1:5173
```

Type a request, or use one of the seven built-in cases in the sidebar — they
cover all five states plus a contradictory request and an embedded instruction.

The workbench shows what was read from the request, the result state in plain
language, ranked catalog candidates with named score components, the exact rule
and version behind every question or block, and a "Select for test" action that
is explicitly labelled as not a booking. It never shows model reasoning, because
there is no model.

## API

All endpoints require `Authorization: Bearer <dev token>` and an
`x-cadence-tenant` header. The development token is deliberately trivial and is
not a credential system.

```bash
curl -s http://127.0.0.1:8787/v1/resolve \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer dev-token-not-a-secret' \
  -H 'x-cadence-tenant: meridian-imaging' \
  -d '{"text":"MRI lumbar spine"}'
```

| Method | Path                   |
| ------ | ---------------------- |
| `POST` | `/v1/resolve`          |
| `GET`  | `/v1/visit-types`      |
| `GET`  | `/v1/rule-sets/active` |
| `GET`  | `/health/live`         |
| `GET`  | `/health/ready`        |

There are no mutation endpoints, by design.

## Layout

```text
apps/
  api/          Fastify service; tenant scoping, size limits, structured errors
  web/          React + Vite scheduler workbench
packages/
  domain/       Zod schemas, rule grammar, governance validation
  rules-engine/ Deterministic, side-effect-free rule evaluation
  resolver/     Intent parsing, retrieval, the ten-step pipeline, eval harness
  fixtures/     Fictional catalog, governed rule sets, 151 labelled cases
  audit/        Allowlist-only audit events
db/schema.sql   PostgreSQL schema for the future adapter
docs/           Architecture, safety case, threat model, evaluation, governance
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — boundaries, pipeline, adapters, ADRs
- [`docs/safety-case.md`](docs/safety-case.md) — hazards, controls, residual risks, gates
- [`docs/threat-model.md`](docs/threat-model.md) — assets, actors, trust boundaries, threats
- [`docs/evaluation.md`](docs/evaluation.md) — datasets, metrics, leakage prevention, results
- [`docs/data-governance.md`](docs/data-governance.md) — prohibited data, audit fields, prerequisites

## Before this could touch real data

Not a checklist to tick quickly. Each item is work:

counsel-led covered-entity and business-associate analysis; a signed BAA where
applicable; a security risk analysis; a completed threat model with mitigations
implemented; a control matrix and customer responsibility matrix; incident
response and breach notification plans; retention, deletion, and legal-hold
design; tested backup and restore; production access governance; a per-EHR
capability matrix and adapter contract; a clinical governance body owning the
rule corpus; and insurance review.
