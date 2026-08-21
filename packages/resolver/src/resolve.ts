import {
  ResolutionResultSchema,
  isActive,
  type Candidate,
  type Evidence,
  type MissingField,
  type ResolutionResult,
  type ResolutionState,
  type RuleSet,
  type SchedulingIntent,
  type VisitType,
} from '@cadence/domain';
import { evaluateCandidate, type CandidateEvaluation } from '@cadence/rules-engine';
import { DeterministicIntentParser, type IntentParser } from './intent-parser.js';
import { LexicalRetriever, type CandidateRetriever, type RetrievalCandidate } from './retrieval.js';

export interface ResolverConfig {
  /** Minimum score gap between the top two qualified candidates to allow `resolved`. */
  separationMargin: number;
  /** Minimum absolute score for a candidate to be considered a match at all. */
  minimumScore: number;
  /**
   * ADR-004. A candidate gates the outcome only if it is within this many points
   * of the best eligible candidate. Rationale in docs/architecture.md: a weakly
   * matched candidate must not be able to force the whole request into
   * `needs_information`, because a resolver that refuses nearly everything gets
   * switched off, and a switched-off control protects nobody (P2.2 coverage).
   */
  contenderWindow: number;
  /**
   * ADR-004, second term. The window alone is scale-dependent: on a strongly
   * matched request a 20-point window still admits candidates that share only a
   * modality. A candidate must clear BOTH the absolute window and this fraction
   * of the best score to gate the outcome.
   */
  contenderRatio: number;
  retrievalLimit: number;
}

export const DEFAULT_CONFIG: ResolverConfig = {
  separationMargin: 8,
  minimumScore: 18,
  contenderWindow: 20,
  contenderRatio: 0.7,
  retrievalLimit: 10,
};

export interface ResolverDeps {
  parser?: IntentParser;
  retriever?: CandidateRetriever;
  config?: Partial<ResolverConfig>;
  now?: () => Date;
  traceId: string;
}

export interface ResolveInput {
  text: string;
  hints?: Partial<SchedulingIntent>;
  catalog: readonly VisitType[];
  ruleSet: RuleSet;
  tenantId: string;
}

export class InactiveRuleSetError extends Error {
  constructor(ruleSetId: string) {
    super(`rule set ${ruleSetId} is not approved and within its effective window`);
    this.name = 'InactiveRuleSetError';
  }
}

interface Evaluated {
  retrieval: RetrievalCandidate;
  evaluation: CandidateEvaluation;
}

function toCandidate(e: Evaluated): Candidate {
  return {
    visitTypeId: e.evaluation.candidate.id,
    code: e.evaluation.candidate.code,
    displayName: e.evaluation.candidate.displayName,
    durationMinutes: e.evaluation.candidate.durationMinutes,
    score: e.retrieval.score,
    components: e.retrieval.components,
    instructions: e.evaluation.instructions.map((i) => i.instruction),
  };
}

function bandFor(margin: number | null): 'low' | 'moderate' | 'high' {
  if (margin === null) return 'moderate';
  if (margin >= 25) return 'high';
  if (margin >= 15) return 'moderate';
  return 'low';
}

function dedupeEvidence(items: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const item of items) {
    if (seen.has(item.ruleId)) continue;
    seen.add(item.ruleId);
    out.push(item);
  }
  return out.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

const MODALITY_VALUES: Readonly<Record<string, string>> = {
  mri: 'MR',
  mr: 'MR',
  'magnetic resonance': 'MR',
  ct: 'CT',
  'cat scan': 'CT',
  cta: 'CT',
  'ct angiogram': 'CT',
  ultrasound: 'US',
  'ultra sound': 'US',
  sonogram: 'US',
  sono: 'US',
  doppler: 'US',
  duplex: 'US',
  us: 'US',
  'x-ray': 'XR',
  xray: 'XR',
  'x ray': 'XR',
  radiograph: 'XR',
  cxr: 'XR',
  mammogram: 'MG',
  mammo: 'MG',
  'bone scan': 'NM',
  hida: 'NM',
  'nuclear medicine': 'NM',
  dexa: 'DEXA',
  dxa: 'DEXA',
  'bone density': 'DEXA',
};

/**
 * The resolution pipeline. Steps run in the documented order; the order is
 * load-bearing, because a safety block must be reachable before ranking can
 * influence the outcome.
 *
 * State precedence (ADR-003):
 *   blocked > needs_information > no_match > ambiguous > resolved
 */
export function resolve(input: ResolveInput, deps: ResolverDeps): ResolutionResult {
  const config: ResolverConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const parser = deps.parser ?? new DeterministicIntentParser();
  const retriever = deps.retriever ?? new LexicalRetriever();
  const now = deps.now ?? (() => new Date());

  /* --- Step 1: validate tenant and input ------------------------------- */
  if (input.ruleSet.tenantId !== input.tenantId) throw new InactiveRuleSetError(input.ruleSet.id);
  if (!isActive(input.ruleSet, now())) throw new InactiveRuleSetError(input.ruleSet.id);
  const tenantCatalog = input.catalog.filter((v) => v.tenantId === input.tenantId);

  /* --- Step 2: parse into SchedulingIntent + field-level parse evidence - */
  const { intent, evidence: parseEvidence } = parser.parse(input.text, input.hints);
  const modalityToken = parseEvidence.find((e) => e.field === 'modality')?.matchedToken;
  const modality = modalityToken === undefined ? undefined : MODALITY_VALUES[modalityToken];

  const base = {
    traceId: deps.traceId,
    intent,
    parseEvidence,
    ruleSetVersion: input.ruleSet.version,
    schemaVersion: input.ruleSet.schemaVersion,
  };

  /* --- Step 3: retrieve catalog-backed candidates only ----------------- */
  const retrieved = retriever
    .retrieve(intent, tenantCatalog, modality, config.retrievalLimit)
    .filter((r) => r.score >= config.minimumScore);

  if (retrieved.length === 0) {
    return ResolutionResultSchema.parse({
      ...base,
      state: 'no_match' satisfies ResolutionState,
      candidates: [],
      missingFields: [],
      evidence: [],
      confidenceBand: 'low',
      separationMargin: null,
    });
  }

  /* --- Steps 4-6: apply required-field, safety, and rejection rules ----- */
  const evaluated: Evaluated[] = retrieved.map((r) => ({
    retrieval: r,
    evaluation: evaluateCandidate(r.visitType, intent, input.ruleSet),
  }));

  /* --- Step 6: deterministically reject constraint violations ---------- */
  const eligible = evaluated.filter((e) => e.evaluation.rejections.length === 0);
  const rejectionEvidence = dedupeEvidence(
    evaluated.flatMap((e) => e.evaluation.rejections.map((r) => r.evidence)),
  );

  if (eligible.length === 0) {
    return ResolutionResultSchema.parse({
      ...base,
      state: 'no_match' satisfies ResolutionState,
      candidates: [],
      missingFields: [],
      evidence: rejectionEvidence,
      confidenceBand: 'low',
      separationMargin: null,
    });
  }

  /* --- ADR-004: contender set ------------------------------------------ */
  const bestScore = Math.max(...eligible.map((e) => e.retrieval.score));
  const contenders = eligible.filter(
    (e) =>
      e.retrieval.score >= bestScore - config.contenderWindow &&
      e.retrieval.score >= bestScore * config.contenderRatio,
  );

  /* --- Step 5: safety blocks take absolute precedence ------------------ */
  const blocks = contenders.flatMap((e) => e.evaluation.blocks);
  if (blocks.length > 0) {
    const primary = blocks.find((b) => b.safetyCritical) ?? blocks[0]!;
    return ResolutionResultSchema.parse({
      ...base,
      state: 'blocked' satisfies ResolutionState,
      candidates: [],
      missingFields: [],
      evidence: dedupeEvidence(blocks.map((b) => b.evidence)),
      escalationMessage: primary.escalationMessage,
      confidenceBand: 'low',
      separationMargin: null,
    });
  }

  /* --- Step 4: unmet required information ------------------------------ */
  const gaps = contenders.flatMap((e) => e.evaluation.requirementGaps);
  if (gaps.length > 0) {
    const ordered = [...gaps].sort(
      (a, b) =>
        Number(b.safetyCritical) - Number(a.safetyCritical) || a.ruleId.localeCompare(b.ruleId),
    );
    const missing: MissingField[] = [];
    const seen = new Set<string>();
    for (const gap of ordered) {
      if (seen.has(gap.field)) continue;
      seen.add(gap.field);
      missing.push({ field: gap.field, question: gap.question, ruleId: gap.ruleId });
    }
    return ResolutionResultSchema.parse({
      ...base,
      state: 'needs_information' satisfies ResolutionState,
      candidates: [],
      missingFields: missing,
      evidence: dedupeEvidence(ordered.map((g) => g.evidence)),
      confidenceBand: 'low',
      separationMargin: null,
    });
  }

  /* --- Step 7: rank surviving candidates with an explainable score ----- */
  const qualified = eligible.filter((e) => e.evaluation.qualified);
  if (qualified.length === 0) {
    return ResolutionResultSchema.parse({
      ...base,
      state: 'no_match' satisfies ResolutionState,
      candidates: [],
      missingFields: [],
      evidence: rejectionEvidence,
      confidenceBand: 'low',
      separationMargin: null,
    });
  }

  const ranked = [...qualified].sort((a, b) =>
    b.retrieval.score !== a.retrieval.score
      ? b.retrieval.score - a.retrieval.score
      : a.evaluation.candidate.id.localeCompare(b.evaluation.candidate.id),
  );
  const candidates = ranked.map(toCandidate);

  const evidence = dedupeEvidence([
    ...ranked.flatMap((r) => r.evaluation.allowEvidence),
    ...ranked.flatMap((r) => r.evaluation.instructions.map((i) => i.evidence)),
  ]);

  /* --- Step 8: separation margin between the top two ------------------- */
  const top = candidates[0]!;
  const second = candidates[1];
  const margin = second === undefined ? null : top.score - second.score;

  /* --- Step 9: emit exactly one of the five states --------------------- */
  if (margin !== null && margin < config.separationMargin) {
    return ResolutionResultSchema.parse({
      ...base,
      state: 'ambiguous' satisfies ResolutionState,
      candidates,
      missingFields: [],
      evidence,
      confidenceBand: 'low',
      separationMargin: margin,
    });
  }

  return ResolutionResultSchema.parse({
    ...base,
    state: 'resolved' satisfies ResolutionState,
    candidates,
    missingFields: [],
    evidence,
    confidenceBand: bandFor(margin),
    separationMargin: margin,
  });
}

/* Step 10 (provenance + redacted audit event) is performed by ResolverService,
   which owns the audit sink. See packages/resolver/src/service.ts. */
