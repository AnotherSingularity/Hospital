# Architecture

Synthetic proof of concept. Not production. Not authorized to process PHI.

## 1. What this system is, and is not

It is a **read-only decision-support layer** that sits above a system of record it
never contacts. It maps a written scheduling request to a finite, locally
configured catalog, and abstains when it cannot do so safely.

It is not an autonomous scheduler, not a booking engine, and not a clinical
decision system. Those are not omissions to be filled in later by the same
codebase; they are different products with different risk models.

### Hard boundaries

| Boundary                              | Enforced by                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No catalog identifier can be invented | Candidates are catalog objects; no code path constructs an id. Re-checked at the service exit boundary. |
| No clinical inference                 | The rule grammar cannot express one. Safety rules detect a _stated_ flag and route to a named desk.     |
| No booking                            | No mutation endpoint exists. A test asserts `/v1/book` and siblings return 404.                         |
| No PHI                                | No patient entity in the domain, no patient table in the schema, no free-text column in audit.          |
| No ambient audio                      | No audio capture, transcription, or storage anywhere in the tree.                                       |
| No model call                         | `IntentParser` ships one deterministic implementation; the model adapter is a stub that throws.         |

## 2. Package boundaries

```text
domain ──────────► rules-engine ──┐
   │                              ├──► resolver ──► api ──► web
   ├──────────────► fixtures ─────┤
   └──────────────► audit ────────┘
```

Dependencies point one way. `domain` knows nothing about the resolver; `audit`
knows nothing about rules; `fixtures` is data plus its own validation and is
importable by tests without pulling in the pipeline.

- **`domain`** — Zod schemas for every entity, the allowlisted rule grammar, and
  governance validation Zod cannot express (unknown-field detection, nesting
  limits, safety-rule approval separation, supersession cycles, effective
  windows).
- **`rules-engine`** — pure evaluation. No I/O, no clock, no randomness.
- **`resolver`** — parsing, retrieval, the pipeline, tenant-scoped service, and
  the offline evaluation harness.
- **`fixtures`** — the fictional catalog, the governed rule sets, the labelled
  evaluation cases, and deliberately invalid rule sets for adversarial tests.
- **`audit`** — allowlist-only event construction plus a fail-closed scanner.
- **`api`** — trust boundary. Everything crossing it is Zod-validated.
- **`web`** — presentation only. It holds no rule logic.

## 3. Domain model

`Tenant`, `VisitType`, `Department`, `RuleSet`, `Rule`, `SchedulingIntent`,
`Evidence`, `ResolutionResult`, as specified. Two additions were necessary:

- **`ParseEvidence`** — field-level provenance for parsing. Without it the
  workbench cannot show _why_ a field was populated, and the P0.3 requirement
  that retrieval only proposes becomes unauditable.
- **`ScoreComponent`** — named, signed contributions to a candidate's score.
  Ranking must be explainable to a scheduler, so an opaque similarity number is
  not acceptable output.

## 4. Rule language

Rules are validated JSON, never executable user code.

- Boolean composition: `all`, `any`, `not`
- Comparisons: `eq`, `in`, `contains`, `exists`
- Effects: `require_field`, `allow_candidate`, `reject_candidate`,
  `block_and_escalate`, `add_instruction`
- Fields restricted to a literal allowlist of `intent.*` and `candidate.*` paths

Rejected at validation: unknown operators, unknown fields, nesting beyond depth
6, condition trees beyond 128 nodes, oversized payloads, duplicate rule ids,
mismatched rule-set ids, self-supersession, supersession cycles, review dates
preceding effective dates, safety rules without a distinct clinical approver, and
safety rules using `allow_candidate`.

An unrecognized operator reaching evaluation returns `false`. It never throws
open, and never passes.

### A constraint worth stating plainly

The grammar compares **a field to a literal**, never a field to another field.
There is no `eq(intent.contrast, candidate.contrast)`.

This is a real limitation and it was kept deliberately. Field-to-field comparison
would let a rule author write a constraint whose effect depends on data neither
they nor a reviewer can see at authoring time. Instead, cross-attribute
constraints are expressed as explicit literal pairs — `R-REJ-001` through
`R-REJ-006` enumerate the contrast and laterality combinations that conflict.
More rules, each one readable and reviewable on its own. That trade is correct
for a corpus that a clinical approver has to sign.

## 5. Resolution pipeline

Implemented in `packages/resolver/src/resolve.ts`, in this exact order:

1. Validate tenant and input; confirm the rule set belongs to the tenant and is
   approved and inside its effective window.
2. Parse into `SchedulingIntent` plus field-level parse evidence.
3. Retrieve **catalog-backed candidates only**, above a minimum score.
4. Evaluate required-field rules.
5. Evaluate safety-critical block and escalation rules.
6. Deterministically reject candidates violating constraints.
7. Rank survivors by explainable score.
8. Apply the configurable separation margin between the top two.
9. Emit exactly one of the five states.
10. Produce provenance and a redacted audit event (`service.ts`, which owns the
    sink).

Steps 4 through 6 are computed per candidate in one pass for determinism, then
applied in precedence order. The ordering of _effects_ is what matters, and it is
preserved.

### Configuration

| Setting            | Default | Purpose                                      |
| ------------------ | ------- | -------------------------------------------- |
| `minimumScore`     | 18      | Below this a candidate is not a match at all |
| `separationMargin` | 8       | Top-two gap required for `resolved`          |
| `contenderWindow`  | 20      | Absolute gating window (ADR-004)             |
| `contenderRatio`   | 0.7     | Relative gating threshold (ADR-004)          |
| `retrievalLimit`   | 10      | Candidates considered                        |

## 6. Adapters

Three seams exist so the risky version of each component can be swapped in under
review rather than smuggled in.

- **`IntentParser`** — `DeterministicIntentParser` ships. `ModelIntentParserStub`
  throws. A model adapter may only ever populate the same validated
  `SchedulingIntent`. It may never emit an identifier, a state, or a confidence
  used as authorization.
- **`CandidateRetriever`** — `LexicalRetriever` ships. `VectorRetrieverStub`
  throws. Vector retrieval may only add candidates drawn from the tenant catalog.
- **`CatalogRepository`** — `InMemoryCatalogRepository` ships. `db/schema.sql`
  is the PostgreSQL target. Every method takes a tenant argument; there is no
  overload that omits it.

## 7. Architecture decision records

### ADR-001 — Deterministic parsing, not a language model

**Status:** accepted.

**Context.** The original spec proposed hybrid vector and lexical retrieval with
model-mediated interpretation.

**Decision.** MVP0 parses with a configured lexicon. No model call.

**Rationale.** The question under test is whether a _constrained_ resolver helps.
A model in the loop makes every failure ambiguous between "the constraint model
is wrong" and "the model hallucinated," and it makes the evaluation
non-reproducible. Determinism also makes the safety case tractable: the same
input produces the same output forever, and a reviewer can trace any outcome to a
rule.

**Consequence.** Parsing coverage is narrower. Unparsed detail becomes a question
rather than a guess, which is the correct failure direction. The seam exists for
a model adapter, gated on re-running every evaluation gate.

### ADR-002 — Rules as validated data, not code

**Status:** accepted.

**Context.** Local rules were positioned as the differentiator, and rule authors
are operations staff, not engineers.

**Decision.** Rules are JSON validated against an allowlisted grammar. No
expression evaluation, no sandbox, no user-supplied code.

**Rationale.** A sandbox is a security boundary that must hold against a hostile
author; an allowlist is a much smaller thing to get right. It also makes rules
diffable, reviewable by a clinician, exportable, and mechanically checkable for
governance metadata.

**Consequence.** Some constraints are inexpressible — see the field-to-literal
limitation in section 4. Rules are exportable in a documented format, deliberately:
competing on data captivity was rejected.

### ADR-003 — State precedence

**Status:** accepted.

**Decision.** `blocked` > `needs_information` > `no_match` > `ambiguous` > `resolved`.

**Rationale, edge cases resolved:**

- **blocked over needs_information.** A configured block is a decision already
  made by a named approver. Asking a question first would invite a scheduler to
  answer it and expect to proceed.
- **needs_information over no_match.** Missing information means the search was
  run against an incomplete intent. Declaring "no such visit type" on incomplete
  input asserts something not yet known.
- **no_match over ambiguous.** Ambiguity presupposes viable candidates. With
  none, ambiguity is not the honest description.
- **ambiguous over resolved.** The separation margin is the abstention
  mechanism. A near-tie resolves to nothing.

**Consequence.** The resolver abstains more than a naive ranker. That is the
intent, bounded by the coverage gate.

### ADR-004 — The contender set

**Status:** accepted. Introduced during the first evaluation run.

**Context.** The first run scored 135/151. The failures shared a cause: a weakly
matched candidate could drag the whole request into `needs_information`. A
request for `cat scan of the head, no contrast` retrieved an MR brain entry
scoring 30 against a CT entry scoring 45; the MR safety-screening rule fired on
the MR entry, and the request — unambiguously a CT — became a screening question.

**Decision.** A candidate gates the outcome only if it clears **both**
`bestScore − contenderWindow` **and** `bestScore × contenderRatio`. Rejections
still apply to every candidate, because they only remove options. Blocks and
requirement gaps gate only when raised by a contender.

**Rationale.** Two things had to be true at once. Gating on non-contenders is not
conservative, it is broken: it makes the resolver refuse nearly everything, and a
control that gets switched off protects nobody — the coverage concern in P2.2 made
operational. And gating must remain fail-closed for anything actually in play: if
a candidate is a genuine contender, its safety rule fires and the request stops.
A candidate that is not selected schedules nothing.

**Why two terms.** The absolute window alone is scale-dependent — on a strongly
matched request, 20 points still admits candidates sharing only a modality. The
ratio alone is unstable on low scores. Both together behave across the range.

**Consequence.** Two configuration values to justify per deployment. Both are
reported in the evaluation output and must be re-validated if retrieval weights
change.

### ADR-005 — Mismatch penalties are negative evidence

**Status:** accepted. Introduced during the first evaluation run.

**Context.** `bone scan whole body` surfaced a DEXA scan; `wrist x-ray` surfaced
chest, knee, foot, and lumbar films tied at identical scores. Both came from
scoring only positive overlap: the shared token "x-ray" plus a modality match
produced a plausible-looking score for an entirely different exam.

**Decision.** When the request names a modality or a body region and a candidate
contradicts it, apply −25.

**Rationale.** A request naming a modality is making a positive statement, not
expressing a preference. A candidate contradicting it is a _different exam_, not
a weaker match, and scoring it as merely weaker is a category error that produces
confident wrong answers — precisely the failure mode the accuracy gate exists to
catch.

**Consequence.** Retrieval can now return a negative score, which the minimum
threshold filters. Score components display negative contributions explicitly in
the workbench, so a scheduler sees why an option was pushed down.

## 8. Assumptions and unresolved choices

Recorded rather than blocked on:

1. **Confidence bands are derived from the separation margin**, not from a
   probability model. They are descriptive, reported in the calibration gate, and
   never authorize a resolution.
2. **A single active rule set per tenant.** Real deployments will likely need
   department-scoped sets; the supersession chain exists but composition does not.
3. **Rate limiting is in-process.** Correct only for a single instance.
4. **The development token is not authentication.** Real identity, per-actor
   authorization, and session management are unbuilt.
5. **Latency is measured in-process** with no network, no database, and a
   37-entry catalog. It is a floor, not a forecast.
6. **English-only lexicon.** Multilingual parsing is unaddressed.
7. **The tenant header is trusted after token check.** Adequate for a local
   prototype; unacceptable in production, where tenant must derive from the
   authenticated principal.
