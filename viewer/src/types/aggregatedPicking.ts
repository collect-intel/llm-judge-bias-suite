// viewer/src/types/aggregatedPicking.ts

import { ProcessedPickingData } from '@/components/PickingExperimentCharts'; // Assuming this is used by other types not shown

// --- Interfaces for Aggregated Picking Experiment Data ---
export interface AggregatedPickingVariantSchemeData {
    variantName: string;
    labelingSchemeName: string;
    schemeDescription: string;
    schemeDisplayLabel1: string;
    schemeDisplayLabel2: string;
    modelCount: number; // Number of models contributing to this aggregation
    averageBiasRate: number;
    stdDevBiasRate: number;
    averageConsistencyRate: number;
    stdDevConsistencyRate: number;
    // Counts of models favoring specific labels or showing bias
    totalModelsFavoredLabel1: number;
    totalModelsFavoredLabel2: number;
    totalModelsFavoredPositionInconclusive: number;
    totalModelsShowingBias: number;
    // Could add more detailed stats like distributions if needed

    // NEW FIELDS for overall first slot preference
    totalFirstSlotPicksAcrossModelsAndRepetitions?: number;
    totalDecisionsAcrossModelsAndRepetitions?: number;
    overallFirstSlotPreferencePercentage?: number;
}
  
export interface AggregatedPickingSummary {
    experimentType: 'picking'; // To identify the type of aggregated data
    overallModelCount: number; // Total unique models in this aggregation
    aggregatedVariantSchemes: AggregatedPickingVariantSchemeData[];

    // NEW GRAND TOTALS (optional but good for a dashboard)
    grandTotalFirstSlotPicks?: number;
    grandTotalDecisions?: number;
    grandOverallFirstSlotPreferencePercentage?: number;
}
// --- End Interfaces for Aggregated Picking Experiment Data --- 