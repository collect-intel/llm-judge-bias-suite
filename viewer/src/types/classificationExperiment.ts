// Optional: A processed structure for easier rendering in the main page component
// This would group results by item_id for display
// export interface ProcessedClassificationViewData { // This was commented out, keeping as is for now or can be removed if truly unused.
//   [itemId: string]: {
//     item_details: ClassificationItemDetails; 
//     results_by_variant: {
//       [variantId: string]: {
//         prompt_variant_details: ClassificationStrategyDetails;
//         runs: ClassificationSingleRun[];
//         aggregated_classifications: { [categoryName: string]: number };
//         errors_across_all_repetitions: number;
//         total_repetitions_attempted: number;
//       };
//     };
//   };
// }

// Describes the structure of individual items being classified
export interface ClassificationItemDetails {
    item_id: string;
    item_text: string;
    domain: string; // e.g., "user_feedback_v1", "sentiment_basic_v1"
    expected_true_categories?: string[] | null; // Made optional and nullable to match first def if that was intended general use
    ambiguity_score?: number | null; // Made optional and nullable
    is_control_item?: boolean | null; // Made optional and nullable
}

// Describes a single category definition provided in a prompt strategy
export interface CategoryDefinition {
    id: string;    // e.g., "bug", "feature_request"
    name: string;  // e.g., "Bug Report"
    description: string;
}

// Describes the details of a specific classification strategy being tested
export interface ClassificationStrategyDetails {
    strategy_id: string;
    description: string;
    domain_target: string; // Which CLASSIFICATION_CATEGORIES set this strategy targets
    experimental_focus?: string | null; // Made optional and nullable
    base_prompt_template: string;
    category_order: string[]; // Array of category IDs defining presentation order
    include_definitions: boolean;
    definition_nuance_domain_id?: string | null; // Made optional and nullable
    escape_hatch_config?: { // Made optional and nullable
        id: string;
        name: string;
        description: string;
    } | null;
    category_definitions?: CategoryDefinition[];
}

// Represents the outcome of a single repetition for an item-strategy pair
export interface ClassificationRepetitionRun {
    repetition_index: number;
    llm_classification_raw: string | null; // Raw LLM output string
    parsed_classification: string | null;  // The category name parsed from raw output
    error_in_repetition: boolean;
}

// Represents the result of classifying a single item using a specific prompt variant/strategy, including all repetitions
export interface ClassificationItemResult {
    item_details: ClassificationItemDetails;
    prompt_variant_id: string; // Corresponds to strategy_id
    runs: ClassificationRepetitionRun[];
    aggregated_classifications: { [categoryName: string]: number };
    llm_chosen_category_id: string | null;
    error_type?: 'API_ERROR' | 'PARSING_ERROR' | 'NO_MAJORITY' | null;
}


// Represents all classification results for a given model, typically grouped by strategy.
// This interface describes the structure IF data were grouped by strategy first.
export interface ClassificationStrategyGroupResult {
    prompt_variant_details: ClassificationStrategyDetails; // Details of the strategy used
    results: ClassificationItemResult[]; // Results for each item classified with this strategy
    strategy_errors: {
        api_error_count: number;
        parsing_error_count: number;
    };
    items_processed_for_strategy: number;
    // Removed erroneous fields that belong to ClassificationItemResult:
    // item_details: ClassificationItemDetails; 
    // aggregated_classifications: { [categoryName: string]: number };
}

// The type for the data structure that is actually produced by the Python script
// and expected by aggregationCalculators.ts and (after modification) by ClassificationExperimentViewer.tsx.
// This is a flat list of item-strategy pair results.
export interface ClassificationItemStrategyPairResult {
    item_details: ClassificationItemDetails;
    prompt_variant_id: string; // Corresponds to strategy_id
    prompt_variant_details: ClassificationStrategyDetails;
    runs: ClassificationRepetitionRun[];
    aggregated_classifications: { [categoryName: string]: number };
    // These fields were present in the console.warn output and are part of the Python output
    errors_across_all_repetitions: number; 
    total_repetitions_attempted: number;
    // llm_chosen_category_id and error_type from ClassificationItemResult could also be here if needed directly
    llm_chosen_category_id?: string | null; 
    error_type?: 'API_ERROR' | 'PARSING_ERROR' | 'NO_MAJORITY' | null;
}

// The top-level type for a classification experiment data file (for a single model)
// This should reflect the actual flat list structure.
export type ClassificationExperimentData = ClassificationItemStrategyPairResult[]; 