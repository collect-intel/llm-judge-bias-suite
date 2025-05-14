/**
 * Aggregated statistics for a single criterion of an item across different presentation orders,
 * averaged over multiple models.
 */
export interface AggregatedPermutedCriterionOrderStats {
  orderName: string; // e.g., "OrderOriginal_Arg", "OrderReversed_Arg"
  averageScore: number | null;
  stdDevScore: number | null;
  modelCount: number; // Number of models contributing to this specific order's stats for this criterion
}

export interface AggregatedPermutedItemCriterionComparison {
  criterionName: string;
  // Stores the aggregated stats for each order this criterion was presented in.
  // Example: one entry for "OrderOriginal", one for "OrderReversed"
  scoresByOrder: AggregatedPermutedCriterionOrderStats[];
  // We might calculate and store a primary delta here if there's a clear baseline order,
  // e.g., delta = avgScoreReversed - avgScoreOriginal
  // For more than two orders, this becomes more complex.
  // For now, the display component can calculate/show deltas as needed.
}

/**
 * Summary for a single item, showing how scores for its criteria changed based on presentation order,
 * aggregated across multiple models.
 */
export interface AggregatedPermutedItemSummary {
  itemId: string;
  itemTitle?: string;
  // List of comparisons for each criterion evaluated for this item
  criteriaComparisons: AggregatedPermutedItemCriterionComparison[];
}

/**
 * Top-level structure for the aggregated summary of an Advanced Permuted Order Multi-Criteria experiment
 * across multiple models.
 */
export interface AggregatedAdvancedPermutedOverallSummary {
  experimentType: 'adv_multi_criteria_permuted';
  taskName: string; // e.g., "Argument", "StoryOpening"
  overallModelCount: number; // Total unique models contributing to this aggregation
  // List of summaries for each item processed in this experiment type
  itemSummaries: AggregatedPermutedItemSummary[];
} 