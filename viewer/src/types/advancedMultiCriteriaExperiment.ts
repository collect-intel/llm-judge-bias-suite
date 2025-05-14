// viewer/src/types/advancedMultiCriteriaExperiment.ts

// Types for Permuted Order Experiment Data
// Based on the output of run_permuted_order_multi_criteria_experiment in advanced_multi_criteria_experiment.py

export interface PermutedOrderScoreStats {
  avg: number | string | null; // Can be "N/A" or "ERROR" from Python
  std: number | string | null; // Can be "N/A"
  n_scores?: number; // Number of valid scores used for avg/std
  total_reps?: number; // Total repetitions attempted for this specific task (item-order)
}

export interface PermutedOrderCriterionComparison {
  criterion_name: string;
  scores_by_order: Record<string, PermutedOrderScoreStats>; // Key is order_permutation_name
                                                           // e.g., "OrderOriginal_Arg": { avg: 4.5, std: 0.5, n_scores: 2, total_reps: 2 }
}

export interface PermutedOrderItemSummary {
  item_id: string;
  item_title: string;
  order_comparison_results: PermutedOrderCriterionComparison[];
}

export type PermutedOrderExperimentData = PermutedOrderItemSummary[];


// Types for Isolated vs. Holistic Experiment Data
// Based on the output of run_isolated_criterion_scoring_experiment in advanced_multi_criteria_experiment.py

export interface IsolatedHolisticScoreDetail {
  criterion: string;
  isolated_avg: number | null;
  isolated_std?: number | null;
  isolated_n?: number; // Number of valid isolated scores
  isolated_reps?: number; // Total isolated repetitions attempted
  isolated_error?: string | null; // If there was an error fetching/parsing isolated score
  holistic_avg: number | null;
  holistic_std?: number | null;
  holistic_n?: number; // Number of valid holistic scores
  holistic_reps?: number; // Total holistic repetitions attempted
  delta_avg: number | null; // isolated_avg - holistic_avg
}

export interface IsolatedHolisticItemSummary {
  item_id: string;
  item_title: string;
  comparison_details: IsolatedHolisticScoreDetail[];
}

export type IsolatedHolisticExperimentData = IsolatedHolisticItemSummary[]; 