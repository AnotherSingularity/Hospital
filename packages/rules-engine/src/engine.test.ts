import { describe, expect, it } from 'vitest';
import {
  RuleValidationError,
  SchedulingIntentSchema,
  assertNoSupersessionCycle,
  inspectCondition,
  validateRuleSet,
  type Condition,
} from '@cadence/domain';
import {
  INVALID_RULE_SET_INPUTS,
  MERIDIAN_CATALOG,
  MERIDIAN_RULESET,
  NORTHGATE_RULESET,
} from '@cadence/fixtures';
import { evaluateCandidate, evaluateCondition, orderedRules } from './engine.js';

const intent = (over: Record<string, unknown> = {}) =>
  SchedulingIntentSchema.parse({ procedureText: 'test request', ...over });

const knee = MERIDIAN_CATALOG.find((v) => v.id === 'VT-MR-KNEE-WO')!;
const chestXray = MERIDIAN_CATALOG.find((v) => v.id === 'VT-XR-CHEST-2V')!;

describe('1. rule-schema validation and malicious-input rejection', () => {
  it('accepts the governed fixture rule sets', () => {
    expect(MERIDIAN_RULESET.rules.length).toBeGreaterThan(0);
    expect(NORTHGATE_RULESET.rules.length).toBeGreaterThan(0);
  });

  it('rejects an unknown operator', () => {
    expect(() => validateRuleSet(INVALID_RULE_SET_INPUTS.unknown_operator)).toThrow(
      RuleValidationError,
    );
  });

  it('rejects a field outside the addressable allowlist', () => {
    expect(() => validateRuleSet(INVALID_RULE_SET_INPUTS.unknown_field)).toThrow(
      RuleValidationError,
    );
  });

  it('rejects a safety-critical rule with no clinical approver', () => {
    expect(() =>
      validateRuleSet(INVALID_RULE_SET_INPUTS.safety_rule_without_clinical_approver),
    ).toThrow(/clinicalApprover/);
  });

  it('rejects a safety rule approved by its own author', () => {
    expect(() => validateRuleSet(INVALID_RULE_SET_INPUTS.safety_rule_self_approved)).toThrow(
      /must differ from authoredBy/,
    );
  });

  it('rejects self-supersession', () => {
    expect(() => validateRuleSet(INVALID_RULE_SET_INPUTS.self_supersession)).toThrow(/cyclic/);
  });

  it('rejects a review date before the effective date', () => {
    expect(() => validateRuleSet(INVALID_RULE_SET_INPUTS.review_before_effective)).toThrow(
      /reviewAt/,
    );
  });

  it('rejects condition nesting beyond the documented depth', () => {
    let condition: Condition = { op: 'exists', field: 'intent.contrast' };
    for (let i = 0; i < 10; i += 1) condition = { op: 'not', of: condition };
    expect(() => inspectCondition(condition)).toThrow(/max depth/);
  });

  it('detects a supersession cycle across rule sets', () => {
    const a = { ...MERIDIAN_RULESET, id: 'RS-A', supersedes: 'RS-B' };
    const b = { ...MERIDIAN_RULESET, id: 'RS-B', supersedes: 'RS-A' };
    expect(() => assertNoSupersessionCycle([a, b])).toThrow(/cycle/);
  });

  it('treats an unrecognized operator as false rather than throwing open', () => {
    const rogue = { op: 'exec', field: 'intent.contrast' } as unknown as Condition;
    expect(evaluateCondition(rogue, intent(), knee)).toBe(false);
  });
});

describe('2. rule precedence and deterministic repeatability', () => {
  it('orders rules by priority then id, totally', () => {
    const ordered = orderedRules(MERIDIAN_RULESET);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1]!;
      const cur = ordered[i]!;
      expect(
        prev.priority < cur.priority ||
          (prev.priority === cur.priority && prev.id.localeCompare(cur.id) <= 0),
      ).toBe(true);
    }
  });

  it('safety rules sort ahead of requirement and rejection rules', () => {
    const ordered = orderedRules(MERIDIAN_RULESET);
    const firstSafety = ordered.findIndex((r) => r.safetyCritical);
    const firstRejection = ordered.findIndex((r) => r.effect.kind === 'reject_candidate');
    expect(firstSafety).toBeLessThan(firstRejection);
  });

  it('produces byte-identical evaluations across repeated runs', () => {
    const i = intent({
      contrast: 'without',
      laterality: 'left',
      deviceFlags: ['screening_complete_none_reported'],
    });
    const runs = Array.from({ length: 25 }, () =>
      JSON.stringify(evaluateCandidate(knee, i, MERIDIAN_RULESET)),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it('is free of side effects on the intent and candidate', () => {
    const i = intent({ contrast: 'with' });
    const snapshotIntent = JSON.stringify(i);
    const snapshotCandidate = JSON.stringify(knee);
    evaluateCandidate(knee, i, MERIDIAN_RULESET);
    expect(JSON.stringify(i)).toBe(snapshotIntent);
    expect(JSON.stringify(knee)).toBe(snapshotCandidate);
  });
});

describe('condition operators', () => {
  it('matches array membership with contains', () => {
    expect(
      evaluateCondition(
        { op: 'contains', field: 'intent.deviceFlags', value: 'implanted_device_class_a' },
        intent({ deviceFlags: ['implanted_device_class_a'] }),
        knee,
      ),
    ).toBe(true);
  });

  it('treats an empty array as absent for exists', () => {
    expect(
      evaluateCondition(
        { op: 'exists', field: 'intent.deviceFlags' },
        intent({ deviceFlags: [] }),
        knee,
      ),
    ).toBe(false);
  });

  it('treats whitespace-only strings as absent', () => {
    expect(
      evaluateCondition(
        { op: 'exists', field: 'intent.referringProvider' },
        intent({ referringProvider: '   ' }),
        knee,
      ),
    ).toBe(false);
  });

  it('reads candidate fields only when a candidate is supplied', () => {
    expect(evaluateCondition({ op: 'exists', field: 'candidate.modality' }, intent(), null)).toBe(
      false,
    );
    expect(
      evaluateCondition({ op: 'exists', field: 'candidate.modality' }, intent(), chestXray),
    ).toBe(true);
  });
});

describe('5. missing safety-relevant input cannot resolve', () => {
  it('records a requirement gap for MR screening when device flags are absent', () => {
    const evaluation = evaluateCandidate(
      knee,
      intent({ contrast: 'without', laterality: 'left' }),
      MERIDIAN_RULESET,
    );
    const gap = evaluation.requirementGaps.find((g) => g.field === 'intent.deviceFlags');
    expect(gap).toBeDefined();
    expect(gap?.safetyCritical).toBe(true);
    expect(evaluation.qualified).toBe(false);
  });

  it('blocks when a configured device flag is present', () => {
    const evaluation = evaluateCandidate(
      knee,
      intent({
        contrast: 'without',
        laterality: 'left',
        deviceFlags: ['implanted_device_class_a'],
      }),
      MERIDIAN_RULESET,
    );
    expect(evaluation.blocks.some((b) => b.ruleId === 'R-SAFE-001')).toBe(true);
    expect(evaluation.qualified).toBe(false);
  });
});
