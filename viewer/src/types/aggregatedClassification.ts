import { ClassificationItemDetails, ClassificationStrategyDetails } from "./classificationExperiment";

// For a specific item, how each model classified it under a specific strategy
export interface AggregatedClassificationCell {
  modelName: string;
  primaryClassification: string | null; // Result of getPrimaryClassification from the viewer component, or direct from raw if 1 rep
  allClassifications: { [categoryName: string]: number }; // The aggregated_classifications from raw data (sum of counts if multiple files for same model somehow, though unlikely here)
  totalRepetitions: number;
  errors: number;
}

// For a specific item, summarizing its classifications across all models and strategies
export interface AggregatedClassificationItemSummary {
  itemDetails: ClassificationItemDetails;
  // Key: strategy_id (prompt_variant_id)
  // Value: Array of classifications from each model for this item under this strategy
  classificationsByStrategy: Record<string, AggregatedClassificationCell[]>;
  
  // Metrics for this item based on the data from selected models
  // Key: modelName, Value: Set of unique primary classifications for this item by this model across all strategies it ran
  distinctClassificationsByModelAcrossStrategies: Record<string, Set<string>>;
  
  // Key: strategyId, Value: Set of unique primary classifications for this item under this strategy across all models that ran it
  distinctClassificationsByStrategyAcrossModels: Record<string, Set<string>>;

  numberOfStrategiesApplied: number; // Count of unique strategies applied to this item across selected models
  isSensitiveItemOverall: boolean; // True if this item showed any classification change for ANY model due to ANY strategy change
}

// For a specific model, its overall sensitivity and escape hatch usage
export interface AggregatedClassificationModelStats {
  modelName: string;
  totalItemsSeenByModel: number; // Total unique item-strategy pairs this model saw
  totalAmbiguousItemsSeenByModel: number;
  sensitiveItemCount: number; // Count of unique ambiguous items where this model changed classification based on strategy
  sensitivityScore: number; // (sensitiveItemCount / totalAmbiguousItemsSeenByModel) * 100
  escapeHatchStats: {
    totalUses: number;
    onAmbiguousItems: number;
    onControlItems: number;
  };
}

// For a specific prompt strategy, its overall impact across selected models
export interface AggregatedClassificationStrategyImpact {
  strategyDetails: ClassificationStrategyDetails; // Full details of the strategy
  // How many distinct (item, model) pairs showed a different primary classification with this strategy 
  // compared to a baseline or average classification for that (item, model) pair across other strategies.
  // This is complex and might be a v2. For now, simpler metrics:
  numberOfTimesLedToUniqueClassification: number; // Count of (item,model) where this strategy gave a unique class vs other strategies for that item,model
  itemsWhereThisStrategyCausedMaxDeviation: string[]; // List of item_ids where this strategy led to the most diverse classifications across models
}

export interface AggregatedClassificationModelPerformance {
  modelName: string;
  totalItemsProcessed: number;
  totalSuccessfulClassifications: number;
  successRate: number; // (totalSuccessfulClassifications / totalItemsProcessed) * 100
  totalApiErrors: number;
  totalParsingErrors: number;
}

export interface AggregatedClassificationSensitiveItem {
  itemId: string;
  itemTextSnippet: string; // First N characters of item_text
  ambiguityScore: number;
  isControlItem: boolean;
  itemDiversityScore: number; // Count of unique llm_chosen_category_ids this item received
  distinctClassifications: Array<{ categoryId: string; count: number }>; // e.g., [{categoryId: 'bug', count: 5}, {categoryId: 'feature', count: 3}]
  modelsShowingSensitivity: string[]; // List of model names that gave different classifications for this item across strategies
}

// New type for strategy-level aggregation
export interface AggregatedClassificationStrategyStats {
  strategyId: string;
  strategyDescription: string;
  experimentalFocus: string | null;
  // Average number of unique classifications an item gets across models when this strategy is used.
  // Lower values suggest more agreement among models for items under this strategy.
  averageItemClassificationDiversity: number; 
  // Percentage of items where all models using this strategy agreed on the classification.
  // Higher values suggest this strategy leads to more consistent outcomes across models.
  percentageItemsWithUnanimousAgreement: number;
  totalItemModelPairsEvaluated: number; // Total number of (item, model) pairs evaluated with this strategy
  uniqueModelsThatUsedStrategyCount: number; // How many of the selected models actually used this strategy
  uniqueItemIdsProcessedCount: number; // How many unique items were processed with this strategy across all models
}

// The overall summary for the aggregated classification view
export interface AggregatedClassificationOverallSummary {
  modelsProcessed: string[]; // List of model names included in this aggregation
  overallModelCount: number;
  totalUniqueItemsAnalysed: number;
  totalAmbiguousItemsInSet: number; // Based on all items in CLASSIFICATION_ITEMS that were processed
  totalControlItemsInSet: number;   // Based on all items in CLASSIFICATION_ITEMS that were processed
  totalUniqueStrategiesAnalysed: number;
  
  itemsSummary: AggregatedClassificationItemSummary[]; // Array, one per unique item_id processed
  modelOverallStats: AggregatedClassificationModelStats[]; // Array, one per model processed
  topSensitiveItems: AggregatedClassificationSensitiveItem[]; // For the item sensitivity table
  modelPerformances: AggregatedClassificationModelPerformance[]; // For the success rate table (can be kept for now or removed later if fully replaced)
  strategyStats: AggregatedClassificationStrategyStats[]; // Added for strategy ranking
} 