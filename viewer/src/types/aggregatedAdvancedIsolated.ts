/**
 * Aggregated statistics for a single criterion of an item, comparing scores from
 * isolated evaluation vs. holistic evaluation, averaged over multiple models.
 */
export interface AggregatedIsolatedHolisticCriterionStats {
  criterionName: string;
  averageScoreIsolated: number | null;
  stdDevScoreIsolated: number | null;
  modelCountIsolated: number; // Models contributing to isolated score for this criterion

  averageScoreHolistic: number | null;
  stdDevScoreHolistic: number | null;
  modelCountHolistic: number; // Models contributing to holistic score for this criterion

  // Delta: avgScoreIsolated - avgScoreHolistic
  // Positive delta: score tends to be higher when criterion is isolated.
  // Negative delta: score tends to be lower when criterion is isolated (or higher in holistic).
  deltaAverageScore: number | null; 
}

/**
 * Summary for a single item, showing how scores for its criteria changed when evaluated
 * in isolation versus holistically, aggregated across multiple models.
 */
export interface AggregatedIsolatedItemSummary {
  itemId: string;
  itemTitle?: string;
  // List of comparison stats for each criterion evaluated for this item
  criteriaComparisonStats: AggregatedIsolatedHolisticCriterionStats[];
}

/**
 * Top-level structure for the aggregated summary of an Advanced Isolated vs. Holistic Multi-Criteria experiment
 * across multiple models.
 */
export interface AggregatedAdvancedIsolatedOverallSummary {
  experimentType: 'adv_multi_criteria_isolated';
  taskName: string; // e.g., "Argument", "StoryOpening"
  overallModelCount: number; // Total unique models contributing to this aggregation
  // List of summaries for each item processed in this experiment type
  itemSummaries: AggregatedIsolatedItemSummary[];
} 