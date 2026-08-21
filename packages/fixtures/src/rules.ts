import { validateRuleSet, type RuleSet } from '@cadence/domain';

/**
 * ============================================================================
 * FICTIONAL RULE SET — SYNTHETIC TEST DATA
 * ============================================================================
 * Every rule below is invented for this proof of concept.
 *
 * P0.1 boundary, restated because it governs every safety rule here:
 * the resolver REPRODUCES an approved, versioned, configured rule. It never
 * infers clinical suitability. No rule below decides whether a device is
 * MR-conditional, whether contrast is appropriate, whether renal function
 * permits a study, or whether a patient may be pregnant. The safety rules
 * detect a STATED flag and route the case to a named human desk. That is the
 * only safety behaviour the system is permitted to have.
 *
 * Configured device flags (fictional vocabulary):
 *   implanted_device_class_a         — a stated implant class requiring screening
 *   metal_fragment_screen_pending    — screening questionnaire not yet completed
 *   contrast_reaction_history_flagged— a stated prior-reaction flag on file
 *   screening_complete_none_reported — screening completed, nothing reported
 * ============================================================================
 */

const MERIDIAN_RULESET_INPUT = {
  id: 'RS-MERIDIAN-IMAGING',
  tenantId: 'meridian-imaging',
  version: 4,
  status: 'approved',
  effectiveAt: '2026-01-01T00:00:00.000Z',
  reviewAt: '2027-01-01T00:00:00.000Z',
  approvedBy: 'A. Okonkwo, Director of Imaging Operations (fictional)',
  authoredBy: 'R. Delgado, Scheduling Standards Analyst (fictional)',
  clinicalApprover: 'Dr. P. Basu, Chief of Radiology (fictional)',
  sourceRef: 'MVI-SCHED-STD-2026 rev4 (fictional internal standard)',
  schemaVersion: '1.0.0',
  supersedes: 'RS-MERIDIAN-IMAGING-V3',
  rules: [
    /* ================= SAFETY (priority 0–99, fail closed) ================= */
    {
      id: 'R-SAFE-001',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 10,
      kind: 'safety_screening',
      safetyCritical: true,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'candidate.modality', value: 'MR' },
          { op: 'contains', field: 'intent.deviceFlags', value: 'implanted_device_class_a' },
        ],
      },
      effect: {
        kind: 'block_and_escalate',
        escalationMessage:
          'Rule MDS-14: a Class A implanted device flag is recorded on this request. MR studies with this flag are screened by the MR Safety Desk (x4410) before any appointment is created. Do not schedule from this workbench.',
      },
      explanation:
        'Configured routing rule. The system does not assess device compatibility; it detects the stated flag and routes to the named desk.',
    },
    {
      id: 'R-SAFE-002',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 11,
      kind: 'safety_screening',
      safetyCritical: true,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'candidate.modality', value: 'MR' },
          { op: 'contains', field: 'intent.deviceFlags', value: 'metal_fragment_screen_pending' },
        ],
      },
      effect: {
        kind: 'block_and_escalate',
        escalationMessage:
          'Rule MDS-15: the MR metal screening questionnaire is marked pending. Route to the MR Safety Desk (x4410) to complete screening before scheduling.',
      },
      explanation: 'Configured routing rule for an incomplete screening questionnaire.',
    },
    {
      id: 'R-SAFE-003',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 12,
      kind: 'safety_screening',
      safetyCritical: true,
      conditions: { op: 'eq', field: 'candidate.modality', value: 'MR' },
      effect: {
        kind: 'require_field',
        field: 'intent.deviceFlags',
        question:
          'MR safety screening is required before any MR visit type can be selected. Record the stated device flags, or "screening_complete_none_reported" if screening is complete and nothing was reported.',
      },
      explanation:
        'Configured mandatory screening gate. An MR request cannot reach a resolved state while screening status is unknown.',
    },
    {
      id: 'R-SAFE-004',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 13,
      kind: 'safety_screening',
      safetyCritical: true,
      conditions: {
        op: 'all',
        of: [
          { op: 'in', field: 'candidate.contrast', values: ['with', 'with_and_without'] },
          {
            op: 'contains',
            field: 'intent.deviceFlags',
            value: 'contrast_reaction_history_flagged',
          },
        ],
      },
      effect: {
        kind: 'block_and_escalate',
        escalationMessage:
          'Rule CON-07: a prior contrast reaction flag is recorded. Contrast-enhanced studies with this flag are protocolled by the Radiology Protocol Desk (x4425) before scheduling.',
      },
      explanation:
        'Configured routing rule. The system does not evaluate reaction severity or premedication; it routes the stated flag.',
    },
    {
      id: 'R-SAFE-005',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 14,
      kind: 'safety_screening',
      safetyCritical: true,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'intent.ageBand', value: 'pediatric' },
          { op: 'eq', field: 'candidate.modality', value: 'MR' },
        ],
      },
      effect: {
        kind: 'block_and_escalate',
        escalationMessage:
          'Rule PED-03: pediatric MR requests are coordinated by the Pediatric Imaging Coordinator (x4470), who confirms sedation planning and slot type. Do not schedule from this workbench.',
      },
      explanation: 'Configured routing rule for pediatric MR coordination.',
    },

    /* ================= REQUIREMENTS (100–199) ================= */
    {
      id: 'R-REQ-001',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 100,
      kind: 'requirement',
      safetyCritical: false,
      conditions: {
        op: 'in',
        field: 'candidate.bodyRegion',
        values: ['knee', 'shoulder', 'foot', 'wrist', 'lower_extremity', 'breast'],
      },
      effect: {
        kind: 'require_field',
        field: 'intent.laterality',
        question: 'Which side? (left, right, or bilateral)',
      },
      explanation: 'Configured requirement: extremity and breast studies are side-specific.',
    },
    {
      id: 'R-REQ-002',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 110,
      kind: 'requirement',
      safetyCritical: false,
      conditions: { op: 'in', field: 'candidate.modality', values: ['MR', 'CT'] },
      effect: {
        kind: 'require_field',
        field: 'intent.contrast',
        question:
          'Does the order specify with contrast, without contrast, or with and without? Read it from the order rather than assuming.',
      },
      explanation:
        'Configured requirement: MR and CT visit types are contrast-specific and must match the order.',
    },
    {
      id: 'R-REQ-003',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 120,
      kind: 'requirement',
      safetyCritical: false,
      conditions: { op: 'eq', field: 'candidate.modality', value: 'NM' },
      effect: {
        kind: 'require_field',
        field: 'intent.referringProvider',
        question: 'Nuclear medicine studies require the ordering provider on the request.',
      },
      explanation: 'Configured requirement for nuclear medicine ordering provider capture.',
    },

    /* ================= CONSTRAINTS / REJECTIONS (200–299) ================= */
    {
      id: 'R-REJ-001',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 200,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'candidate.contrast', value: 'without' },
          { op: 'in', field: 'intent.contrast', values: ['with', 'with_and_without'] },
        ],
      },
      effect: {
        kind: 'reject_candidate',
        reason: 'Order specifies contrast; this visit type is without contrast.',
      },
      explanation: 'Contrast protocol on the visit type must match the order.',
    },
    {
      id: 'R-REJ-002',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 201,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'candidate.contrast', value: 'with' },
          { op: 'in', field: 'intent.contrast', values: ['without', 'with_and_without'] },
        ],
      },
      effect: { kind: 'reject_candidate', reason: 'Contrast protocol does not match the order.' },
      explanation: 'Contrast protocol on the visit type must match the order.',
    },
    {
      id: 'R-REJ-003',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 202,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'candidate.contrast', value: 'with_and_without' },
          { op: 'in', field: 'intent.contrast', values: ['with', 'without'] },
        ],
      },
      effect: { kind: 'reject_candidate', reason: 'Contrast protocol does not match the order.' },
      explanation: 'Contrast protocol on the visit type must match the order.',
    },
    {
      id: 'R-REJ-004',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 210,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'candidate.laterality', value: 'bilateral' },
          { op: 'in', field: 'intent.laterality', values: ['left', 'right'] },
        ],
      },
      effect: {
        kind: 'reject_candidate',
        reason: 'This visit type is bilateral; the request specifies a single side.',
      },
      explanation: 'Laterality on the visit type must match the request.',
    },
    {
      id: 'R-REJ-005',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 220,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'intent.ageBand', value: 'pediatric' },
          { op: 'not', of: { op: 'contains', field: 'candidate.ageBands', value: 'pediatric' } },
        ],
      },
      effect: {
        kind: 'reject_candidate',
        reason: 'This visit type is not configured for pediatric patients.',
      },
      explanation: 'Age band on the visit type must include the requested band.',
    },
    {
      id: 'R-REJ-006',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 221,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'in', field: 'intent.ageBand', values: ['adult', 'geriatric'] },
          { op: 'not', of: { op: 'contains', field: 'candidate.ageBands', value: 'adult' } },
        ],
      },
      effect: {
        kind: 'reject_candidate',
        reason: 'This visit type is configured for pediatric patients only.',
      },
      explanation: 'Age band on the visit type must include the requested band.',
    },

    /* ================= SITE CAPABILITY (300–399) ================= */
    {
      id: 'R-CAP-001',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 300,
      kind: 'capability',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'intent.requestedLocation', value: 'northgate_annex' },
          { op: 'contains', field: 'candidate.requiredCapabilities', value: 'nuclear_medicine' },
        ],
      },
      effect: {
        kind: 'reject_candidate',
        reason: 'Northgate Annex has no nuclear medicine service. Offer Meridian Main instead.',
      },
      explanation: 'Configured site capability constraint.',
    },
    {
      id: 'R-CAP-002',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 301,
      kind: 'capability',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'intent.requestedLocation', value: 'northgate_annex' },
          { op: 'contains', field: 'candidate.requiredCapabilities', value: 'wide_bore_mr' },
        ],
      },
      effect: {
        kind: 'reject_candidate',
        reason: 'Northgate Annex has no MR scanner. Offer Meridian Main instead.',
      },
      explanation: 'Configured site capability constraint.',
    },
    {
      id: 'R-CAP-003',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 302,
      kind: 'capability',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'intent.requestedLocation', value: 'northgate_annex' },
          { op: 'contains', field: 'candidate.requiredCapabilities', value: 'mammography' },
        ],
      },
      effect: {
        kind: 'reject_candidate',
        reason: 'Northgate Annex has no mammography service. Offer Meridian Main instead.',
      },
      explanation: 'Configured site capability constraint.',
    },

    /* ================= PREPARATION (400–499) ================= */
    {
      id: 'R-PREP-001',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 400,
      kind: 'preparation',
      safetyCritical: false,
      conditions: {
        op: 'all',
        of: [
          { op: 'eq', field: 'candidate.modality', value: 'US' },
          { op: 'eq', field: 'candidate.bodyRegion', value: 'abdomen' },
        ],
      },
      effect: {
        kind: 'add_instruction',
        instruction:
          'Nothing to eat or drink for 8 hours before the appointment (configured prep PREP-22).',
      },
      explanation: 'Configured preparation instruction issued verbatim to the scheduler.',
    },
    {
      id: 'R-PREP-002',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 401,
      kind: 'preparation',
      safetyCritical: false,
      conditions: { op: 'in', field: 'candidate.contrast', values: ['with', 'with_and_without'] },
      effect: {
        kind: 'add_instruction',
        instruction: 'Arrive 30 minutes early for IV placement (configured prep PREP-05).',
      },
      explanation: 'Configured preparation instruction issued verbatim to the scheduler.',
    },
    {
      id: 'R-PREP-003',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 402,
      kind: 'preparation',
      safetyCritical: false,
      conditions: { op: 'eq', field: 'candidate.modality', value: 'MG' },
      effect: {
        kind: 'add_instruction',
        instruction:
          'No deodorant, powder, or lotion on the day of the exam (configured prep PREP-31).',
      },
      explanation: 'Configured preparation instruction issued verbatim to the scheduler.',
    },
    {
      id: 'R-PREP-004',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 403,
      kind: 'preparation',
      safetyCritical: false,
      conditions: { op: 'eq', field: 'candidate.modality', value: 'NM' },
      effect: {
        kind: 'add_instruction',
        instruction:
          'Two-part appointment: injection, then imaging after the configured delay. Confirm the patient can return (configured prep PREP-40).',
      },
      explanation: 'Configured preparation instruction issued verbatim to the scheduler.',
    },

    /* ================= ALLOW (900+) ================= */
    {
      id: 'R-ALLOW-001',
      ruleSetId: 'RS-MERIDIAN-IMAGING',
      priority: 900,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: { op: 'eq', field: 'candidate.specialty', value: 'imaging' },
      effect: { kind: 'allow_candidate' },
      explanation: 'Imaging visit types are in scope for the central scheduling workbench.',
    },
  ],
};

const NORTHGATE_RULESET_INPUT = {
  id: 'RS-NORTHGATE-ORTHO',
  tenantId: 'northgate-ortho',
  version: 1,
  status: 'approved',
  effectiveAt: '2026-01-01T00:00:00.000Z',
  reviewAt: '2027-01-01T00:00:00.000Z',
  approvedBy: 'J. Fairbanks, Practice Administrator (fictional)',
  authoredBy: 'J. Fairbanks, Practice Administrator (fictional)',
  clinicalApprover: null,
  sourceRef: 'NGO-SCHED-2026 rev1 (fictional internal standard)',
  schemaVersion: '1.0.0',
  supersedes: null,
  rules: [
    {
      id: 'R-NG-REQ-001',
      ruleSetId: 'RS-NORTHGATE-ORTHO',
      priority: 100,
      kind: 'requirement',
      safetyCritical: false,
      conditions: { op: 'in', field: 'candidate.bodyRegion', values: ['knee', 'shoulder'] },
      effect: {
        kind: 'require_field',
        field: 'intent.laterality',
        question: 'Which side? (left, right, or bilateral)',
      },
      explanation: 'Configured requirement: extremity studies are side-specific.',
    },
    {
      id: 'R-NG-ALLOW-001',
      ruleSetId: 'RS-NORTHGATE-ORTHO',
      priority: 900,
      kind: 'eligibility',
      safetyCritical: false,
      conditions: { op: 'eq', field: 'candidate.specialty', value: 'orthopedics' },
      effect: { kind: 'allow_candidate' },
      explanation: 'Orthopedic visit types are in scope.',
    },
  ],
};

export const MERIDIAN_RULESET: RuleSet = validateRuleSet(MERIDIAN_RULESET_INPUT);
export const NORTHGATE_RULESET: RuleSet = validateRuleSet(NORTHGATE_RULESET_INPUT);

export const RULE_SETS: Readonly<Record<string, RuleSet>> = {
  'meridian-imaging': MERIDIAN_RULESET,
  'northgate-ortho': NORTHGATE_RULESET,
};

/** Rule sets that intentionally fail validation, used by the adversarial suite. */
export const INVALID_RULE_SET_INPUTS: Readonly<Record<string, unknown>> = {
  unknown_operator: {
    ...MERIDIAN_RULESET_INPUT,
    rules: [
      {
        ...MERIDIAN_RULESET_INPUT.rules[5],
        id: 'R-BAD-OP',
        conditions: { op: 'regex', field: 'intent.procedureText', value: '.*' },
      },
    ],
  },
  unknown_field: {
    ...MERIDIAN_RULESET_INPUT,
    rules: [
      {
        ...MERIDIAN_RULESET_INPUT.rules[5],
        id: 'R-BAD-FIELD',
        conditions: { op: 'exists', field: 'intent.patientName' },
      },
    ],
  },
  safety_rule_without_clinical_approver: {
    ...MERIDIAN_RULESET_INPUT,
    clinicalApprover: null,
  },
  safety_rule_self_approved: {
    ...MERIDIAN_RULESET_INPUT,
    clinicalApprover: MERIDIAN_RULESET_INPUT.authoredBy,
  },
  self_supersession: { ...MERIDIAN_RULESET_INPUT, supersedes: 'RS-MERIDIAN-IMAGING' },
  review_before_effective: {
    ...MERIDIAN_RULESET_INPUT,
    reviewAt: '2025-01-01T00:00:00.000Z',
  },
};
