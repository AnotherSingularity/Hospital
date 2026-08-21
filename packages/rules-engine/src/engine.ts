import type {
  Condition,
  Evidence,
  FieldPath,
  Rule,
  RuleSet,
  SchedulingIntent,
  VisitType,
} from '@cadence/domain';

/**
 * Deterministic rule evaluation.
 *
 * Invariants:
 *  - No I/O, no clock reads, no randomness. Same inputs => same outputs, always.
 *  - Only allowlisted field paths are readable. Unknown paths evaluate as absent,
 *    never as an error that could be swallowed into a permissive result.
 *  - Nothing here generates an identifier. Identifiers only ever come from the catalog.
 */

export type FieldValue = string | number | boolean | string[] | undefined;

export function readField(
  path: FieldPath,
  intent: SchedulingIntent,
  candidate: VisitType | null,
): FieldValue {
  const [scope, key] = path.split('.') as ['intent' | 'candidate', string];

  if (scope === 'intent') {
    const record = intent as unknown as Record<string, FieldValue>;
    return record[key];
  }

  if (candidate === null) return undefined;
  const record = candidate as unknown as Record<string, FieldValue>;
  return record[key];
}

function isAbsent(value: FieldValue): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function scalarEquals(actual: FieldValue, expected: string | number | boolean): boolean {
  if (isAbsent(actual)) return false;
  if (Array.isArray(actual)) {
    return actual.some((item) => scalarEquals(item, expected));
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return normalize(actual) === normalize(expected);
  }
  return actual === expected;
}

export function evaluateCondition(
  condition: Condition,
  intent: SchedulingIntent,
  candidate: VisitType | null,
): boolean {
  switch (condition.op) {
    case 'all':
      return condition.of.every((c) => evaluateCondition(c, intent, candidate));
    case 'any':
      return condition.of.some((c) => evaluateCondition(c, intent, candidate));
    case 'not':
      return !evaluateCondition(condition.of, intent, candidate);
    case 'eq':
      return scalarEquals(readField(condition.field, intent, candidate), condition.value);
    case 'in':
      return condition.values.some((v) =>
        scalarEquals(readField(condition.field, intent, candidate), v),
      );
    case 'contains': {
      const actual = readField(condition.field, intent, candidate);
      if (isAbsent(actual)) return false;
      const needle = normalize(condition.value);
      if (Array.isArray(actual)) return actual.some((item) => normalize(String(item)) === needle);
      return normalize(String(actual)).includes(needle);
    }
    case 'exists':
      return !isAbsent(readField(condition.field, intent, candidate));
    default: {
      // Exhaustiveness guard: an unrecognized operator must never pass.
      const _never: never = condition;
      void _never;
      return false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rule application                                                    */
/* ------------------------------------------------------------------ */

export interface RequirementGap {
  field: FieldPath;
  question: string;
  ruleId: string;
  safetyCritical: boolean;
  evidence: Evidence;
}

export interface Rejection {
  ruleId: string;
  reason: string;
  safetyCritical: boolean;
  evidence: Evidence;
}

export interface Block {
  ruleId: string;
  escalationMessage: string;
  safetyCritical: boolean;
  evidence: Evidence;
}

export interface CandidateEvaluation {
  candidate: VisitType;
  rejections: Rejection[];
  blocks: Block[];
  requirementGaps: RequirementGap[];
  instructions: Array<{ instruction: string; evidence: Evidence }>;
  allowEvidence: Evidence[];
  qualified: boolean;
}

function toEvidence(rule: Rule, ruleSet: RuleSet): Evidence {
  return {
    ruleId: rule.id,
    ruleSetVersion: ruleSet.version,
    sourceRef: ruleSet.sourceRef,
    explanation: rule.explanation,
  };
}

/** Rules sort by priority ascending, then id, so evaluation order is total and stable. */
export function orderedRules(ruleSet: RuleSet): Rule[] {
  return [...ruleSet.rules].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.id.localeCompare(b.id),
  );
}

export function evaluateCandidate(
  candidate: VisitType,
  intent: SchedulingIntent,
  ruleSet: RuleSet,
): CandidateEvaluation {
  const rejections: Rejection[] = [];
  const blocks: Block[] = [];
  const requirementGaps: RequirementGap[] = [];
  const instructions: Array<{ instruction: string; evidence: Evidence }> = [];
  const allowEvidence: Evidence[] = [];

  for (const rule of orderedRules(ruleSet)) {
    if (!evaluateCondition(rule.conditions, intent, candidate)) continue;
    const evidence = toEvidence(rule, ruleSet);

    switch (rule.effect.kind) {
      case 'require_field': {
        const present = evaluateCondition(
          { op: 'exists', field: rule.effect.field },
          intent,
          candidate,
        );
        if (!present) {
          requirementGaps.push({
            field: rule.effect.field,
            question: rule.effect.question,
            ruleId: rule.id,
            safetyCritical: rule.safetyCritical,
            evidence,
          });
        }
        break;
      }
      case 'reject_candidate':
        rejections.push({
          ruleId: rule.id,
          reason: rule.effect.reason,
          safetyCritical: rule.safetyCritical,
          evidence,
        });
        break;
      case 'block_and_escalate':
        blocks.push({
          ruleId: rule.id,
          escalationMessage: rule.effect.escalationMessage,
          safetyCritical: rule.safetyCritical,
          evidence,
        });
        break;
      case 'add_instruction':
        instructions.push({ instruction: rule.effect.instruction, evidence });
        break;
      case 'allow_candidate':
        allowEvidence.push(evidence);
        break;
    }
  }

  return {
    candidate,
    rejections,
    blocks,
    requirementGaps,
    instructions,
    allowEvidence,
    qualified: rejections.length === 0 && blocks.length === 0 && requirementGaps.length === 0,
  };
}
