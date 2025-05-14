/**
 * Statistics for a single item aggregated across multiple models for a specific ELO variant.
 */
export interface AggregatedEloItemStats {
  item_id: string;
  item_text_snippet?: string; // Snippet of the item text for quick identification
  modelCount: number; // Number of models that included this item in this ELO variant
  averageEloRating: number | null;
  stdDevEloRating: number | null;
  averageRank: number | null;
  stdDevRank: number | null;
  totalWins: number;
  totalLosses: number;
  totalTies: number;
  // Potentially store all individual ELOs/ranks if detailed distribution is needed later
  // allEloRatings?: (number | null)[]; 
  // allRanks?: (number | null)[];
}

/**
 * Summary for a single ELO variant, aggregated across multiple models.
 */
export interface AggregatedEloVariantSummary {
  variantName: string;
  modelCountOverall: number; // Total unique models that ran this variant
  itemCountOverall: number; // Total unique items ranked in this variant across all models
  // Overall aggregate ELO/rank stats for the variant (if meaningful - might be less so than per-item)
  // averageEloAcrossAllItemsAndModels?: number | null; 
  // stdDevEloAcrossAllItemsAndModels?: number | null;
  itemsAggregatedStats: AggregatedEloItemStats[];
}

/**
 * Top-level structure for the aggregated summary of a Pairwise ELO experiment across multiple models.
 */
export interface AggregatedEloOverallSummary {
  experimentType: 'pairwise_elo';
  overallModelCount: number; // Total unique models contributing to this ELO aggregation
  overallUniqueItemsRanked: number; // Total unique items ranked across all variants and models
  // Might include overall criterion if consistent, e.g., haiku_set.criterion
  criterion?: string | null; 
  rankingSetId?: string | null;
  variantsSummaries: AggregatedEloVariantSummary[];
} 