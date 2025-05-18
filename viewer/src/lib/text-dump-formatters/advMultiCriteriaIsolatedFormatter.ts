import { calculateAggregatedIsolatedData, ModelDataStatesForAggregation } from '../../utils/aggregationCalculators';
import {
    AggregatedAdvancedIsolatedOverallSummary,
    AggregatedIsolatedItemSummary,
    AggregatedIsolatedHolisticCriterionStats
} from '../../types/aggregatedAdvancedIsolated';
import {
    IsolatedHolisticExperimentData, // This is typically IsolatedHolisticItemSummary[]
    IsolatedHolisticItemSummary,
    IsolatedHolisticScoreDetail
} from '../../types/advancedMultiCriteriaExperiment';

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

export async function formatAdvMultiCriteriaIsolatedDataToMarkdown(
    experimentMeta: ExperimentScanData,
    protocol: string,
    host: string
): Promise<string> {
    let markdown = "";
    const modelDataForAgg: ModelDataStatesForAggregation = {};
    const allModelRawData: Array<{
        modelName: string,
        fileName: string,
        data: IsolatedHolisticExperimentData 
    }> = [];

    // Step 1: Fetch data for all models
    for (const modelName of experimentMeta.modelNames.sort()) {
        const modelFiles = experimentMeta.models[modelName];
        const dataFile = modelFiles?.find(f => f.experimentType.startsWith('adv_multi_criteria_isolated')); 

        if (dataFile) {
            try {
                const getExperimentDataUrl = new URL(`/api/get-experiment-data?filePath=${encodeURIComponent(dataFile.filePath)}`, `${protocol}://${host}`);
                const dataResponse = await fetch(getExperimentDataUrl.toString());
                if (!dataResponse.ok) {
                    const errorData: ApiError = await dataResponse.json();
                    console.warn(`Warn: Failed to fetch adv_multi_criteria_isolated data for ${modelName}: ${errorData.error}`);
                    continue; 
                }
                const rawData: IsolatedHolisticExperimentData = await dataResponse.json(); 
                if (rawData && rawData.length > 0) {
                    allModelRawData.push({ modelName, fileName: dataFile.fileName, data: rawData });
                    modelDataForAgg[modelName] = { isolatedHolisticData: rawData };
                }
            } catch (e: any) {
                console.warn(`Warn: Error processing adv_multi_criteria_isolated data for ${modelName} (${dataFile.fileName}): ${e.message}`);
            }
        }
    }

    // Step 2: Perform Aggregation
    if (Object.keys(modelDataForAgg).length > 0) {
        const aggregatedSummary: AggregatedAdvancedIsolatedOverallSummary | null = calculateAggregatedIsolatedData(modelDataForAgg, Object.keys(modelDataForAgg));
        if (aggregatedSummary) {
            markdown += `#### Overall Aggregated Summary for Isolated vs. Holistic Scoring (${aggregatedSummary.overallModelCount} Models)\n`;
            markdown += `- Task Name: ${aggregatedSummary.taskName}\n\n`;
            markdown += `**Item Scores: Isolated vs. Holistic (Aggregated Across Models):**\n`;
            aggregatedSummary.itemSummaries.forEach((item: AggregatedIsolatedItemSummary) => {
                markdown += `\n**Item: ${item.itemTitle}** (ID: ${item.itemId})\n`;
                markdown += '| Criterion | Avg. Isolated | StdDev Isolated | Models (Iso) | Avg. Holistic | StdDev Holistic | Models (Hol) | Avg. Delta |\n';
                markdown += '|---|---|---|---|---|---|---|---|\n';
                item.criteriaComparisonStats.forEach((stats: AggregatedIsolatedHolisticCriterionStats) => {
                    markdown += `| ${stats.criterionName} `;
                    markdown += `| ${stats.averageScoreIsolated?.toFixed(2) ?? 'N/A'} `;
                    markdown += `| ${stats.stdDevScoreIsolated?.toFixed(2) ?? 'N/A'} `;
                    markdown += `| ${stats.modelCountIsolated} `;
                    markdown += `| ${stats.averageScoreHolistic?.toFixed(2) ?? 'N/A'} `;
                    markdown += `| ${stats.stdDevScoreHolistic?.toFixed(2) ?? 'N/A'} `;
                    markdown += `| ${stats.modelCountHolistic} `;
                    markdown += `| ${stats.deltaAverageScore?.toFixed(2) ?? 'N/A'} |\n`;
                });
            });
            markdown += '\n';
        } else {
            markdown += "No aggregated isolated/holistic summary could be calculated.\n\n";
        }
    } else {
        markdown += "No data available for aggregated isolated/holistic summary.\n\n";
    }

    markdown += `\n#### Model-Specific Isolated vs. Holistic Results\n`;
    if (allModelRawData.length > 0) {
        allModelRawData.sort((a,b) => a.modelName.localeCompare(b.modelName)).forEach(modelResult => {
            markdown += `\n##### Model: ${modelResult.modelName}\n`;
            markdown += `File: \`${modelResult.fileName}\`\n\n`;
            if (modelResult.data && Array.isArray(modelResult.data)) {
                const isolatedData = modelResult.data as IsolatedHolisticExperimentData;
                isolatedData.forEach((itemSummary: IsolatedHolisticItemSummary) => {
                    markdown += `**Item: ${itemSummary.item_title}** (ID: ${itemSummary.item_id})\n`;
                    markdown += '| Criterion | Isolated Score | Holistic Score | Delta | Iso Reps | Hol Reps |\n';
                    markdown += '|---|---|---|---|---|---|\n';
                    itemSummary.comparison_details.forEach((detail: IsolatedHolisticScoreDetail) => {
                        markdown += `| ${detail.criterion} `;
                        markdown += `| ${detail.isolated_avg?.toFixed(2) ?? 'N/A'} `;
                        markdown += `| ${detail.holistic_avg?.toFixed(2) ?? 'N/A'} `;
                        markdown += `| ${detail.delta_avg?.toFixed(2) ?? 'N/A'} `;
                        markdown += `| ${detail.isolated_n ?? 'N/A'} / ${detail.isolated_reps ?? 'N/A'} `;
                        markdown += `| ${detail.holistic_n ?? 'N/A'} / ${detail.holistic_reps ?? 'N/A'} |\n`;
                    });
                    markdown += '\n';
                });
            }
        });
    } else {
        markdown += "No model-specific isolated/holistic data processed.\n";
    }

    return markdown;
} 