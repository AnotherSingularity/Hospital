import type { ScoreComponent, SchedulingIntent, VisitType } from '@cadence/domain';
import { normalizeText, tokenize } from './intent-parser.js';

/**
 * Retrieval proposes candidates. It never decides.
 *
 * Every candidate returned is an object drawn from the tenant catalog, so a
 * visit-type identifier cannot be fabricated: there is no code path that
 * constructs one. Ranking is a transparent sum of named components, not an
 * opaque similarity number.
 */

export interface RetrievalCandidate {
  visitType: VisitType;
  score: number;
  components: ScoreComponent[];
}

export interface CandidateRetriever {
  readonly name: string;
  retrieve(
    intent: SchedulingIntent,
    catalog: readonly VisitType[],
    modality: string | undefined,
    limit: number,
  ): RetrievalCandidate[];
}

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'for',
  'of',
  'to',
  'and',
  'with',
  'without',
  'please',
  'need',
  'needs',
  'patient',
  'order',
  'ordered',
  'schedule',
  'scheduling',
  'appointment',
  'wants',
  'want',
  'his',
  'her',
  'their',
  'is',
  'has',
  'have',
  'on',
  'in',
  'at',
]);

function contentTokens(text: string): string[] {
  return tokenize(normalizeText(text)).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

export const SCORE_WEIGHTS = {
  aliasExact: 50,
  aliasPartial: 18,
  nameToken: 3,
  modality: 12,
  bodyRegion: 15,
  contrast: 10,
  laterality: 4,
  specialty: 2,
  /**
   * Explicit contradiction penalties. A request that names a modality or an
   * anatomic region is making a positive statement; a candidate that contradicts
   * it is not a weak match, it is a different exam. Without these, "bone scan"
   * surfaces a DEXA and "wrist x-ray" surfaces a chest film purely on the shared
   * word "x-ray" -- both observed in the first evaluation run.
   */
  modalityMismatch: -25,
  bodyRegionMismatch: -25,
} as const;

export class LexicalRetriever implements CandidateRetriever {
  public readonly name = 'lexical-v1';

  retrieve(
    intent: SchedulingIntent,
    catalog: readonly VisitType[],
    modality: string | undefined,
    limit: number,
  ): RetrievalCandidate[] {
    const queryNorm = normalizeText(intent.procedureText);
    const queryTokens = new Set(contentTokens(intent.procedureText));

    const scored: RetrievalCandidate[] = [];

    for (const visitType of catalog) {
      // Retired entries are never proposed.
      if (!visitType.active) continue;

      const components: ScoreComponent[] = [];
      let score = 0;

      const exactAlias = visitType.aliases.find((a) => normalizeText(a) === queryNorm);
      if (exactAlias !== undefined) {
        score += SCORE_WEIGHTS.aliasExact;
        components.push({
          label: 'Exact alias match',
          points: SCORE_WEIGHTS.aliasExact,
          detail: exactAlias,
        });
      } else {
        const containedAlias = visitType.aliases.find(
          (a) => queryNorm.includes(normalizeText(a)) && normalizeText(a).length >= 3,
        );
        if (containedAlias !== undefined) {
          score += SCORE_WEIGHTS.aliasPartial;
          components.push({
            label: 'Alias found in request',
            points: SCORE_WEIGHTS.aliasPartial,
            detail: containedAlias,
          });
        }
      }

      const nameTokens = new Set(contentTokens(visitType.displayName));
      let overlap = 0;
      for (const t of nameTokens) if (queryTokens.has(t)) overlap += 1;
      if (overlap > 0) {
        const pts = overlap * SCORE_WEIGHTS.nameToken;
        score += pts;
        components.push({
          label: 'Name term overlap',
          points: pts,
          detail: `${overlap} matching term${overlap === 1 ? '' : 's'}`,
        });
      }

      if (modality !== undefined && visitType.modality !== undefined) {
        if (visitType.modality === modality) {
          score += SCORE_WEIGHTS.modality;
          components.push({
            label: 'Modality match',
            points: SCORE_WEIGHTS.modality,
            detail: modality,
          });
        } else {
          score += SCORE_WEIGHTS.modalityMismatch;
          components.push({
            label: 'Modality mismatch',
            points: SCORE_WEIGHTS.modalityMismatch,
            detail: `request says ${modality}, visit type is ${visitType.modality}`,
          });
        }
      }

      if (intent.bodyRegion !== undefined && visitType.bodyRegion !== undefined) {
        if (visitType.bodyRegion === intent.bodyRegion) {
          score += SCORE_WEIGHTS.bodyRegion;
          components.push({
            label: 'Body region match',
            points: SCORE_WEIGHTS.bodyRegion,
            detail: intent.bodyRegion,
          });
        } else {
          score += SCORE_WEIGHTS.bodyRegionMismatch;
          components.push({
            label: 'Body region mismatch',
            points: SCORE_WEIGHTS.bodyRegionMismatch,
            detail: `request says ${intent.bodyRegion}, visit type is ${visitType.bodyRegion}`,
          });
        }
      }

      if (intent.contrast !== undefined && visitType.contrast === intent.contrast) {
        score += SCORE_WEIGHTS.contrast;
        components.push({
          label: 'Contrast protocol match',
          points: SCORE_WEIGHTS.contrast,
          detail: intent.contrast,
        });
      }

      if (
        intent.laterality !== undefined &&
        visitType.laterality !== undefined &&
        visitType.laterality === intent.laterality
      ) {
        score += SCORE_WEIGHTS.laterality;
        components.push({
          label: 'Laterality match',
          points: SCORE_WEIGHTS.laterality,
          detail: intent.laterality,
        });
      }

      if (intent.specialty !== undefined && visitType.specialty === intent.specialty) {
        score += SCORE_WEIGHTS.specialty;
        components.push({ label: 'Specialty match', points: SCORE_WEIGHTS.specialty });
      }

      if (score > 0) scored.push({ visitType, score, components });
    }

    // Total order: score desc, then id asc. Guarantees deterministic repeatability.
    scored.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.visitType.id.localeCompare(b.visitType.id),
    );

    return scored.slice(0, limit);
  }
}

/**
 * Vector retrieval is OPTIONAL and sits behind this same interface (P0.3).
 * It may only ever add candidates drawn from the tenant catalog. It is not
 * implemented in MVP0 and is disabled.
 */
export class VectorRetrieverStub implements CandidateRetriever {
  public readonly name = 'vector-stub-disabled';

  retrieve(): RetrievalCandidate[] {
    throw new Error(
      'VectorRetrieverStub is disabled in MVP0. Enabling it requires re-running the evaluation gates.',
    );
  }
}
