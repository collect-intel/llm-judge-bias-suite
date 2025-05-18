// viewer/src/types/aggregatedPicking.ts

// ProcessedPickingData is imported by other files, but not directly used in this interface definition itself.
// import { ProcessedPickingData } from '@/components/PickingExperimentCharts'; 

// --- Interfaces for Aggregated Picking Experiment Data ---
export interface AggregatedPickingVariantSchemeData {
    variantName: string;
    labelingSchemeName: string;
    schemeDescription: string;
    schemeDisplayLabel1: string;
    schemeDisplayLabel2: string;
    modelCount: number; // Number of models contributing to this aggregation
    
    // Non-lossy metrics (calculated from raw repetition distributions)
    totalFirstSlotPicksAcrossModelsAndRepetitions: number; // Sum of all first slot picks
    totalDecisionsAcrossModelsAndRepetitions: number;    // Sum of all decisions (reps * runs * pairs * models)
    overallFirstSlotPreferencePercentage: number;        // (totalFirstSlotPicks / totalDecisions) * 100

    // Descriptive info (can be sourced from the first encountered model's data for this combo)
    systemPromptUsed?: string | null;
    userPromptTemplateUsed?: string | null;

    // Fields to be REMOVED as they are consensus-based:
    // averageBiasRate: number;
    // stdDevBiasRate: number;
    // averageConsistencyRate: number;
    // stdDevConsistencyRate: number;
    // totalModelsFavoredLabel1: number;
    // totalModelsFavoredLabel2: number;
    // totalModelsFavoredPositionInconclusive: number;
    // totalModelsShowingBias: number;
}
  
export interface AggregatedPickingSummary {
    experimentType: 'picking'; // To identify the type of aggregated data
    overallModelCount: number; // Total unique models in this aggregation
    aggregatedVariantSchemes: AggregatedPickingVariantSchemeData[];

    // Grand totals for first slot preference (non-lossy)
    grandTotalFirstSlotPicks: number;
    grandTotalDecisions: number;
    grandOverallFirstSlotPreferencePercentage: number;
}
// --- End Interfaces for Aggregated Picking Experiment Data --- 