import { calculateAggregatedClassificationData, ModelDataStatesForAggregation } from '../../utils/aggregationCalculators';
import {
    AggregatedClassificationOverallSummary,
    AggregatedClassificationModelStats,
    AggregatedClassificationStrategyStats,
    AggregatedClassificationSensitiveItem,
    AggregatedClassificationCell // If needed for detailed tables
} from '../../types/aggregatedClassification';
import {
    ClassificationExperimentData, // This is typically: ClassificationItemStrategyPairResult[]
    ClassificationItemStrategyPairResult,
    ClassificationItemDetails,
    ClassificationStrategyDetails
} from '../../types/classificationExperiment';

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

export async function formatClassificationExperimentDataToMarkdown(
    experimentMeta: ExperimentScanData,
    protocol: string,
    host: string
): Promise<string> {
    let markdown = "";
    const modelDataForAgg: ModelDataStatesForAggregation = {};
    const allModelClassificationResults: Array<{
        modelName: string,
        fileName: string,
        data: ClassificationExperimentData // Array of ClassificationItemStrategyPairResult
    }> = [];

    // Step 1: Fetch data for all models
    for (const modelName of experimentMeta.modelNames.sort()) {
        const modelFiles = experimentMeta.models[modelName];
        const classFile = modelFiles?.find(f => f.experimentType === 'classification');

        if (classFile) {
            try {
                const getExperimentDataUrl = new URL(`/api/get-experiment-data?filePath=${encodeURIComponent(classFile.filePath)}`, `${protocol}://${host}`);
                const dataResponse = await fetch(getExperimentDataUrl.toString());
                if (!dataResponse.ok) {
                    const errorData: ApiError = await dataResponse.json();
                    console.warn(`Warn: Failed to fetch classification data for ${modelName}: ${errorData.error}`);
                    continue;
                }
                const rawData: ClassificationExperimentData = await dataResponse.json();
                if (rawData && rawData.length > 0) {
                    allModelClassificationResults.push({ modelName, fileName: classFile.fileName, data: rawData });
                    modelDataForAgg[modelName] = { classificationExperimentData: rawData };
                }
            } catch (e: any) {
                console.warn(`Warn: Error processing classification data for ${modelName} (${classFile.fileName}): ${e.message}`);
            }
        }
    }

    // Step 2: Perform Aggregation
    if (Object.keys(modelDataForAgg).length > 0) {
        const aggregatedSummary: AggregatedClassificationOverallSummary | null = calculateAggregatedClassificationData(modelDataForAgg, Object.keys(modelDataForAgg));
        if (aggregatedSummary) {
            markdown += `#### Overall Aggregated Classification Summary (${aggregatedSummary.overallModelCount} Models)\n`;
            markdown += `- Total Unique Items Analyzed: ${aggregatedSummary.totalUniqueItemsAnalysed}\n`;
            markdown += `- Total Unique Strategies Analyzed: ${aggregatedSummary.totalUniqueStrategiesAnalysed}\n`;
            markdown += `- Ambiguous Items in Set: ${aggregatedSummary.totalAmbiguousItemsInSet} / ${aggregatedSummary.totalUniqueItemsAnalysed}\n`;
            markdown += `- Control Items in Set: ${aggregatedSummary.totalControlItemsInSet} / ${aggregatedSummary.totalUniqueItemsAnalysed}\n\n`;

            markdown += `##### Model Sensitivity & Escape Hatch Usage:\n`;
            markdown += '| Model | Total Items Seen | Ambiguous Items Seen | Sensitive Item Count | Sensitivity Score (%) | Escape Hatch Uses (Total/Ambiguous/Control) |\n';
            markdown += '|---|---|---|---|---|---|\n';
            aggregatedSummary.modelOverallStats.forEach((stats: AggregatedClassificationModelStats) => {
                markdown += `| ${stats.modelName} | ${stats.totalItemsSeenByModel} | ${stats.totalAmbiguousItemsSeenByModel} | ${stats.sensitiveItemCount} | ${stats.sensitivityScore.toFixed(2)}% | ${stats.escapeHatchStats.totalUses}/${stats.escapeHatchStats.onAmbiguousItems}/${stats.escapeHatchStats.onControlItems} |\n`;
            });
            markdown += '\n';

            markdown += `##### Strategy Performance (Sorted by Unanimous Agreement Desc, then Avg. Diversity Asc):\n`;
            markdown += '| Strategy ID | Description | Avg. Item Diversity | % Unanimous Agreement | Unique Models | Unique Items |\n';
            markdown += '|---|---|---|---|---|---|\n';
            aggregatedSummary.strategyStats.forEach((stats: AggregatedClassificationStrategyStats) => {
                markdown += `| ${stats.strategyId} | ${stats.strategyDescription.substring(0,50)}... | ${stats.averageItemClassificationDiversity.toFixed(2)} | ${stats.percentageItemsWithUnanimousAgreement.toFixed(2)}% | ${stats.uniqueModelsThatUsedStrategyCount} | ${stats.uniqueItemIdsProcessedCount} |\n`;
            });
            markdown += '\n';

            markdown += `##### Top Sensitive Items (Most Classification Variation - Max 20 Shown):\n`;
            markdown += '| Item ID | Ambiguity | Control | Diversity Score | Distinct Classifications (Count) | Models Showing Sensitivity | Snippet |\n';
            markdown += '|---|---|---|---|---|---|---|\n';
            aggregatedSummary.topSensitiveItems.forEach((item: AggregatedClassificationSensitiveItem) => {
                const distinctClassStr = item.distinctClassifications.map(dc => `${dc.categoryId}(${dc.count})`).join(', ');
                markdown += `| ${item.itemId} | ${item.ambiguityScore?.toFixed(1) ?? 'N/A'} | ${item.isControlItem} | ${item.itemDiversityScore} | ${distinctClassStr} | ${item.modelsShowingSensitivity.join(', ') || 'None'} | ${item.itemTextSnippet} |\n`;
            });
            markdown += '\n';

        } else {
            markdown += "No aggregated classification summary could be calculated.\n\n";
        }
    } else {
        markdown += "No data available for aggregated classification summary.\n\n";
    }

    markdown += `#### Model-Specific Classification Highlights (Illustrative - To Be Enhanced)\n`;
    if (allModelClassificationResults.length > 0) {
        allModelClassificationResults.sort((a,b) => a.modelName.localeCompare(b.modelName)).forEach(modelResult => {
            markdown += `\n##### Model: ${modelResult.modelName}\n`;
            markdown += `File: \`${modelResult.fileName}\`\n`;
            if (modelResult.data && modelResult.data.length > 0) {
                const totalPairs = modelResult.data.length;
                const errors = modelResult.data.filter(pair => pair.error_type).length;
                const successful = totalPairs - errors;
                markdown += `- Total Item-Strategy Pairs Processed: ${totalPairs}\n`;
                markdown += `- Successful Classifications: ${successful}\n`;
                markdown += `- Errors (API/Parse/NoMajority): ${errors}\n`;
                // Add more specific insights if needed, e.g., breakdown by error_type
                // Or list a few examples of classifications for this model
                 markdown += '\n';
            } else {
                markdown += `No classification data processed for ${modelResult.modelName} in file ${modelResult.fileName}.\n\n`;
            }
        });
    } else {
        markdown += "No model-specific classification data processed.\n";
    }

    return markdown;
} 