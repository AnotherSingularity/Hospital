import type { ResolutionState } from '@cadence/domain';
import { EVAL_CASES, catalogIdsFor, type CaseSplit, type EvalCase } from '@cadence/fixtures';
import { ResolverService } from '../service.js';

/**
 * Offline evaluation.
 *
 * The headline number is NOT overall accuracy. Overall accuracy hides the only
 * failure that matters: a confidently wrong `resolved` that bypasses a configured
 * safety rule. The gates below are ordered by how much damage the failure does.
 */

export interface CaseResult {
  caseId: string;
  split: CaseSplit;
  tags: string[];
  expectedState: ResolutionState;
  actualState: ResolutionState;
  stateCorrect: boolean;
  top1Correct: boolean | null;
  top3Correct: boolean | null;
  missingFieldsCorrect: boolean | null;
  candidatesPresent: boolean | null;
  /** True when a configured safety rule should have gated this case and did not. */
  criticalBypass: boolean;
  inventedId: boolean;
  crossTenantId: boolean;
  confidenceBand: string;
  latencyMs: number;
}

export interface SplitReport {
  split: CaseSplit | 'all';
  total: number;
  coverageByState: Record<string, number>;
  expectedByState: Record<string, number>;
  selectiveAccuracyResolved: number;
  resolvedEmitted: number;
  top1Accuracy: number;
  top3Accuracy: number;
  criticalBypassCount: number;
  inventedIdCount: number;
  crossTenantIdCount: number;
  ambiguityDetectionRate: number;
  noMatchBehaviourRate: number;
  overallStateAccuracy: number;
  calibration: Array<{ band: string; emitted: number; accuracy: number }>;
  byTag: Array<{ tag: string; total: number; stateAccuracy: number }>;
  latency: { p50: number; p95: number; p99: number };
  failures: Array<{ caseId: string; expected: string; actual: string; reason: string }>;
}

export interface EvaluationReport {
  generatedAt: string;
  resolverConfigNote: string;
  splits: SplitReport[];
  gates: Array<{ id: string; description: string; passed: boolean; observed: string }>;
  allGatesPassed: boolean;
}

const GATE_SELECTIVE_ACCURACY = 0.98;
const GATE_P95_MS = 400;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function runCase(service: ResolverService, testCase: EvalCase): CaseResult {
  const started = performance.now();
  let actualState: ResolutionState = 'no_match';
  let top1Correct: boolean | null = null;
  let top3Correct: boolean | null = null;
  let missingFieldsCorrect: boolean | null = null;
  let candidatesPresent: boolean | null = null;
  let inventedId = false;
  let crossTenantId = false;
  let confidenceBand = 'low';

  const permitted = catalogIdsFor(testCase.tenantId);
  const foreign = new Set<string>();
  for (const other of ['meridian-imaging', 'northgate-ortho']) {
    if (other === testCase.tenantId) continue;
    for (const id of catalogIdsFor(other)) foreign.add(id);
  }

  const { result } = service.resolve({
    tenantId: testCase.tenantId,
    actorId: 'eval-harness',
    traceId: testCase.id,
    text: testCase.text,
  });

  actualState = result.state;
  confidenceBand = result.confidenceBand;

  for (const candidate of result.candidates) {
    if (!permitted.has(candidate.visitTypeId)) inventedId = true;
    if (foreign.has(candidate.visitTypeId)) crossTenantId = true;
  }

  if (testCase.expectVisitTypeId !== undefined) {
    top1Correct = result.candidates[0]?.visitTypeId === testCase.expectVisitTypeId;
    top3Correct = result.candidates
      .slice(0, 3)
      .some((c) => c.visitTypeId === testCase.expectVisitTypeId);
  }
  if (testCase.expectMissingFields !== undefined) {
    missingFieldsCorrect = testCase.expectMissingFields.every((f) =>
      result.missingFields.some((m) => m.field === f),
    );
  }
  if (testCase.expectCandidateIds !== undefined) {
    candidatesPresent = testCase.expectCandidateIds.every((id) =>
      result.candidates.some((c) => c.visitTypeId === id),
    );
  }

  const stateCorrect = actualState === testCase.expectState;

  /**
   * A critical bypass is specifically: a case whose configured expectation was a
   * gating state (blocked or needs_information) on a safety-relevant rule, which
   * the resolver instead emitted as `resolved`. Everything else is an accuracy
   * miss, not a safety failure.
   */
  const criticalBypass =
    testCase.safetyCritical &&
    (testCase.expectState === 'blocked' || testCase.expectState === 'needs_information') &&
    actualState === 'resolved';

  return {
    caseId: testCase.id,
    split: testCase.split,
    tags: testCase.tags,
    expectedState: testCase.expectState,
    actualState,
    stateCorrect,
    top1Correct,
    top3Correct,
    missingFieldsCorrect,
    candidatesPresent,
    criticalBypass,
    inventedId,
    crossTenantId,
    confidenceBand,
    latencyMs: performance.now() - started,
  };
}

function summarize(results: CaseResult[], split: CaseSplit | 'all'): SplitReport {
  const coverageByState: Record<string, number> = {};
  const expectedByState: Record<string, number> = {};
  for (const r of results) {
    coverageByState[r.actualState] = (coverageByState[r.actualState] ?? 0) + 1;
    expectedByState[r.expectedState] = (expectedByState[r.expectedState] ?? 0) + 1;
  }

  const emittedResolved = results.filter((r) => r.actualState === 'resolved');
  const selectiveCorrect = emittedResolved.filter(
    (r) => r.stateCorrect && r.top1Correct !== false,
  ).length;

  const withTop1 = results.filter((r) => r.top1Correct !== null);
  const withTop3 = results.filter((r) => r.top3Correct !== null);
  const ambiguityCases = results.filter((r) => r.expectedState === 'ambiguous');
  const noMatchCases = results.filter((r) => r.expectedState === 'no_match');

  const bands = ['low', 'moderate', 'high'];
  const calibration = bands.map((band) => {
    const inBand = emittedResolved.filter((r) => r.confidenceBand === band);
    return {
      band,
      emitted: inBand.length,
      accuracy:
        inBand.length === 0
          ? 0
          : inBand.filter((r) => r.stateCorrect && r.top1Correct !== false).length / inBand.length,
    };
  });

  const tags = [...new Set(results.flatMap((r) => r.tags))].sort();
  const byTag = tags.map((tag) => {
    const inTag = results.filter((r) => r.tags.includes(tag));
    return {
      tag,
      total: inTag.length,
      stateAccuracy: inTag.filter((r) => r.stateCorrect).length / inTag.length,
    };
  });

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  const failures = results
    .filter(
      (r) =>
        !r.stateCorrect ||
        r.top1Correct === false ||
        r.missingFieldsCorrect === false ||
        r.candidatesPresent === false ||
        r.inventedId ||
        r.crossTenantId,
    )
    .map((r) => ({
      caseId: r.caseId,
      expected: r.expectedState,
      actual: r.actualState,
      reason: !r.stateCorrect
        ? 'state mismatch'
        : r.top1Correct === false
          ? 'top-1 candidate mismatch'
          : r.missingFieldsCorrect === false
            ? 'expected missing field not asked'
            : r.candidatesPresent === false
              ? 'expected candidate absent'
              : r.inventedId
                ? 'identifier outside tenant catalog'
                : 'cross-tenant identifier',
    }));

  return {
    split,
    total: results.length,
    coverageByState,
    expectedByState,
    selectiveAccuracyResolved:
      emittedResolved.length === 0 ? 1 : selectiveCorrect / emittedResolved.length,
    resolvedEmitted: emittedResolved.length,
    top1Accuracy:
      withTop1.length === 0
        ? 0
        : withTop1.filter((r) => r.top1Correct === true).length / withTop1.length,
    top3Accuracy:
      withTop3.length === 0
        ? 0
        : withTop3.filter((r) => r.top3Correct === true).length / withTop3.length,
    criticalBypassCount: results.filter((r) => r.criticalBypass).length,
    inventedIdCount: results.filter((r) => r.inventedId).length,
    crossTenantIdCount: results.filter((r) => r.crossTenantId).length,
    ambiguityDetectionRate:
      ambiguityCases.length === 0
        ? 1
        : ambiguityCases.filter(
            (r) => r.actualState === 'ambiguous' || r.actualState === 'needs_information',
          ).length / ambiguityCases.length,
    noMatchBehaviourRate:
      noMatchCases.length === 0
        ? 1
        : noMatchCases.filter((r) => r.stateCorrect).length / noMatchCases.length,
    overallStateAccuracy: results.filter((r) => r.stateCorrect).length / results.length,
    calibration,
    byTag,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    failures,
  };
}

export function runEvaluation(service: ResolverService = new ResolverService()): EvaluationReport {
  // Warm up so the first case does not carry JIT cost into the p95 gate.
  for (const c of EVAL_CASES.slice(0, 5)) runCase(service, c);

  const results = EVAL_CASES.map((c) => runCase(service, c));
  const dev = summarize(
    results.filter((r) => r.split === 'dev'),
    'dev',
  );
  const frozen = summarize(
    results.filter((r) => r.split === 'frozen'),
    'frozen',
  );
  const all = summarize(results, 'all');

  const gates = [
    {
      id: 'G1-catalog-integrity',
      description: 'Every emitted visit-type id exists in the active tenant catalog',
      passed: all.inventedIdCount === 0 && all.crossTenantIdCount === 0,
      observed: `${all.inventedIdCount} invented, ${all.crossTenantIdCount} cross-tenant`,
    },
    {
      id: 'G3-critical-rule-bypass',
      description: 'Zero configured safety rules bypassed into a resolved state',
      passed: all.criticalBypassCount === 0,
      observed: `${all.criticalBypassCount} bypasses`,
    },
    {
      id: 'G4-selective-accuracy',
      description: `Selective accuracy among frozen 'resolved' outputs >= ${GATE_SELECTIVE_ACCURACY}`,
      passed: frozen.selectiveAccuracyResolved >= GATE_SELECTIVE_ACCURACY,
      observed: `${(frozen.selectiveAccuracyResolved * 100).toFixed(1)}% over ${frozen.resolvedEmitted} emitted`,
    },
    {
      id: 'G5-coverage',
      description: 'Coverage reported separately; resolver must not refuse most frozen cases',
      passed: (frozen.coverageByState.resolved ?? 0) / Math.max(1, frozen.total) >= 0.3,
      observed: `${frozen.coverageByState.resolved ?? 0}/${frozen.total} frozen cases resolved`,
    },
    {
      id: 'G6-calibration',
      description: 'No confidence band may report accuracy below the band beneath it',
      passed: (() => {
        const populated = all.calibration.filter((c) => c.emitted > 0);
        for (let i = 1; i < populated.length; i += 1) {
          if (populated[i]!.accuracy < populated[i - 1]!.accuracy - 0.05) return false;
        }
        return true;
      })(),
      observed: all.calibration
        .map((c) => `${c.band}:${c.emitted}@${(c.accuracy * 100).toFixed(0)}%`)
        .join(' '),
    },
    {
      id: 'G7-ambiguity',
      description: 'All intentionally ambiguous cases abstain (ambiguous or needs_information)',
      passed: all.ambiguityDetectionRate === 1,
      observed: `${(all.ambiguityDetectionRate * 100).toFixed(0)}%`,
    },
    {
      id: 'G8-unknown-behaviour',
      description: 'Out-of-catalog and injection cases never create identifiers or instructions',
      passed: all.noMatchBehaviourRate === 1 && all.inventedIdCount === 0,
      observed: `${(all.noMatchBehaviourRate * 100).toFixed(0)}% correct no_match`,
    },
    {
      id: 'G10-latency',
      description: `Resolver p95 under ${GATE_P95_MS} ms on the local benchmark`,
      passed: all.latency.p95 < GATE_P95_MS,
      observed: `p95 ${all.latency.p95.toFixed(2)} ms`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    resolverConfigNote:
      'Deterministic parser, lexical retrieval, in-memory repository. No model call, no network, no PHI.',
    splits: [dev, frozen, all],
    gates,
    allGatesPassed: gates.every((g) => g.passed),
  };
}

export function renderMarkdown(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push('# Cadence Overlay Resolver - evaluation report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('> Synthetic benchmark on a fictional catalog. These figures describe an');
  lines.push('> engine on data it was given, not clinical validity, not production');
  lines.push('> readiness, and not evidence that schedulers benefit. See docs/evaluation.md.');
  lines.push('');

  lines.push('## Gates');
  lines.push('');
  lines.push('| Gate | Result | Observed | Description |');
  lines.push('| --- | --- | --- | --- |');
  for (const g of report.gates) {
    lines.push(`| ${g.id} | ${g.passed ? 'PASS' : 'FAIL'} | ${g.observed} | ${g.description} |`);
  }
  lines.push('');

  for (const s of report.splits) {
    lines.push(`## Split: ${s.split}`);
    lines.push('');
    lines.push(`- Cases: ${s.total}`);
    lines.push(`- Overall state accuracy: ${(s.overallStateAccuracy * 100).toFixed(1)}%`);
    lines.push(
      `- Selective accuracy (resolved only): ${(s.selectiveAccuracyResolved * 100).toFixed(1)}% over ${s.resolvedEmitted} emitted`,
    );
    lines.push(`- Top-1 candidate accuracy: ${(s.top1Accuracy * 100).toFixed(1)}%`);
    lines.push(`- Top-3 candidate accuracy: ${(s.top3Accuracy * 100).toFixed(1)}%`);
    lines.push(`- Critical-rule bypasses: ${s.criticalBypassCount}`);
    lines.push(`- Invented identifiers: ${s.inventedIdCount}`);
    lines.push(`- Cross-tenant identifiers: ${s.crossTenantIdCount}`);
    lines.push(`- Ambiguity detection: ${(s.ambiguityDetectionRate * 100).toFixed(0)}%`);
    lines.push(`- Correct no_match behaviour: ${(s.noMatchBehaviourRate * 100).toFixed(0)}%`);
    lines.push(
      `- Latency: p50 ${s.latency.p50.toFixed(2)} ms, p95 ${s.latency.p95.toFixed(2)} ms, p99 ${s.latency.p99.toFixed(2)} ms`,
    );
    lines.push('');
    lines.push('Coverage by emitted state:');
    lines.push('');
    lines.push('| State | Emitted | Expected |');
    lines.push('| --- | --- | --- |');
    const states = [
      ...new Set([...Object.keys(s.coverageByState), ...Object.keys(s.expectedByState)]),
    ].sort();
    for (const st of states) {
      lines.push(`| ${st} | ${s.coverageByState[st] ?? 0} | ${s.expectedByState[st] ?? 0} |`);
    }
    lines.push('');
    lines.push('Accuracy by visit-type class (tag):');
    lines.push('');
    lines.push('| Tag | Cases | State accuracy |');
    lines.push('| --- | --- | --- |');
    for (const t of s.byTag) {
      lines.push(`| ${t.tag} | ${t.total} | ${(t.stateAccuracy * 100).toFixed(0)}% |`);
    }
    lines.push('');
    if (s.failures.length > 0) {
      lines.push('Failures:');
      lines.push('');
      lines.push('| Case | Expected | Actual | Reason |');
      lines.push('| --- | --- | --- | --- |');
      for (const f of s.failures) {
        lines.push(`| ${f.caseId} | ${f.expected} | ${f.actual} | ${f.reason} |`);
      }
      lines.push('');
    } else {
      lines.push('No failures.');
      lines.push('');
    }
  }

  return lines.join('\n');
}
