export interface ScoringRepetitionDetail {
  repetition_index: number;
  raw_score_from_llm: string | number | null;
  normalized_score: number | null;
  raw_llm_response: string;
}

export interface ScoringItemResult {
  item_id: string; // Or a more generic 'identifier'
  item_title?: string; // Optional, for display
  item_text_snippet: string; // Keep it short for tables, full text can be in LLM response or fetched if needed
  dataset_name: string; // e.g., "Poems", "Sentiment Texts"
  // Optional: For comparing LLM scores against a ground truth if available
  expected_scores?: Record<string, number | string | null>; // Keyed by criterion, value is expected normalized score
  repetitions: ScoringRepetitionDetail[];
  avg_normalized_score_for_item?: number | null;
  std_dev_normalized_score_for_item?: number | null;
  error_message?: string;
  actual_prompt_sent_to_llm?: string | null;
  sampled_llm_raw_responses?: string[] | null;
}

export interface ScoringVariantLabel {
  label: string; // e.g., "5" or "A" or "TOX_MAX"
  description: string; // e.g., "Very High Toxicity"
}

export interface ScoringVariantConfig {
  name: string;
  data_source_tag: string; // e.g., "poems", "sentiment_texts"
  scale_type: string; // e.g., "1-5", "A-E", "CREATIVE"
  criterion_override?: string | null; // The specific criterion this variant focuses on
  default_criterion?: string | null; // Fallback criterion
  system_prompt_snippet?: string | null;
  user_prompt_template_snippet?: string | null;
  // 'labels' used in the rubric for this variant.
  // For numeric scales like "1-5", this might be more descriptive, e.g., 5: "Excellent", 1: "Poor"
  // For creative scales, these are the actual labels like "CATEGORY_X98".
  rubric_labels?: ScoringVariantLabel[] | null;
  invert_scale: boolean;
  parse_fn_name?: string; // Name of the parsing function used
  normalize_fn_name?: string; // Name of the normalization function used
}

export interface ScoringVariantAggregateStats {
  avg_parsed_score_overall: number | null;
  avg_normalized_score_overall: number | null;
  min_normalized_score_overall: number | null;
  max_normalized_score_overall: number | null;
  std_dev_normalized_score_overall: number | null;
  iqr_normalized_score_overall: number | null;
  num_items_processed: number;
  repetitions_per_item: number;
  total_successful_runs: number;
  total_attempted_runs: number;
  total_errors_in_runs: number;
}

export interface ScoringVariantResult {
  variant_config: ScoringVariantConfig;
  aggregate_stats: ScoringVariantAggregateStats;
  all_normalized_scores: (number | null)[]; // Flat list of all individual normalized scores for distribution plots
  detailed_item_results: ScoringItemResult[];
}

// This will be the top-level structure of the JSON file for a scoring experiment
export type ScoringExperimentData = ScoringVariantResult[]; 