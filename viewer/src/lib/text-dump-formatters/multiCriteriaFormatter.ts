import { calculateAggregatedPermutedData, ModelDataStatesForAggregation } from '../../utils/aggregationCalculators';
import {
    AggregatedAdvancedPermutedOverallSummary,
    AggregatedPermutedItemSummary,
    AggregatedPermutedItemCriterionComparison,
    AggregatedPermutedCriterionOrderStats
} from '../../types/aggregatedAdvancedPermuted';
import {
    PermutedOrderExperimentData, // This is typically PermutedOrderItemSummary[]
    PermutedOrderItemSummary,
    PermutedOrderScoreStats // Make sure this is available for type checking stats.avg/std
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

// Placeholder for basic multi_criteria types if we handle it here later
// interface MultiCriteriaItemScore { [criterion: string]: number; }
// interface MultiCriteriaItemResult { item_id: string; item_title?: string; scores: MultiCriteriaItemScore; }
// type MultiCriteriaExperimentData = MultiCriteriaItemResult[];

export async function formatMultiCriteriaExperimentDataToMarkdown(
    experimentType: string, // To distinguish between 'adv_multi_criteria_permuted' and basic 'multi_criteria' etc.
    experimentMeta: ExperimentScanData,
    protocol: string,
    host: string
): Promise<string> {
    let markdown = "";
    const modelDataForAgg: ModelDataStatesForAggregation = {};
    // Store raw fetched data for per-model section
    const allModelRawData: Array<{
        modelName: string,
        fileName: string,
        data: PermutedOrderExperimentData | any // Use 'any' for now if basic multi_criteria has different structure
    }> = [];

    // Step 1: Fetch data for all models
    for (const modelName of experimentMeta.modelNames.sort()) {
        const modelFiles = experimentMeta.models[modelName];
        // Find file matching the specific experimentType (e.g., adv_multi_criteria_permuted_argument)
        const dataFile = modelFiles?.find(f => f.experimentType === experimentType); 

        if (dataFile) {
            try {
                const getExperimentDataUrl = new URL(`/api/get-experiment-data?filePath=${encodeURIComponent(dataFile.filePath)}`, `${protocol}://${host}`);
                const dataResponse = await fetch(getExperimentDataUrl.toString());
                if (!dataResponse.ok) {
                    const errorData: ApiError = await dataResponse.json();
                    console.warn(`Warn: Failed to fetch ${experimentType} data for ${modelName}: ${errorData.error}`);
                    continue; 
                }
                const rawData: PermutedOrderExperimentData | any = await dataResponse.json(); 
                if (rawData) {
                    allModelRawData.push({ modelName, fileName: dataFile.fileName, data: rawData });
                    if (experimentType.startsWith('adv_multi_criteria_permuted')) {
                         modelDataForAgg[modelName] = { permutedOrderData: rawData as PermutedOrderExperimentData };
                    }
                    // Add similar for basic 'multi_criteria' if an aggregator exists or is built
                }
            } catch (e: any) {
                console.warn(`Warn: Error processing ${experimentType} data for ${modelName} (${dataFile.fileName}): ${e.message}`);
            }
        }
    }

    // Step 2: Perform Aggregation (currently only for adv_multi_criteria_permuted)
    if (experimentType.startsWith('adv_multi_criteria_permuted')) {
        if (Object.keys(modelDataForAgg).length > 0) {
            const aggregatedSummary: AggregatedAdvancedPermutedOverallSummary | null = calculateAggregatedPermutedData(modelDataForAgg, Object.keys(modelDataForAgg));
            if (aggregatedSummary) {
                markdown += `#### Overall Aggregated Summary for Permuted Order (${aggregatedSummary.overallModelCount} Models)\n`;
                markdown += `- Task Name: ${aggregatedSummary.taskName}\n\n`;
                markdown += `**Item Scores by Criterion and Order (Aggregated Across Models):**\n`;
                aggregatedSummary.itemSummaries.forEach((item: AggregatedPermutedItemSummary) => {
                    markdown += `\n**Item: ${item.itemTitle}** (ID: ${item.itemId})\n`;
                    markdown += '| Criterion | Order | Avg. Score | Std. Dev. | Models |\n';
                    markdown += '|---|---|---|---|---|\n';
                    item.criteriaComparisons.forEach((critComp: AggregatedPermutedItemCriterionComparison) => {
                        critComp.scoresByOrder.forEach((orderByOrder: AggregatedPermutedCriterionOrderStats) => {
                            markdown += `| ${critComp.criterionName} | ${orderByOrder.orderName} | ${orderByOrder.averageScore?.toFixed(2) ?? 'N/A'} | ${orderByOrder.stdDevScore?.toFixed(2) ?? 'N/A'} | ${orderByOrder.modelCount} |\n`;
                        });
                    });
                });
                markdown += '\n';
            } else {
                markdown += "No aggregated permuted order summary could be calculated.\n\n";
            }
        } else {
            markdown += "No data available for aggregated permuted order summary.\n\n";
        }
        markdown += `\n#### Model-Specific Permuted Order Results\n`;
    } else if (experimentType.startsWith('multi_criteria')) { // Basic multi-criteria
        markdown += `#### Model-Specific Multi-Criteria Results (No Aggregation Implemented Yet)\n`;
    }

    // Step 3: Per-model details
    if (allModelRawData.length > 0) {
        allModelRawData.sort((a,b) => a.modelName.localeCompare(b.modelName)).forEach(modelResult => {
            markdown += `\n##### Model: ${modelResult.modelName}\n`;
            markdown += `File: \`${modelResult.fileName}\`\n\n`;

            if (experimentType.startsWith('adv_multi_criteria_permuted') && modelResult.data && Array.isArray(modelResult.data)) {
                const permutedData = modelResult.data as PermutedOrderExperimentData;
                permutedData.forEach((itemSummary: PermutedOrderItemSummary) => {
                    markdown += `**Item: ${itemSummary.item_title}** (ID: ${itemSummary.item_id})\n`;
                    itemSummary.order_comparison_results.forEach(criterionComp => {
                        markdown += `  - **Criterion: ${criterionComp.criterion_name}**\n`;
                        Object.entries(criterionComp.scores_by_order).forEach(([orderName, stats]: [string, PermutedOrderScoreStats]) => {
                            const avgScoreStr = typeof stats.avg === 'number' ? stats.avg.toFixed(2) : (stats.avg ?? 'N/A');
                            const stdDevStr = typeof stats.std === 'number' ? stats.std.toFixed(2) : (stats.std ?? 'N/A');
                            markdown += `    - ${orderName}: Avg Score: ${avgScoreStr} (StdDev: ${stdDevStr}, N: ${stats.n_scores}, Reps: ${stats.total_reps})\n`;
                        });
                    });
                    markdown += '\n';
                });
            } else if (experimentType.startsWith('multi_criteria') && modelResult.data && Array.isArray(modelResult.data)) {
                // Basic multi_criteria handling: (modelResult.data is MultiCriteriaExperimentData)
                // This assumes a structure like: [{ item_id: string, item_title?: string, scores: { criterion: score } }]
                const basicData = modelResult.data as any[]; // Cast to any for now
                basicData.forEach(item => {
                    markdown += `**Item: ${item.item_title || item.item_id}** (ID: ${item.item_id})\n`;
                    if(item.scores && typeof item.scores === 'object'){
                        for(const criterion in item.scores){
                            markdown += `  - ${criterion}: ${item.scores[criterion]}\n`;
                        }
                    }
                    markdown += '\n';
                });
            } else {
                markdown += `No specific data or unhandled data structure for ${modelResult.modelName} in file ${modelResult.fileName}.\n\n`;
            }
        });
    } else {
        markdown += `No model-specific ${experimentType} data processed.\n`;
    }

    return markdown;
} 