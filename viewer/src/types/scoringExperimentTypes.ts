// viewer/src/types/scoringExperimentTypes.ts

// Details for a single repetition of scoring an item
export interface ScoringRepetitionDetail {
  repetition_index: number;
  raw_score_from_llm: string | number | null; // Could be 'A', 5, 'CATEGORY_X98', etc.
  normalized_score: number | null; // Always 1-5 (or null if error)
  raw_llm_response: string; // Full text response from LLM
  // explanation_from_llm?: string; // If parse_justification_score was used
}

// Details for a single item scored by a variant
export interface ScoredItemDetail {
  item_id: string; // e.g., 'frost_road', 'senti_pos_1'
  item_title?: string; // e.g., 'The Road Not Taken'
  item_text_snippet: string; // First N characters or a representative snippet
  dataset_name: string; // e.g., "Poems", "Sentiment Texts"
  expected_scores?: Record<string, number>; // e.g., { "emotional impact": 5, "clarity": 4 } - criteria would match variant's
  repetitions_data: ScoringRepetitionDetail[];
  avg_normalized_score_for_item: number | null; // Average of normalized_score across repetitions for this item
  std_dev_normalized_score_for_item: number | null; // Std dev of normalized_score across repetitions for this item
  errors_in_item_repetitions: number;
  total_item_repetitions_attempted: number;
}

// Configuration of a single scoring variant
export interface ScoringVariantConfig {
  name: string;
  data_source: string; // e.g., "poems", "sentiment_texts"
  scale_type: string; // e.g., "1-5", "A-E", "CREATIVE"
  criterion_override?: string;
  default_criterion?: string; // From Python
  system_prompt_snippet?: string; // First N chars or key phrases
  user_prompt_template_snippet: string; // First N chars or key phrases
  labels?: Array<[string, string]> | null; // Rubric labels like [("A", "Very Positive"), ...]
  invert_scale: boolean;
}

// Aggregate statistics for a single scoring variant
export interface ScoringVariantAggregateStats {
  avg_parsed_score_overall: number | null;
  avg_normalized_score_overall: number | null;
  min_normalized_score_overall: number | null;
  max_normalized_score_overall: number | null;
  std_dev_normalized_score_overall: number | null;
  iqr_normalized_score_overall: number | null;
  num_distinct_items_processed: number;
  repetitions_per_item_config: number; // How many reps were configured
  total_successful_runs: number; // Sum of successful repetitions across all items
  total_attempted_runs: number; // num_items * repetitions_per_item_config
  total_errors_in_runs: number;
}

// Main object structure for a single scoring variant's complete results
export interface ScoringVariantResult {
  variant_config: ScoringVariantConfig;
  aggregate_stats: ScoringVariantAggregateStats;
  all_normalized_scores_for_variant: Array<number | null>; // Flat list of all norm scores for distribution plots
  detailed_item_results: ScoredItemDetail[];
}

// Type for the raw API response for a scoring experiment file 
// (top-level is an array of these variant results)
export type ScoringExperimentApiResponse = ScoringVariantResult[]; 