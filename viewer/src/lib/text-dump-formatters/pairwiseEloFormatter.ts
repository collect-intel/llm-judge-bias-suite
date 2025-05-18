import { calculateAggregatedEloData, ModelDataStatesForAggregation } from '../../utils/aggregationCalculators';
import { AggregatedEloOverallSummary, AggregatedEloVariantSummary, AggregatedEloItemStats } from '../../types/aggregatedPairwiseElo';
import { PairwiseEloExperimentDataWrapper, EloItemVariantSummary } from '../../types/pairwiseEloExperiment';
import { calculateCrossoverScoreForEloSet } from '../../utils/eloCrossoverCalculator';

// --- START: Types from Python output for ELO experiments ---
interface PythonEloFinalRankingItem {
  id: string;
  text_snippet: string;
  elo: number;
  W: number;
  L: number;
  T: number;
}

interface PythonEloVariantSummary_Py { 
  variant_name: string;
  system_prompt_used?: string; // Optional based on Python output structure
  user_prompt_template_used?: string; // Optional
  final_rankings: PythonEloFinalRankingItem[];
  // Add other fields from Python output for this variant summary if needed by the transform
}

interface PythonEloRankingSetSummary_Py { 
  ranking_set_id: string;
  criterion: string;
  item_count: number;
  variants_summary: PythonEloVariantSummary_Py[];
}

type PairwiseEloApiResponse_Py = PythonEloRankingSetSummary_Py[]; // What we fetch for one model
// --- END: Types from Python output for ELO experiments ---

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

// Transformation function similar to the one in all-results-report/page.tsx
const transformEloApiResponseToViewerData = (
  apiResponse: PairwiseEloApiResponse_Py
): PairwiseEloExperimentDataWrapper[] => {
  if (!apiResponse || !Array.isArray(apiResponse)) {
    return [];
  }
  return apiResponse.map(pyRankingSet => {
    const flattenedItems: EloItemVariantSummary[] = [];
    if (pyRankingSet.variants_summary && Array.isArray(pyRankingSet.variants_summary)) {
      pyRankingSet.variants_summary.forEach(pyVariantSummary => {
        if (pyVariantSummary.final_rankings && Array.isArray(pyVariantSummary.final_rankings)) {
          pyVariantSummary.final_rankings.forEach((item, index) => {
            flattenedItems.push({
              variant_name: pyVariantSummary.variant_name,
              rank: index + 1, 
              item_id: item.id,
              elo_rating: item.elo,
              wins: item.W,
              losses: item.L,
              ties: item.T,
              item_text_snippet: item.text_snippet,
            });
          });
        }
      });
    }
    return {
      criterion: pyRankingSet.criterion,
      ranking_set_id: pyRankingSet.ranking_set_id,
      variants_summary: flattenedItems, 
    };
  });
};

export async function formatPairwiseEloExperimentDataToMarkdown(
    experimentMeta: ExperimentScanData,
    protocol: string,
    host: string
): Promise<string> {
    let markdown = "";
    const modelDataForAgg: ModelDataStatesForAggregation = {};
    const allModelEloResults: Array<{ 
        modelName: string, 
        fileName: string, 
        rawData: PairwiseEloApiResponse_Py, // Store raw python output
        transformedData: PairwiseEloExperimentDataWrapper[] // Store transformed data
    }> = [];

    // Step 1: Fetch and transform data for all models
    for (const modelName of experimentMeta.modelNames.sort()) {
        const modelFiles = experimentMeta.models[modelName];
        // Find any file that starts with 'pairwise_elo' for this model.
        const eloFile = modelFiles?.find(f => f.experimentType.startsWith('pairwise_elo')); 

        if (eloFile) {
            try {
                const getExperimentDataUrl = new URL(`/api/get-experiment-data?filePath=${encodeURIComponent(eloFile.filePath)}`, `${protocol}://${host}`);
                const dataResponse = await fetch(getExperimentDataUrl.toString());
                if (!dataResponse.ok) {
                    const errorData: ApiError = await dataResponse.json();
                    console.warn(`Warn: Failed to fetch ELO data for ${modelName}: ${errorData.error}`);
                    continue; 
                }
                const rawData: PairwiseEloApiResponse_Py = await dataResponse.json();
                if (rawData && rawData.length > 0) {
                    const transformedData = transformEloApiResponseToViewerData(rawData);
                    allModelEloResults.push({ modelName, fileName: eloFile.fileName, rawData, transformedData });
                    // For aggregation, we often aggregate one ranking set at a time.
                    // If multiple sets are in a file, the current aggregator might only use the first.
                    // Let's pass the first transformed set for aggregation if available.
                    if (transformedData.length > 0) {
                         modelDataForAgg[modelName] = { pairwiseEloData: transformedData[0] };
                    }
                }
            } catch (e: any) {
                console.warn(`Warn: Error processing ELO data for ${modelName} (${eloFile.fileName}): ${e.message}`);
            }
        }
    }

    // Step 2: Perform Aggregation (if data was collected)
    if (Object.keys(modelDataForAgg).length > 0) {
        const aggregatedSummary: AggregatedEloOverallSummary | null = calculateAggregatedEloData(modelDataForAgg, Object.keys(modelDataForAgg));
        if (aggregatedSummary) {
            markdown += `#### Overall Aggregated Pairwise ELO Summary (${aggregatedSummary.overallModelCount} Models)\n`;
            if (aggregatedSummary.rankingSetId) {
                 markdown += `- Ranking Set ID: ${aggregatedSummary.rankingSetId}\n`;
            }
            if (aggregatedSummary.criterion) {
                 markdown += `- Criterion: ${aggregatedSummary.criterion}\n`;
            }
            markdown += `- Unique Items Ranked Across All Models: ${aggregatedSummary.overallUniqueItemsRanked}\n\n`;
            markdown += `**Aggregated ELO Rankings by Variant (across models):**\n`;
            aggregatedSummary.variantsSummaries.forEach((aggVariant: AggregatedEloVariantSummary) => {
                markdown += `\n##### Variant: ${aggVariant.variantName} (Aggregated over ${aggVariant.modelCountOverall} models)\n`;
                markdown += '| Rank | Item ID | Avg. ELO | StdDev ELO | Avg. Rank | StdDev Rank | Total W/L/T | Snippet |\n';
                markdown += '|---|---|---|---|---|---|---|---|\n';
                aggVariant.itemsAggregatedStats.slice(0, 15).forEach((item, index) => { // Show top 15
                    markdown += `| ${index + 1} | ${item.item_id} | ${item.averageEloRating?.toFixed(0) ?? 'N/A'} | ${item.stdDevEloRating?.toFixed(0) ?? 'N/A'} | ${item.averageRank?.toFixed(1) ?? 'N/A'} | ${item.stdDevRank?.toFixed(1) ?? 'N/A'} | ${item.totalWins}/${item.totalLosses}/${item.totalTies} | ${item.item_text_snippet?.substring(0,30) ?? ''}... |\n`;
                });
                markdown += '\n';
            });
        } else {
            markdown += "No aggregated ELO summary could be calculated (possibly due to multiple ranking sets per file, aggregation focuses on first).\n\n";
        }
    } else {
        markdown += "No data available for aggregated ELO summary.\n\n";
    }

    markdown += `#### Model-Specific Pairwise ELO Results\n`;
    if (allModelEloResults.length > 0) {
        allModelEloResults.sort((a,b) => a.modelName.localeCompare(b.modelName)).forEach(modelResult => {
            markdown += `\n##### Model: ${modelResult.modelName}\n`;
            markdown += `File: \`${modelResult.fileName}\`\n\n`;
            if (modelResult.transformedData && modelResult.transformedData.length > 0) {
                modelResult.transformedData.forEach((rankingSet: PairwiseEloExperimentDataWrapper) => {
                    markdown += `###### Ranking Set ID: ${rankingSet.ranking_set_id} | Criterion: ${rankingSet.criterion}\n`;
                    
                    // Calculate and display Crossover Score for this ranking set and model
                    const crossoverScore = calculateCrossoverScoreForEloSet(rankingSet);
                    if (crossoverScore !== undefined) {
                        markdown += `  - **Ranking Set Stability (Crossover Score)**: ${crossoverScore} (Lower is better; indicates how often item rankings flip between variants)\n`;
                    }
                    markdown += '\n';

                    // Group by variant for this ranking set
                    const variantsInSet: Record<string, EloItemVariantSummary[]> = {};
                    rankingSet.variants_summary.forEach(itemSummary => {
                        if (!variantsInSet[itemSummary.variant_name]) {
                            variantsInSet[itemSummary.variant_name] = [];
                        }
                        variantsInSet[itemSummary.variant_name].push(itemSummary);
                    });

                    for (const variantName in variantsInSet) {
                        markdown += `**Variant: ${variantName}**\n`;
                        markdown += '| Rank | Item ID | ELO | Wins | Losses | Ties | Snippet |\n';
                        markdown += '|---|---|---|---|---|---|---|\n';
                        // Sort items by rank for display
                        variantsInSet[variantName].sort((a,b) => a.rank - b.rank).forEach(item => {
                            markdown += `| ${item.rank} | ${item.item_id} | ${item.elo_rating.toFixed(0)} | ${item.wins} | ${item.losses} | ${item.ties} | ${item.item_text_snippet?.substring(0,30) ?? ''}... |\n`;
                        });
                        markdown += '\n';
                    }
                });
            } else {
                markdown += `No ELO data processed for ${modelResult.modelName} in file ${modelResult.fileName}.\n\n`;
            }
        });
    } else {
        markdown += "No model-specific ELO data processed.\n";
    }

    return markdown;
} 