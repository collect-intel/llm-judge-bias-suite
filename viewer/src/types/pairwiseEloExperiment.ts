export interface EloItemVariantSummary {
  variant_name: string;
  rank: number;
  item_id: string;
  elo_rating: number;
  wins: number;
  losses: number;
  ties: number;
  item_text_snippet: string; 
}

export interface PairwiseEloExperimentDataWrapper {
  criterion: string;
  ranking_set_id: string;
  variants_summary: EloItemVariantSummary[];
} 