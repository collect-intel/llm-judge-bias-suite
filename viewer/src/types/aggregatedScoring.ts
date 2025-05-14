// viewer/src/types/aggregatedScoring.ts

// From original ScoringExperimentData structure in scoringExperiment.ts (for reference)
interface ScoringRepetitionDetail {
    repetition_index: number;
    raw_score_from_llm: any; // Can be string, number, etc. before parsing
    normalized_score: number | null;
    raw_llm_response: string;
  }
  
interface ScoringItemResult {
    item_id: string;
    item_title?: string | null;
    item_text_snippet: string;
    dataset_name: string; // To know which dataset this item belonged to
    expected_scores?: string | null; // Or a more structured type if available
    repetitions: ScoringRepetitionDetail[];
    avg_normalized_score_for_item: number | null;
    std_dev_normalized_score_for_item: number | null;
    error_message?: string;
}

// --- Interfaces for Aggregated Scoring Experiment Data ---

// Aggregated stats for a single item across all models for a specific variant
export interface AggregatedScoringItemStats {
    item_id: string;
    item_title?: string | null;
    item_text_snippet: string;
    dataset_name: string; 
    modelCount: number; // Number of models that provided data for this item-variant
    averageNormalizedScore: number | null;
    stdDevNormalizedScore: number | null;
    // Score distribution: count of models for each normalized score (e.g., {1: 2, 2: 5, ...})
    // For simplicity, we might initially focus on avg/std dev, but distribution is powerful.
    // For now, let's store all individual normalized scores from all models for this item-variant
    allNormalizedScores: (number | null)[]; 
    // Could also add: average raw score if applicable, error rate across models for this item
}

// Aggregated summary for a single scoring variant across all items and models
export interface AggregatedScoringVariantSummary {
    variantName: string; // e.g., "Poems: 1-5 (user prompt)"
    variantConfig?: any; // Could store a snippet of the variant config if useful
    modelCountOverall: number; // Total models that participated in this variant
    itemCountOverall: number; // Total unique items scored under this variant
    
    // Overall Averages for this variant across all items & models
    overallAverageNormalizedScore: number | null;
    overallStdDevNormalizedScore: number | null;

    // Per-item aggregated stats under this variant
    itemsAggregatedStats: AggregatedScoringItemStats[];
}

// Top-level summary for the entire aggregated scoring experiment data
export interface AggregatedScoringOverallSummary {
    experimentType: 'scoring'; // To identify the type of aggregated data
    overallModelCount: number; // Total unique models in this entire aggregation
    overallUniqueItemsScored: number; // Total unique items scored across all variants/models
    variantsSummaries: AggregatedScoringVariantSummary[];
}
// --- End Interfaces for Aggregated Scoring Experiment Data --- 