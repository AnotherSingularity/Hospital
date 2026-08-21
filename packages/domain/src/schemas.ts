import { z } from 'zod';

/**
 * Cadence Overlay Resolver — domain schemas.
 *
 * SYNTHETIC DATA ONLY. These schemas describe a fictional catalog used to test a
 * constrained resolver. They are not authorized to carry PHI. See docs/data-governance.md.
 */

export const SCHEMA_VERSION = '1.0.0' as const;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const TenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'tenant id must be lowercase kebab-case');

export const IdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'identifier contains unsupported characters');

export const LateralitySchema = z.enum(['left', 'right', 'bilateral', 'not_applicable']);
export const ContrastSchema = z.enum(['with', 'without', 'with_and_without', 'not_applicable']);
export const AgeBandSchema = z.enum(['pediatric', 'adult', 'geriatric']);

/* ------------------------------------------------------------------ */
/* Tenant, catalog, departments                                        */
/* ------------------------------------------------------------------ */

export const TenantSchema = z.object({
  id: TenantIdSchema,
  name: z.string().min(1).max(128),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const VisitTypeSchema = z.object({
  id: IdSchema,
  tenantId: TenantIdSchema,
  code: z.string().min(1).max(32),
  displayName: z.string().min(1).max(160),
  durationMinutes: z.number().int().min(5).max(480),
  specialty: z.string().min(1).max(64),
  active: z.boolean(),
  version: z.number().int().min(1),
  // Attributes addressable by rules as candidate.<key>
  bodyRegion: z.string().min(1).max(64).optional(),
  laterality: LateralitySchema.optional(),
  contrast: ContrastSchema.optional(),
  modality: z.string().min(1).max(32).optional(),
  ageBands: z.array(AgeBandSchema).default(['adult']),
  requiredCapabilities: z.array(z.string().min(1).max(48)).default([]),
  aliases: z.array(z.string().min(1).max(120)).default([]),
});
export type VisitType = z.infer<typeof VisitTypeSchema>;

export const DepartmentSchema = z.object({
  id: IdSchema,
  tenantId: TenantIdSchema,
  name: z.string().min(1).max(128),
  capabilities: z.array(z.string().min(1).max(48)).default([]),
});
export type Department = z.infer<typeof DepartmentSchema>;

/* ------------------------------------------------------------------ */
/* Rule expression grammar (allowlisted)                               */
/* ------------------------------------------------------------------ */

export const MAX_CONDITION_DEPTH = 6;
export const MAX_CONDITION_NODES = 128;

/** Fields a rule may address. Anything outside this list is rejected at validation time. */
export const ADDRESSABLE_INTENT_FIELDS = [
  'intent.procedureText',
  'intent.bodyRegion',
  'intent.laterality',
  'intent.contrast',
  'intent.referringProvider',
  'intent.specialty',
  'intent.ageBand',
  'intent.deviceFlags',
  'intent.requestedLocation',
  'intent.requestedTimeWindow',
] as const;

export const ADDRESSABLE_CANDIDATE_FIELDS = [
  'candidate.id',
  'candidate.code',
  'candidate.specialty',
  'candidate.bodyRegion',
  'candidate.laterality',
  'candidate.contrast',
  'candidate.modality',
  'candidate.ageBands',
  'candidate.requiredCapabilities',
] as const;

export const ADDRESSABLE_FIELDS = [
  ...ADDRESSABLE_INTENT_FIELDS,
  ...ADDRESSABLE_CANDIDATE_FIELDS,
] as const;

export const FieldPathSchema = z.enum(ADDRESSABLE_FIELDS);
export type FieldPath = z.infer<typeof FieldPathSchema>;

const ScalarSchema = z.union([z.string().max(200), z.number(), z.boolean()]);

export type Condition =
  | { op: 'all'; of: Condition[] }
  | { op: 'any'; of: Condition[] }
  | { op: 'not'; of: Condition }
  | { op: 'eq'; field: FieldPath; value: string | number | boolean }
  | { op: 'in'; field: FieldPath; values: Array<string | number | boolean> }
  | { op: 'contains'; field: FieldPath; value: string }
  | { op: 'exists'; field: FieldPath };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('all'), of: z.array(ConditionSchema).min(1).max(24) }),
    z.object({ op: z.literal('any'), of: z.array(ConditionSchema).min(1).max(24) }),
    z.object({ op: z.literal('not'), of: ConditionSchema }),
    z.object({ op: z.literal('eq'), field: FieldPathSchema, value: ScalarSchema }),
    z.object({
      op: z.literal('in'),
      field: FieldPathSchema,
      values: z.array(ScalarSchema).min(1).max(64),
    }),
    z.object({
      op: z.literal('contains'),
      field: FieldPathSchema,
      value: z.string().min(1).max(200),
    }),
    z.object({ op: z.literal('exists'), field: FieldPathSchema }),
  ]),
);

export const RuleEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('require_field'),
    field: FieldPathSchema,
    question: z.string().min(1).max(240),
  }),
  z.object({ kind: z.literal('allow_candidate') }),
  z.object({ kind: z.literal('reject_candidate'), reason: z.string().min(1).max(240) }),
  z.object({
    kind: z.literal('block_and_escalate'),
    escalationMessage: z.string().min(1).max(400),
  }),
  z.object({ kind: z.literal('add_instruction'), instruction: z.string().min(1).max(400) }),
]);
export type RuleEffect = z.infer<typeof RuleEffectSchema>;

export const RuleKindSchema = z.enum([
  'requirement',
  'eligibility',
  'safety_screening',
  'capability',
  'preparation',
]);

export const RuleSchema = z.object({
  id: IdSchema,
  ruleSetId: IdSchema,
  priority: z.number().int().min(0).max(1000),
  kind: RuleKindSchema,
  conditions: ConditionSchema,
  effect: RuleEffectSchema,
  safetyCritical: z.boolean(),
  explanation: z.string().min(1).max(400),
});
export type Rule = z.infer<typeof RuleSchema>;

export const RuleSetStatusSchema = z.enum(['draft', 'in_review', 'approved', 'retired']);

export const RuleSetSchema = z.object({
  id: IdSchema,
  tenantId: TenantIdSchema,
  version: z.number().int().min(1),
  status: RuleSetStatusSchema,
  effectiveAt: z.string().datetime(),
  reviewAt: z.string().datetime(),
  approvedBy: z.string().min(1).max(128),
  sourceRef: z.string().min(1).max(240),
  schemaVersion: z.string().default(SCHEMA_VERSION),
  /** Governance: the rule set this one replaces. Must not form a cycle. */
  supersedes: IdSchema.nullable().default(null),
  /** Safety-tagged rule sets require a clinical approver distinct from the author. */
  clinicalApprover: z.string().min(1).max(128).nullable().default(null),
  authoredBy: z.string().min(1).max(128),
  rules: z.array(RuleSchema).min(1).max(500),
});
export type RuleSet = z.infer<typeof RuleSetSchema>;

/* ------------------------------------------------------------------ */
/* Scheduling intent                                                   */
/* ------------------------------------------------------------------ */

export const SchedulingIntentSchema = z.object({
  procedureText: z.string().min(1).max(600),
  bodyRegion: z.string().max(64).optional(),
  laterality: LateralitySchema.optional(),
  contrast: ContrastSchema.optional(),
  referringProvider: z.string().max(120).optional(),
  specialty: z.string().max(64).optional(),
  ageBand: AgeBandSchema.optional(),
  deviceFlags: z.array(z.string().min(1).max(48)).default([]),
  requestedLocation: z.string().max(96).optional(),
  requestedTimeWindow: z.string().max(96).optional(),
});
export type SchedulingIntent = z.infer<typeof SchedulingIntentSchema>;

export const ParseEvidenceSchema = z.object({
  field: z.string().min(1).max(48),
  matchedToken: z.string().min(1).max(120),
  method: z.enum(['alias', 'keyword', 'pattern', 'default']),
});
export type ParseEvidence = z.infer<typeof ParseEvidenceSchema>;

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export const EvidenceSchema = z.object({
  ruleId: IdSchema,
  ruleSetVersion: z.number().int().min(1),
  sourceRef: z.string().min(1).max(240),
  explanation: z.string().min(1).max(400),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ScoreComponentSchema = z.object({
  label: z.string().min(1).max(64),
  points: z.number(),
  detail: z.string().max(160).optional(),
});
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

export const CandidateSchema = z.object({
  visitTypeId: IdSchema,
  code: z.string().min(1).max(32),
  displayName: z.string().min(1).max(160),
  durationMinutes: z.number().int(),
  score: z.number(),
  components: z.array(ScoreComponentSchema),
  instructions: z.array(z.string().max(400)).default([]),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const MissingFieldSchema = z.object({
  field: FieldPathSchema,
  question: z.string().min(1).max(240),
  ruleId: IdSchema,
});
export type MissingField = z.infer<typeof MissingFieldSchema>;

export const ResolutionStateSchema = z.enum([
  'resolved',
  'needs_information',
  'ambiguous',
  'blocked',
  'no_match',
]);
export type ResolutionState = z.infer<typeof ResolutionStateSchema>;

/**
 * Precedence when multiple states could apply.
 * blocked > needs_information > no_match > ambiguous > resolved
 * Lower index wins. See docs/architecture.md ADR-003.
 */
export const STATE_PRECEDENCE: readonly ResolutionState[] = [
  'blocked',
  'needs_information',
  'no_match',
  'ambiguous',
  'resolved',
] as const;

export const ConfidenceBandSchema = z.enum(['low', 'moderate', 'high']);

export const ResolutionResultSchema = z.object({
  state: ResolutionStateSchema,
  candidates: z.array(CandidateSchema).default([]),
  missingFields: z.array(MissingFieldSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  escalationMessage: z.string().max(400).optional(),
  traceId: z.string().min(1).max(64),
  intent: SchedulingIntentSchema,
  parseEvidence: z.array(ParseEvidenceSchema).default([]),
  /**
   * Measured band from the offline benchmark. NOT a clinical guarantee and NOT
   * an authorization to resolve. See docs/safety-case.md H-07.
   */
  confidenceBand: ConfidenceBandSchema,
  separationMargin: z.number().nullable(),
  ruleSetVersion: z.number().int(),
  schemaVersion: z.string(),
});
export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;

/* ------------------------------------------------------------------ */
/* API boundary                                                        */
/* ------------------------------------------------------------------ */

export const MAX_REQUEST_TEXT_BYTES = 4096;

export const ResolveRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  hints: SchedulingIntentSchema.partial().omit({ procedureText: true }).optional(),
});
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'invalid_request',
      'unknown_tenant',
      'unauthorized',
      'payload_too_large',
      'rate_limited',
      'internal_error',
    ]),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    traceId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
