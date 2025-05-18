import { calculateAggregatedScoringData, ModelDataStatesForAggregation } from '../../utils/aggregationCalculators';
import { AggregatedScoringOverallSummary, AggregatedScoringVariantSummary } from '../../types/aggregatedScoring'; // Direct import
import { ScoringExperimentData, ScoringVariantResult, ScoringItemResult, ScoringVariantLabel, ScoringVariantConfig } from '../../types/scoringExperiment'; 

// --- START: Types from main API route (for experimentMeta parameter) ---
// These should ideally be in a shared types file
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

export async function formatScoringExperimentDataToMarkdown(
    experimentMeta: ExperimentScanData,
    protocol: string,
    host: string
): Promise<string> {
    let markdown = "";
    const modelDataForAgg: ModelDataStatesForAggregation = {};
    const allModelScoringResults: Array<{ modelName: string, fileName: string, data: ScoringExperimentData }> = [];

    // Step 1: Fetch data for all models for aggregation and individual listing
    for (const modelName of experimentMeta.modelNames.sort()) {
        // Scoring data often has filenames like scoring_results_model_temp_rep.json
        // or scoring_poems_results_..., scoring_sentiment_..., etc.
        // We need to find any file that starts with 'scoring' for this model.
        const modelFiles = experimentMeta.models[modelName];
        const scoringFile = modelFiles?.find(f => f.experimentType.startsWith('scoring')); 

        if (scoringFile) {
            try {
                const getExperimentDataUrl = new URL(`/api/get-experiment-data?filePath=${encodeURIComponent(scoringFile.filePath)}`, `${protocol}://${host}`);
                const dataResponse = await fetch(getExperimentDataUrl.toString());
                if (!dataResponse.ok) {
                    const errorData: ApiError = await dataResponse.json();
                    console.warn(`Warn: Failed to fetch scoring data for aggregation for ${modelName}: ${errorData.error}`);
                    continue; 
                }
                const rawData: ScoringExperimentData = await dataResponse.json(); // This is typically an array of ScoringVariantResult
                if (rawData && rawData.length > 0) {
                    allModelScoringResults.push({ modelName, fileName: scoringFile.fileName, data: rawData });
                    modelDataForAgg[modelName] = { scoringExperimentData: rawData };
                }
            } catch (e: any) {
                console.warn(`Warn: Error processing scoring data for aggregation for ${modelName} (${scoringFile.fileName}): ${e.message}`);
            }
        }
    }

    // Step 2: Perform Aggregation
    if (Object.keys(modelDataForAgg).length > 0) {
        const aggregatedSummary: AggregatedScoringOverallSummary | null = calculateAggregatedScoringData(modelDataForAgg, Object.keys(modelDataForAgg));
        if (aggregatedSummary) {
            markdown += `#### Overall Aggregated Scoring Summary (${aggregatedSummary.overallModelCount} Models)\n`;
            markdown += `- Unique Items Scored Across All Variants/Models: ${aggregatedSummary.overallUniqueItemsScored}\n\n`;
            markdown += `**Aggregated Scores by Variant (across models):**\n`;
            markdown += '| Variant Name | Models | Items | Avg. Norm. Score (1-5) | Std. Dev. Norm. Score |\n';
            markdown += '|---|---|---|---|---|\n';
            aggregatedSummary.variantsSummaries.forEach((aggVariant: AggregatedScoringVariantSummary) => {
                markdown += `| ${aggVariant.variantName} | ${aggVariant.modelCountOverall} | ${aggVariant.itemCountOverall} | ${(aggVariant.overallAverageNormalizedScore?.toFixed(2)) ?? 'N/A'} | ${(aggVariant.overallStdDevNormalizedScore?.toFixed(2)) ?? 'N/A'} |\n`;
            });
            markdown += '\n';
        } else {
            markdown += "No aggregated scoring summary could be calculated.\n\n";
        }
    } else {
        markdown += "No data available for aggregated scoring summary.\n\n";
    }

    markdown += `#### Model-Specific Scoring Results\n`;
    if (allModelScoringResults.length > 0) {
        allModelScoringResults.sort((a,b) => a.modelName.localeCompare(b.modelName)).forEach(modelResult => {
            markdown += `\n##### Model: ${modelResult.modelName}\n`;
            markdown += `File: \`${modelResult.fileName}\`\n\n`;
            if (modelResult.data && modelResult.data.length > 0) {
                modelResult.data.forEach((variantResult: ScoringVariantResult) => {
                    markdown += `###### Variant: ${variantResult.variant_config.name}\n`;
                    markdown += `- Data Source: ${variantResult.variant_config.data_source_tag}, Scale: ${variantResult.variant_config.scale_type}\n`;
                    if (variantResult.variant_config.criterion_override) {
                        markdown += `- Criterion: ${variantResult.variant_config.criterion_override}\n`;
                    }
                    const aggStats = variantResult.aggregate_stats;
                    markdown += `- Items Scored: ${aggStats.num_items_processed}, Reps/Item: ${aggStats.repetitions_per_item}\n`;
                    markdown += `- Successful Runs: ${aggStats.total_successful_runs} / ${aggStats.total_attempted_runs} (Errors: ${aggStats.total_errors_in_runs})\n`;
                    markdown += `- Avg Parsed Score (raw): ${(aggStats.avg_parsed_score_overall?.toFixed(2)) ?? 'N/A'}\n`;
                    markdown += `- Avg Normalized Score (1-5 scale): **${(aggStats.avg_normalized_score_overall?.toFixed(2)) ?? 'N/A'}** (StdDev: ${(aggStats.std_dev_normalized_score_overall?.toFixed(2)) ?? 'N/A'}, IQR: ${(aggStats.iqr_normalized_score_overall?.toFixed(2)) ?? 'N/A'})\n`;
                    // Optionally, list a few item scores if needed, but can get very verbose
                    // For example, top/bottom 3 items or items with high variance.
                    // For now, focusing on variant-level summary.
                    markdown += '\n'; 
                });
            } else {
                markdown += `No specific scoring variant data found for ${modelResult.modelName} in file ${modelResult.fileName}.\n\n`;
            }
        });
    } else {
        markdown += "No model-specific scoring data processed.\n";
    }

    return markdown;
} 