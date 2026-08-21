# Evaluation

Synthetic benchmark on a fictional catalog. Read
[section 6](#6-what-these-numbers-do-not-show) before quoting any figure here.

## 1. Datasets

### Catalog

37 fictional imaging visit types across two fictional organizations —
Meridian Valley Imaging (35 entries) and Northgate Orthopedic Partners (2
entries, existing solely to prove cross-tenant reads fail closed). Modalities MR,
CT, US, XR, MG, NM, DEXA. One entry is retired, so retirement handling is
testable.

Three **deliberate catalog hygiene defects** are modelled, because a resolver
that cannot detect them is not safe against a real catalog:

| Colliding alias              | Entries                                    |
| ---------------------------- | ------------------------------------------ |
| `neck ultrasound`            | `VT-US-THYROID`, `VT-US-NECK-SOFT-TISSUE`  |
| `abdominal ct with contrast` | `VT-CT-ABDOMEN-W`, `VT-CT-ABDPELVIS-W`     |
| `lumbar spine xray`          | `VT-XR-LSPINE-2V`, `VT-XR-LSPINE-COMPLETE` |

### Rule corpus

`RS-MERIDIAN-IMAGING` v4: 22 rules — 5 safety screening, 3 requirement, 6
rejection, 3 site capability, 4 preparation, 1 allow. `RS-NORTHGATE-ORTHO` v1: 2
rules. Both carry full governance metadata. Six deliberately invalid rule sets
exercise the validator.

### Labelled cases

151 cases total. Required coverage, by tag:

| Category                         | Cases                                      |
| -------------------------------- | ------------------------------------------ |
| Body region                      | 10                                         |
| Laterality                       | 9                                          |
| Contrast                         | 8                                          |
| Age band                         | 5                                          |
| Device / safety-screening flags  | 21 tagged `safety`, 3 tagged `device_flag` |
| Site capability                  | 8                                          |
| Missing order detail             | 19                                         |
| Aliases and misspellings         | 26 alias, 1 misspelling                    |
| Multiple plausible candidates    | 4 ambiguity, 4 alias collision             |
| No catalog match                 | 10                                         |
| Adversarial and prompt injection | 12                                         |
| Contradictory attributes         | 7                                          |
| Unicode edge cases               | 10                                         |
| Oversized / long input           | 1 (plus schema-level tests at the API)     |
| Unknown tenant                   | covered at service and API layers          |
| Cross-tenant identifiers         | 6                                          |

Unicode coverage: zero-width, soft hyphen, bidi override, fullwidth, combining
marks, en dash, emoji, non-breaking space, case folding, whitespace collapse.

## 2. Leakage prevention

Cases are split into **90 development** and **61 frozen**.

- Development cases were used while tuning retrieval weights, thresholds, and the
  contender parameters.
- **Frozen cases were not inspected during tuning.** They exist to detect the
  overfitting that tuning produces.
- The accuracy gate is computed on the **frozen** split. Coverage, calibration,
  and safety gates are computed across all cases, because a safety bypass
  anywhere is a failure regardless of split.
- Both splits are reported separately, always.

### One frozen label was corrected, and here is exactly why

`F-031` (`ct abdomen with contrast`) was originally labelled `ambiguous`. That
label was **wrong**, and the engine was right: this exact string is a configured
alias of `VT-CT-ABDOMEN-W` and of no other entry, so resolving to it is correct
behaviour.

The label was corrected, a comment in the fixture file records the reason, and
**`F-061` (`abdominal ct with contrast please`) was added** so frozen ambiguity
coverage is preserved using a string that genuinely collides across two entries.

Stated plainly because the distinction matters: correcting a label that
misdescribed the configured catalog is legitimate. Relabelling a case to make a
failure disappear would not be. No gate was weakened, and no threshold was moved
in response to a frozen-set result.

## 3. Metrics

Overall accuracy is deliberately **not** the headline. It hides the only failure
that matters — a confidently wrong `resolved` that bypasses a safety rule — and
it hides poor performance on rare, high-risk classes.

| Metric                 | Definition                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Selective accuracy     | Among cases emitted as `resolved`, the proportion where the state and the top-ranked candidate are both correct. The primary quality metric. |
| Coverage               | Distribution of emitted states. Reported separately so accuracy cannot be bought by refusing.                                                |
| Critical-rule bypass   | A safety-relevant case expected to gate that was emitted as `resolved`. **Must be zero.**                                                    |
| Top-1 / top-3 accuracy | Correct visit type ranked first / in the first three.                                                                                        |
| Calibration            | Measured accuracy per confidence band.                                                                                                       |
| Ambiguity detection    | Ambiguous fixtures returning `ambiguous` or `needs_information`.                                                                             |
| Unknown behaviour      | Out-of-catalog and injection cases behaving correctly and creating nothing.                                                                  |
| By class               | State accuracy per tag, so a weak class cannot hide in an aggregate.                                                                         |
| Latency                | p50 / p95 / p99, in-process.                                                                                                                 |

## 4. Results

Reproduce with `npm run eval`. Output lands in `.eval-out/`.

|                          | Development    | Frozen             | All            |
| ------------------------ | -------------- | ------------------ | -------------- |
| Cases                    | 90             | 61                 | 151            |
| Overall state accuracy   | 100.0%         | 100.0%             | 100.0%         |
| Selective accuracy       | 100.0% over 49 | **100.0% over 28** | 100.0% over 77 |
| Top-1 accuracy           | 100.0%         | 100.0%             | 100.0%         |
| Top-3 accuracy           | 100.0%         | 100.0%             | 100.0%         |
| Critical-rule bypasses   | 0              | **0**              | 0              |
| Invented identifiers     | 0              | 0                  | 0              |
| Cross-tenant identifiers | 0              | 0                  | 0              |
| Ambiguity detection      | 100%           | 100%               | 100%           |
| Correct `no_match`       | 100%           | 100%               | 100%           |
| Latency p95              | 5.59 ms        | 10.65 ms           | 8.64 ms        |

Coverage, all 151 cases: `resolved` 77, `needs_information` 28, `no_match` 25,
`blocked` 17, `ambiguous` 4. **Roughly half of all cases are refused.** That is
the intended behaviour of an abstaining resolver, and it is exactly why coverage
is reported next to accuracy rather than beneath it.

Calibration: `moderate` band 69 emitted at 100%, `high` band 8 emitted at 100%,
`low` band 0 emitted — non-resolved states always carry `low`, so nothing is
emitted as resolved with low confidence.

### Gates

| Gate                    | Result | Observed                                     |
| ----------------------- | ------ | -------------------------------------------- |
| G1 catalog integrity    | PASS   | 0 invented, 0 cross-tenant                   |
| G3 critical-rule bypass | PASS   | 0 bypasses                                   |
| G4 selective accuracy   | PASS   | 100.0% over 28 frozen emitted, threshold 98% |
| G5 coverage             | PASS   | 28/61 frozen resolved                        |
| G6 calibration          | PASS   | moderate 69@100%, high 8@100%                |
| G7 ambiguity            | PASS   | 100%                                         |
| G8 unknown behaviour    | PASS   | 100% correct `no_match`                      |
| G10 latency             | PASS   | p95 8.64 ms, threshold 400 ms                |

G2 (provenance) and G9 (tenant isolation) are enforced by the test suite rather
than the harness — see `resolve.test.ts` and `server.test.ts`. **G11 (usability)
has not been run.**

### What the first run found

The first execution scored 135/151. The failures were informative and produced
two architecture decisions rather than threshold nudges:

- **ADR-004, the contender set.** A weakly matched candidate could drag an
  unrelated request into `needs_information`. A request for `cat scan of the
head` retrieved an MR entry at score 30 against a CT entry at 45; the MR
  screening rule fired on it and turned a CT request into a screening question.
- **ADR-005, mismatch penalties.** `bone scan` surfaced a DEXA; `wrist x-ray`
  surfaced chest, knee, foot, and lumbar films tied on the shared token "x-ray".
  Contradicting a stated modality or region now scores negatively, because such a
  candidate is a different exam, not a weaker match.

## 5. Reproducibility

The resolver is deterministic: no clock reads inside evaluation, no randomness,
no network, no database, total sort orders everywhere. A dedicated test runs the
same evaluation 25 times and asserts byte-identical output. Latency is the only
figure that varies between runs.

## 6. What these numbers do not show

**This is a self-graded exam.** The same author wrote the catalog, the rules, and
the test cases, then measured the engine against them. 100% on the frozen split
means the engine correctly implements a specification, evaluated on data drawn
from the same head that wrote the specification.

Specifically, these results are **not** evidence of:

- **Clinical validity.** No clinician reviewed the rule corpus. The rules are
  invented.
- **Real-catalog performance.** A real catalog has hundreds to thousands of
  entries, inconsistent naming, historical cruft, and collisions far worse than
  the three modelled here. Retrieval difficulty grows with catalog size, and 37
  entries does not test that.
- **Real-request performance.** Every request string here was written by the
  person who wrote the parser's lexicon. Actual phrasing on a live call is
  messier, is interrupted, arrives in fragments, and contains detail the lexicon
  has never seen.
- **A human baseline.** Nobody measured how accurately trained schedulers do this
  today. Without that number, 98% is meaningless — it could be an improvement or a
  regression, and there is currently no way to tell which.
- **Whether the abstention rate is acceptable.** Half of all cases are refused.
  Whether that helps a scheduler or infuriates one is unmeasured.
- **Production latency.** Measured in-process against 37 in-memory entries, with
  no network, no database, no auth, and no concurrency. It is a floor.
- **Usability, adoption, or benefit.** Gate 11 remains unrun, and it is the only
  gate whose result is not already implied by the source code.

**The honest summary: the engine works. Whether the product should exist is a
different question, and this benchmark cannot answer it.**

## 7. What would make this evaluation meaningful

In rough order of value:

1. **A human baseline.** Measure trained schedulers on the same tasks. Everything
   else is uninterpretable without it.
2. **A real corpus under contract**, from a design partner, with rules authored
   and approved by that organization rather than by the vendor.
3. **Independent labelling.** Cases written and labelled by someone who did not
   write the resolver.
4. **Adversarial review of the rule corpus by a clinician**, looking for missing
   rules — the largest residual hazard, and one no test here can surface.
5. **Catalog scale testing** at realistic entry counts.
6. **Gate 11**, properly designed: controlled tasks, measured time, measured
   unsafe-error rate, adequate power.

Until at least items 1 and 2 exist, the correct description of this artifact is
_a working prototype_, not _a validated resolver_.
