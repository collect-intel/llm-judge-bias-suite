import { calculateAggregatedPickingData, ModelDataStatesForAggregation } from '../../utils/aggregationCalculators';
import { AggregatedPickingSummary } from '@/types/aggregatedPicking';

// --- START: Types for Picking Experiment Data ---
// (These are similar to those in all-results-report/page.tsx and page.tsx)
interface PickingPairDetail {
    pair_id: string;
    labeling_scheme_name: string;
    scheme_label1_used_for_pair: string;
    scheme_label2_used_for_pair: string;
    question: string;
    text1_id: string;
    text2_id: string;
    expected_better_id?: string | null;
    analysis_status: string;
    consistent_choice: string | null;
    positional_bias_detected: boolean | null;
    favored_actual_label_text?: string | null;
    run1_order: string;
    run1_majority_pick_id?: string | null;
    run1_pick_consistency: string;
    run1_pick_distribution: { [key: string]: number };
    run1_errors: string;
    run2_order: string;
    run2_majority_pick_id?: string | null;
    run2_pick_consistency: string;
    run2_pick_distribution: { [key: string]: number };
    run2_errors: string;
}

interface PickingExperimentSchemeResult {
    model_name: string;
    variant_name: string;
    labeling_scheme_name: string;
    scheme_description: string;
    scheme_display_label1: string;
    scheme_display_label2: string;
    total_pairs_tested_in_scheme: number;
    repetitions_per_order_run: number;
    pairs_with_errors_or_inconclusive_in_scheme: number;
    valid_pairs_for_bias_calculation: number;
    positional_bias_detected_count: number;
    positional_bias_rate_percentage: number;
    favored_scheme_label1_count: number;
    favored_scheme_label2_count: number;
    favored_position_inconclusive_count: number;
    valid_pairs_for_consistency_calculation: number;
    consistent_choices_count: number;
    consistency_rate_percentage: number;
    pairs_summary_for_scheme: PickingPairDetail[];
    // Added from page.tsx for completeness, may not be in all raw JSONs but good for type def
    system_prompt_used?: string | null;
    user_prompt_template_used?: string | null;
}

type PickingExperimentApiResponse = PickingExperimentSchemeResult[];

// This interface is used by aggregation and chart components
interface ProcessedPickingData {
    variantName: string;
    labelingSchemeName: string;
    schemeDescription: string;
    schemeDisplayLabel1: string;
    schemeDisplayLabel2: string;
    avgFirstSlotPreferenceForScheme: number;
    repetitionsPerOrderRun: number;
    // For aggregation, we also need the prompt details if available from the source data
    system_prompt_used?: string | null;
    user_prompt_template_used?: string | null;
}
// --- END: Types for Picking Experiment Data ---

// --- START: Types from main API route (for experimentMeta parameter) ---
interface ExperimentScanFile {
    experimentType: string;
    modelName: string;
    fileName: string;
    filePath: string;
}

interface ExperimentScanData {
    models: Record<string, ExperimentScanFile[]>;
    modelNames: string[];
}

interface ApiError {
    error: string;
    details?: string;
}
// --- END: Types from main API route ---


// Local version of transformPickingJsonToChartData, adapted for server-side use if needed.
// This is used to prepare data for calculateAggregatedPickingData.
const transformPickingJsonToProcessedData = (apiResponse: PickingExperimentApiResponse): ProcessedPickingData[] => {
    if (!apiResponse || !Array.isArray(apiResponse)) return [];
    return apiResponse.map(schemeResult => {
        let totalFirstSlotPicksAcrossPairs = 0;
        let totalDecisionsAcrossPairs = 0;

        schemeResult.pairs_summary_for_scheme.forEach(pair => {
            const picksForContentInSlot1Run1 = pair.run1_pick_distribution["text_A"] || 0;
            const totalPicksRun1 = Object.values(pair.run1_pick_distribution).reduce((s, c) => s + c, 0);
            
            const picksForContentInSlot1Run2 = pair.run2_pick_distribution["text_B"] || 0; // text_B is in slot 1 in run 2 (A vs B, then B vs A)
            const totalPicksRun2 = Object.values(pair.run2_pick_distribution).reduce((s, c) => s + c, 0);

            if (totalPicksRun1 > 0 || totalPicksRun2 > 0) { 
                totalFirstSlotPicksAcrossPairs += (picksForContentInSlot1Run1 + picksForContentInSlot1Run2);
                totalDecisionsAcrossPairs += (totalPicksRun1 + totalPicksRun2);
            }
        });

        const avgFirstSlotPreference = totalDecisionsAcrossPairs > 0 
            ? (totalFirstSlotPicksAcrossPairs / totalDecisionsAcrossPairs) * 100 
            : 0;

        return {
            variantName: schemeResult.variant_name,
            labelingSchemeName: schemeResult.labeling_scheme_name,
            schemeDescription: schemeResult.scheme_description,
            schemeDisplayLabel1: schemeResult.scheme_display_label1,
            schemeDisplayLabel2: schemeResult.scheme_display_label2,
            avgFirstSlotPreferenceForScheme: avgFirstSlotPreference,
            repetitionsPerOrderRun: schemeResult.repetitions_per_order_run,
            // Pass through prompt info if available in schemeResult (added to type)
            system_prompt_used: schemeResult.system_prompt_used,
            user_prompt_template_used: schemeResult.user_prompt_template_used
        };
    });
};


export async function formatPickingExperimentDataToMarkdown(
    experimentMeta: ExperimentScanData,
    protocol: string,
    host: string
): Promise<string> {
    let markdown = "";
    const modelDataForAgg: ModelDataStatesForAggregation = {};
    const allModelSchemeResults: Array<{ modelName: string, fileName: string, data: PickingExperimentApiResponse }> = [];

    // Step 1: Fetch data for all models for aggregation
    for (const modelName of experimentMeta.modelNames.sort()) {
        const modelFiles = experimentMeta.models[modelName];
        const pickingFile = modelFiles?.find(f => f.experimentType === 'picking');
        if (pickingFile) {
            try {
                const getExperimentDataUrl = new URL(`/api/get-experiment-data?filePath=${encodeURIComponent(pickingFile.filePath)}`, `${protocol}://${host}`);
                const dataResponse = await fetch(getExperimentDataUrl.toString());
                if (!dataResponse.ok) {
                    const errorData: ApiError = await dataResponse.json();
                    console.warn(`Warn: Failed to fetch picking data for aggregation for ${modelName}: ${errorData.error}`);
                    continue; // Skip this model for aggregation if data fetch fails
                }
                const rawData: PickingExperimentApiResponse = await dataResponse.json();
                if (rawData && rawData.length > 0) {
                    allModelSchemeResults.push({ modelName, fileName: pickingFile.fileName, data: rawData });
                    const processedData = transformPickingJsonToProcessedData(rawData);
                    modelDataForAgg[modelName] = { rawPickingData: rawData, processedPickingData: processedData };
                }
            } catch (e: any) {
                console.warn(`Warn: Error processing picking data for aggregation for ${modelName} (${pickingFile.fileName}): ${e.message}`);
            }
        }
    }

    // Step 2: Perform Aggregation
    if (Object.keys(modelDataForAgg).length > 0) {
        const aggregatedSummary: AggregatedPickingSummary | null = calculateAggregatedPickingData(modelDataForAgg, Object.keys(modelDataForAgg));
        if (aggregatedSummary) {
            markdown += `#### Overall Aggregated Picking Summary (${aggregatedSummary.overallModelCount} Models)\n`;
            if (aggregatedSummary.grandOverallFirstSlotPreferencePercentage !== undefined) {
                markdown += `- **Grand Overall First Slot Preference**: ${aggregatedSummary.grandOverallFirstSlotPreferencePercentage.toFixed(2)}% `;
                markdown += `(Based on ${aggregatedSummary.grandTotalFirstSlotPicks} first slot picks out of ${aggregatedSummary.grandTotalDecisions} total decisions across all models/variants/schemes).\n`;
            }
            markdown += `\n**Aggregated First Slot Preference by Variant & Scheme (across models):**\n`;
            markdown += '| Variant | Scheme | Description | 1st Slot Pref. (%) | Total Picks / Decisions | Models Aggregated |\n';
            markdown += '|---|---|---|---|---|---|\n';
            const sortedAggSchemes = [...aggregatedSummary.aggregatedVariantSchemes].sort((a, b) => {
                const devA = Math.abs(a.overallFirstSlotPreferencePercentage - 50);
                const devB = Math.abs(b.overallFirstSlotPreferencePercentage - 50);
                return devB - devA;
            });
            sortedAggSchemes.forEach(aggScheme => {
                markdown += `| ${aggScheme.variantName} | ${aggScheme.labelingSchemeName} | ${aggScheme.schemeDescription.substring(0,50)}... | **${aggScheme.overallFirstSlotPreferencePercentage.toFixed(2)}%** | ${aggScheme.totalFirstSlotPicksAcrossModelsAndRepetitions} / ${aggScheme.totalDecisionsAcrossModelsAndRepetitions} | ${aggScheme.modelCount} |\n`;
            });
            markdown += '\n';
        } else {
            markdown += "No aggregated summary could be calculated.\n\n";
        }
    } else {
        markdown += "No data available for aggregated picking summary.\n\n";
    }

    markdown += `#### Model-Specific Picking Results\n`;
    // Step 3: Per-model details (using the already fetched data in allModelSchemeResults)
    if (allModelSchemeResults.length > 0) {
        allModelSchemeResults.sort((a,b) => a.modelName.localeCompare(b.modelName)).forEach(modelResult => {
            markdown += `\n##### Model: ${modelResult.modelName}\n`;
            markdown += `File: \`${modelResult.fileName}\`\n\n`;
            if (modelResult.data && modelResult.data.length > 0) {
                modelResult.data.forEach(schemeResult => {
                    markdown += `###### Variant: ${schemeResult.variant_name} | Scheme: ${schemeResult.labeling_scheme_name}\n`;
                    markdown += `- Description: ${schemeResult.scheme_description}\n`;
                    markdown += `- Labels Used: '${schemeResult.scheme_display_label1}' vs '${schemeResult.scheme_display_label2}'\n`;
                    markdown += `- Reps per Order: ${schemeResult.repetitions_per_order_run}\n`;
                    markdown += `- Total Pairs Tested: ${schemeResult.total_pairs_tested_in_scheme}\n`;
                    markdown += `- Pairs with Errors/Inconclusive: ${schemeResult.pairs_with_errors_or_inconclusive_in_scheme}\n`;
                    markdown += `- Valid Pairs for Bias Calc: ${schemeResult.valid_pairs_for_bias_calculation}\n`;
                    markdown += `- **Positional Bias Rate**: ${schemeResult.positional_bias_rate_percentage.toFixed(2)}% (${schemeResult.positional_bias_detected_count} biased pairs)\n`;
                    markdown += `  - Favored Scheme Label 1 ('${schemeResult.scheme_display_label1}'): ${schemeResult.favored_scheme_label1_count} times\n`;
                    markdown += `  - Favored Scheme Label 2 ('${schemeResult.scheme_display_label2}'): ${schemeResult.favored_scheme_label2_count} times\n`;
                    markdown += `  - Bias Inconclusive (position favored but not consistently L1/L2): ${schemeResult.favored_position_inconclusive_count} times\n`;
                    markdown += `- **Consistency Rate**: ${schemeResult.consistency_rate_percentage.toFixed(2)}% (${schemeResult.consistent_choices_count} consistent choices out of ${schemeResult.valid_pairs_for_consistency_calculation} valid pairs)\n\n`;
                });
            } else {
                markdown += `No specific scheme data found for ${modelResult.modelName} in file ${modelResult.fileName}.\n\n`;
            }
        });
    } else {
        markdown += "No model-specific picking data processed.\n";
    }

    return markdown;
} 