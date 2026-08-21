import { SchedulingIntentSchema, type ParseEvidence, type SchedulingIntent } from '@cadence/domain';

/**
 * IntentParser turns free text into an explicit, validated schema.
 *
 * It extracts what was STATED. It never infers clinical facts, never invents a
 * device flag, and never produces a catalog identifier. Extraction failure is
 * represented as an absent field, which downstream rules convert into
 * `needs_information` — not into a guess.
 */

export interface ParsedIntent {
  intent: SchedulingIntent;
  evidence: ParseEvidence[];
}

export interface IntentParser {
  readonly name: string;
  parse(text: string, hints?: Partial<SchedulingIntent>): ParsedIntent;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

// Zero-width, bidi override, and other format characters used in adversarial input.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
// Stripping control characters is the point: adversarial input uses them to hide
// tokens from a naive tokenizer, so the class below is deliberate.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizeText(raw: string): string {
  return (
    raw
      .normalize('NFKD')
      // Combining marks are stripped: a diacritic injected into "thyroid" must not
      // defeat alias matching, and must not create a distinct token either.
      .replace(/[\u0300-\u036F]/g, '')
      .normalize('NFKC')
      .replace(INVISIBLE, '')
      .replace(CONTROL, ' ')
      .replace(/[\u2010-\u2015]/g, '-')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function tokenize(normalized: string): string[] {
  return normalized
    .replace(/[^a-z0-9\-/ ]+/g, ' ')
    .split(/[\s/]+/)
    .filter((t) => t.length > 0);
}

/* ------------------------------------------------------------------ */
/* Lexicons (configured vocabulary, not model output)                  */
/* ------------------------------------------------------------------ */

const MODALITY_TERMS: ReadonlyArray<[string, string]> = [
  ['mri', 'MR'],
  ['mr', 'MR'],
  ['magnetic resonance', 'MR'],
  ['ct angiogram', 'CT'],
  ['cta', 'CT'],
  ['ct', 'CT'],
  ['cat scan', 'CT'],
  ['ultrasound', 'US'],
  ['ultra sound', 'US'],
  ['sonogram', 'US'],
  ['sono', 'US'],
  ['doppler', 'US'],
  ['duplex', 'US'],
  ['us', 'US'],
  ['x-ray', 'XR'],
  ['xray', 'XR'],
  ['x ray', 'XR'],
  ['radiograph', 'XR'],
  ['cxr', 'XR'],
  ['mammogram', 'MG'],
  ['mammo', 'MG'],
  ['bone scan', 'NM'],
  ['hida', 'NM'],
  ['nuclear medicine', 'NM'],
  ['dexa', 'DEXA'],
  ['dxa', 'DEXA'],
  ['bone density', 'DEXA'],
];

const BODY_REGION_TERMS: ReadonlyArray<[string, string]> = [
  ['lumbar spine', 'lumbar_spine'],
  ['l-spine', 'lumbar_spine'],
  ['lspine', 'lumbar_spine'],
  ['lumbar', 'lumbar_spine'],
  ['lumber', 'lumbar_spine'], // common misspelling, configured alias
  ['cervical spine', 'cervical_spine'],
  ['c-spine', 'cervical_spine'],
  ['cspine', 'cervical_spine'],
  ['cervical', 'cervical_spine'],
  ['brain', 'brain'],
  ['head', 'brain'],
  ['knee', 'knee'],
  ['shoulder', 'shoulder'],
  ['abdomen', 'abdomen'],
  ['abdominal', 'abdomen'],
  ['abd', 'abdomen'],
  ['belly', 'abdomen'],
  ['pelvis', 'pelvis'],
  ['pelvic', 'pelvis'],
  ['chest', 'chest'],
  ['lung', 'chest'],
  ['thyroid', 'neck'],
  ['carotid', 'neck'],
  ['neck', 'neck'],
  ['foot', 'foot'],
  ['sinus', 'sinus'],
  ['sinuses', 'sinus'],
  ['breast', 'breast'],
  ['wrist', 'wrist'],
  ['leg', 'lower_extremity'],
  ['lower extremity', 'lower_extremity'],
  ['whole body', 'whole_body'],
];

const DEVICE_FLAG_TERMS: ReadonlyArray<[string, string]> = [
  ['class a device', 'implanted_device_class_a'],
  ['class a implant', 'implanted_device_class_a'],
  ['implanted device class a', 'implanted_device_class_a'],
  ['metal fragment screen pending', 'metal_fragment_screen_pending'],
  ['screening pending', 'metal_fragment_screen_pending'],
  ['metal screen pending', 'metal_fragment_screen_pending'],
  ['contrast reaction on file', 'contrast_reaction_history_flagged'],
  ['prior contrast reaction', 'contrast_reaction_history_flagged'],
  ['contrast reaction history', 'contrast_reaction_history_flagged'],
  ['screening complete none reported', 'screening_complete_none_reported'],
  ['screening clear', 'screening_complete_none_reported'],
  ['no devices reported', 'screening_complete_none_reported'],
];

const LOCATION_TERMS: ReadonlyArray<[string, string]> = [
  ['northgate annex', 'northgate_annex'],
  ['the annex', 'northgate_annex'],
  ['annex', 'northgate_annex'],
  ['meridian main', 'meridian_main'],
  ['main campus', 'meridian_main'],
];

function firstMatch(
  haystack: string,
  terms: ReadonlyArray<[string, string]>,
): { term: string; value: string } | null {
  // Longest term first so "lumbar spine" wins over "lumbar".
  const ordered = [...terms].sort((a, b) => b[0].length - a[0].length);
  for (const [term, value] of ordered) {
    const pattern = new RegExp(
      `(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([^a-z0-9]|$)`,
    );
    if (pattern.test(haystack)) return { term, value };
  }
  return null;
}

function allMatches(
  haystack: string,
  terms: ReadonlyArray<[string, string]>,
): Array<{ term: string; value: string }> {
  const out: Array<{ term: string; value: string }> = [];
  const seen = new Set<string>();
  const ordered = [...terms].sort((a, b) => b[0].length - a[0].length);
  for (const [term, value] of ordered) {
    if (seen.has(value)) continue;
    const pattern = new RegExp(
      `(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([^a-z0-9]|$)`,
    );
    if (pattern.test(haystack)) {
      out.push({ term, value });
      seen.add(value);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Deterministic parser                                                */
/* ------------------------------------------------------------------ */

export class DeterministicIntentParser implements IntentParser {
  public readonly name = 'deterministic-lexicon-v1';

  parse(text: string, hints?: Partial<SchedulingIntent>): ParsedIntent {
    const normalized = normalizeText(text);
    const evidence: ParseEvidence[] = [];
    const draft: Record<string, unknown> = { procedureText: normalized, deviceFlags: [] };

    // Contrast. Contradictory statements leave the field ABSENT so that a
    // requirement rule turns it into a question. The parser never picks a winner
    // between two conflicting statements in the request.
    const wwo = /\bwith and without\b|\bwwo\b/.test(normalized);
    if (wwo) {
      draft.contrast = 'with_and_without';
      evidence.push({ field: 'contrast', matchedToken: 'with and without', method: 'pattern' });
    } else {
      const saysWithout =
        /\bwithout contrast\b|\bw\/o contrast\b|\bnon-?contrast\b|\bno contrast\b/.test(
          normalized,
        ) ||
        // Configured abbreviations used on the catalog's own aliases.
        /(^|[^a-z0-9])(wo|w\/o)([^a-z0-9]|$)/.test(normalized);
      const saysWith = /\bwith contrast\b|\bcontrast enhanced\b|\bw\/ contrast\b/.test(normalized);
      if (saysWith && saysWithout) {
        evidence.push({
          field: 'contrast_conflict',
          matchedToken: 'with + without',
          method: 'pattern',
        });
      } else if (saysWithout) {
        draft.contrast = 'without';
        evidence.push({ field: 'contrast', matchedToken: 'without contrast', method: 'pattern' });
      } else if (saysWith) {
        draft.contrast = 'with';
        evidence.push({ field: 'contrast', matchedToken: 'with contrast', method: 'pattern' });
      }
    }

    // Laterality. Same contradiction handling.
    const saysBilateral = /\bbilateral\b|\bboth sides\b|\bboth\b/.test(normalized);
    const saysLeft = /(^|[^a-z])(left|lt)([^a-z]|$)/.test(normalized);
    const saysRight = /(^|[^a-z])(right|rt)([^a-z]|$)/.test(normalized);
    const lateralitySignals = [saysBilateral, saysLeft, saysRight].filter(Boolean).length;
    if (lateralitySignals > 1) {
      evidence.push({
        field: 'laterality_conflict',
        matchedToken: 'multiple sides',
        method: 'pattern',
      });
    } else if (saysBilateral) {
      draft.laterality = 'bilateral';
      evidence.push({ field: 'laterality', matchedToken: 'bilateral', method: 'keyword' });
    } else if (saysLeft) {
      draft.laterality = 'left';
      evidence.push({ field: 'laterality', matchedToken: 'left', method: 'keyword' });
    } else if (saysRight) {
      draft.laterality = 'right';
      evidence.push({ field: 'laterality', matchedToken: 'right', method: 'keyword' });
    }

    // Age band.
    if (/\bpediatric\b|\bpeds\b|\bchild\b|\binfant\b|\btoddler\b/.test(normalized)) {
      draft.ageBand = 'pediatric';
      evidence.push({ field: 'ageBand', matchedToken: 'pediatric', method: 'keyword' });
    } else if (/\bgeriatric\b/.test(normalized)) {
      draft.ageBand = 'geriatric';
      evidence.push({ field: 'ageBand', matchedToken: 'geriatric', method: 'keyword' });
    }

    // Body region.
    const region = firstMatch(normalized, BODY_REGION_TERMS);
    if (region !== null) {
      draft.bodyRegion = region.value;
      evidence.push({ field: 'bodyRegion', matchedToken: region.term, method: 'alias' });
    }

    // Modality is captured as parse evidence and used for scoring; it is not a
    // SchedulingIntent field, so it is recorded on evidence only.
    const modality = firstMatch(normalized, MODALITY_TERMS);
    if (modality !== null) {
      evidence.push({ field: 'modality', matchedToken: modality.term, method: 'alias' });
    }

    // Device flags: only exact configured vocabulary. Nothing is inferred.
    const flags = allMatches(normalized, DEVICE_FLAG_TERMS).map((m) => {
      evidence.push({ field: 'deviceFlags', matchedToken: m.term, method: 'alias' });
      return m.value;
    });
    draft.deviceFlags = flags;

    // Referring provider.
    const provider = /\b(?:dr\.?|doctor|referred by|ordering)\s+([a-z][a-z'-]{1,40})/.exec(
      normalized,
    );
    if (provider?.[1] !== undefined) {
      draft.referringProvider = provider[1];
      evidence.push({ field: 'referringProvider', matchedToken: provider[1], method: 'pattern' });
    }

    // Location.
    const location = firstMatch(normalized, LOCATION_TERMS);
    if (location !== null) {
      draft.requestedLocation = location.value;
      evidence.push({ field: 'requestedLocation', matchedToken: location.term, method: 'alias' });
    }

    // Time window.
    const window = /\b(morning|afternoon|evening|weekend|next week|this week|asap)\b/.exec(
      normalized,
    );
    if (window?.[1] !== undefined) {
      draft.requestedTimeWindow = window[1];
      evidence.push({ field: 'requestedTimeWindow', matchedToken: window[1], method: 'pattern' });
    }

    draft.specialty = 'imaging';
    evidence.push({ field: 'specialty', matchedToken: 'imaging', method: 'default' });

    // Hints (from the workbench answering a missing-information prompt) are applied
    // last and override parsed values, because a human supplied them explicitly.
    if (hints !== undefined) {
      for (const [key, value] of Object.entries(hints)) {
        if (value === undefined || key === 'procedureText') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        draft[key] = value;
        evidence.push({ field: key, matchedToken: 'operator-supplied', method: 'default' });
      }
    }

    return { intent: SchedulingIntentSchema.parse(draft), evidence };
  }
}

/**
 * Placeholder for a future model-backed parser. DISABLED.
 *
 * A model adapter may only ever populate the same validated SchedulingIntent
 * schema. It must never emit a catalog identifier, a resolution state, or a
 * confidence value used as authorization. See docs/safety-case.md H-04.
 */
export class ModelIntentParserStub implements IntentParser {
  public readonly name = 'model-adapter-stub-disabled';

  parse(): ParsedIntent {
    throw new Error(
      'ModelIntentParserStub is disabled. MVP0 requires deterministic parsing; enabling a model adapter requires a documented safety review.',
    );
  }
}
