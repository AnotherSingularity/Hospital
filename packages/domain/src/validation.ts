import {
  ADDRESSABLE_FIELDS,
  MAX_CONDITION_DEPTH,
  MAX_CONDITION_NODES,
  RuleSetSchema,
  SCHEMA_VERSION,
  type Condition,
  type RuleSet,
} from './schemas.js';

export class RuleValidationError extends Error {
  public readonly issues: string[];
  constructor(issues: string[]) {
    super(`rule validation failed: ${issues.join('; ')}`);
    this.name = 'RuleValidationError';
    this.issues = issues;
  }
}

const ADDRESSABLE = new Set<string>(ADDRESSABLE_FIELDS);

/** Depth and node-count guard. Rejects deeply nested or oversized condition trees. */
export function inspectCondition(
  condition: Condition,
  depth = 1,
): { depth: number; nodes: number; fields: string[] } {
  if (depth > MAX_CONDITION_DEPTH) {
    throw new RuleValidationError([`condition nesting exceeds max depth ${MAX_CONDITION_DEPTH}`]);
  }

  switch (condition.op) {
    case 'all':
    case 'any': {
      let nodes = 1;
      let maxDepth = depth;
      const fields: string[] = [];
      for (const child of condition.of) {
        const r = inspectCondition(child, depth + 1);
        nodes += r.nodes;
        maxDepth = Math.max(maxDepth, r.depth);
        fields.push(...r.fields);
      }
      if (nodes > MAX_CONDITION_NODES) {
        throw new RuleValidationError([`condition tree exceeds ${MAX_CONDITION_NODES} nodes`]);
      }
      return { depth: maxDepth, nodes, fields };
    }
    case 'not': {
      const r = inspectCondition(condition.of, depth + 1);
      return { depth: r.depth, nodes: r.nodes + 1, fields: r.fields };
    }
    default:
      return { depth, nodes: 1, fields: [condition.field] };
  }
}

/**
 * Full rule-set validation. Runs schema parsing, then governance and structural
 * checks that Zod alone cannot express.
 */
export function validateRuleSet(input: unknown): RuleSet {
  const parsed = RuleSetSchema.safeParse(input);
  if (!parsed.success) {
    throw new RuleValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const ruleSet = parsed.data;
  const issues: string[] = [];

  if (ruleSet.schemaVersion !== SCHEMA_VERSION) {
    issues.push(
      `schemaVersion ${ruleSet.schemaVersion} is not supported (expected ${SCHEMA_VERSION}); run a migration`,
    );
  }

  const seenRuleIds = new Set<string>();
  for (const rule of ruleSet.rules) {
    if (seenRuleIds.has(rule.id)) issues.push(`duplicate rule id ${rule.id}`);
    seenRuleIds.add(rule.id);

    if (rule.ruleSetId !== ruleSet.id) {
      issues.push(`rule ${rule.id} declares ruleSetId ${rule.ruleSetId}, expected ${ruleSet.id}`);
    }

    try {
      const { fields } = inspectCondition(rule.conditions);
      for (const f of fields) {
        if (!ADDRESSABLE.has(f)) issues.push(`rule ${rule.id} addresses unknown field ${f}`);
      }
    } catch (err) {
      if (err instanceof RuleValidationError)
        issues.push(`rule ${rule.id}: ${err.issues.join(', ')}`);
      else throw err;
    }

    // P0.5 governance: safety-critical rules cannot be self-published.
    if (rule.safetyCritical) {
      if (ruleSet.clinicalApprover === null) {
        issues.push(
          `rule ${rule.id} is safetyCritical but rule set ${ruleSet.id} has no clinicalApprover`,
        );
      } else if (ruleSet.clinicalApprover === ruleSet.authoredBy) {
        issues.push(
          `rule set ${ruleSet.id} clinicalApprover must differ from authoredBy (single-author publication of safety rules is prohibited)`,
        );
      }
      if (rule.effect.kind === 'allow_candidate') {
        issues.push(
          `rule ${rule.id} is safetyCritical and may not use allow_candidate (safety rules fail closed)`,
        );
      }
    }
  }

  if (ruleSet.status === 'approved' && ruleSet.approvedBy.trim().length === 0) {
    issues.push('approved rule set requires approvedBy');
  }

  const effectiveAt = Date.parse(ruleSet.effectiveAt);
  const reviewAt = Date.parse(ruleSet.reviewAt);
  if (reviewAt <= effectiveAt) issues.push('reviewAt must be after effectiveAt');

  if (ruleSet.supersedes === ruleSet.id) {
    issues.push(`rule set ${ruleSet.id} cannot supersede itself (cyclic supersession)`);
  }

  if (issues.length > 0) throw new RuleValidationError(issues);
  return ruleSet;
}

/** Detects cycles across a supersession chain of rule sets. */
export function assertNoSupersessionCycle(ruleSets: readonly RuleSet[]): void {
  const byId = new Map(ruleSets.map((r) => [r.id, r]));
  for (const start of ruleSets) {
    const seen = new Set<string>([start.id]);
    let cursor = start.supersedes;
    while (cursor !== null && cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new RuleValidationError([`supersession cycle detected involving ${cursor}`]);
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.supersedes ?? null;
    }
  }
}

/** A rule set is usable by the resolver only when approved and in its effective window. */
export function isActive(ruleSet: RuleSet, now: Date = new Date()): boolean {
  if (ruleSet.status !== 'approved') return false;
  const t = now.getTime();
  return t >= Date.parse(ruleSet.effectiveAt) && t < Date.parse(ruleSet.reviewAt);
}
