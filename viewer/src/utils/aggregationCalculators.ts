import { ProcessedPickingData } from '@/components/PickingExperimentCharts';
import { AggregatedPickingSummary, AggregatedPickingVariantSchemeData } from '@/types/aggregatedPicking';
import { AggregatedScoringOverallSummary, AggregatedScoringVariantSummary, AggregatedScoringItemStats } from '@/types/aggregatedScoring';
import { ScoringVariantResult, ScoringItemResult } from '@/types/scoringExperiment';
import { AggregatedEloOverallSummary, AggregatedEloVariantSummary, AggregatedEloItemStats } from '@/types/aggregatedPairwiseElo';
import { PairwiseEloExperimentDataWrapper } from '@/types/pairwiseEloExperiment';
import { AggregatedAdvancedPermutedOverallSummary, AggregatedPermutedItemSummary, AggregatedPermutedItemCriterionComparison, AggregatedPermutedCriterionOrderStats } from '@/types/aggregatedAdvancedPermuted';
import { PermutedOrderExperimentData, IsolatedHolisticExperimentData } from '@/types/advancedMultiCriteriaExperiment';
import { AggregatedAdvancedIsolatedOverallSummary, AggregatedIsolatedItemSummary, AggregatedIsolatedHolisticCriterionStats } from '@/types/aggregatedAdvancedIsolated';

interface PickingPairDetail {
  pair_id: string;
  text1_id: string; // Represents the content referred to as "text_A" in runX_order
  text2_id: string; // Represents the content referred to as "text_B" in runX_order
  run1_order: string;
  run2_order: string;
  run1_pick_distribution?: { [key: string]: number }; // Keys are "text_A", "text_B"
  run2_pick_distribution?: { [key: string]: number };
  // ... other fields
}

interface PickingExperimentSchemeResult {
  model_name: string;
  variant_name: string;
  labeling_scheme_name: string;
  scheme_description: string;
  scheme_display_label1: string;
  scheme_display_label2: string;
  repetitions_per_order_run: number;
  total_pairs_tested_in_scheme: number;
  pairs_summary_for_scheme: PickingPairDetail[];
  // ... other fields from the JSON like bias rates, favored counts for the model-level summary
  positional_bias_rate_percentage: number;
  consistency_rate_percentage: number;
  favored_scheme_label1_count: number;
  favored_scheme_label2_count: number;
  favored_position_inconclusive_count: number;
  valid_pairs_for_bias_calculation: number;

}

type PickingExperimentApiResponse = PickingExperimentSchemeResult[];

export interface ModelDataForAggregation {
  rawPickingData?: PickingExperimentApiResponse | null;
  processedPickingData?: ProcessedPickingData[] | null;
  scoringExperimentData?: ScoringVariantResult[] | null;
  pairwiseEloData?: PairwiseEloExperimentDataWrapper | null;
  permutedOrderData?: PermutedOrderExperimentData | null;
  isolatedHolisticData?: IsolatedHolisticExperimentData | null;
}

export type ModelDataStatesForAggregation = Record<string, ModelDataForAggregation>;

export const calculateAggregatedPickingData = (
    modelDataStates: ModelDataStatesForAggregation,
    currentSelectedModels: string[]
  ): AggregatedPickingSummary | null => {
    if (!currentSelectedModels || currentSelectedModels.length === 0) {
      return null;
    }

    const allRawPickingDataFromModels: { modelName: string, rawData: PickingExperimentApiResponse }[] = [];
    const allProcessedDataForAverages: { modelName: string, data: ProcessedPickingData[] }[] = [];

    currentSelectedModels.forEach(modelName => {
      const modelState = modelDataStates[modelName];
      if (modelState) {
        if (modelState.rawPickingData && modelState.rawPickingData.length > 0) {
          allRawPickingDataFromModels.push({ modelName, rawData: modelState.rawPickingData });
        }
        if (modelState.processedPickingData && modelState.processedPickingData.length > 0) {
          allProcessedDataForAverages.push({ modelName, data: modelState.processedPickingData });
        }
      }
    });

    if (allRawPickingDataFromModels.length === 0 && allProcessedDataForAverages.length === 0) {
      return null;
    }

    const groupedByVariantSchemeForAverages: Record<string, {
      variantName: string;
      labelingSchemeName: string;
      schemeDescription: string;
      schemeDisplayLabel1: string;
      schemeDisplayLabel2: string;
      biasRates: number[];
      consistencyRates: number[];
      favoredLabel1Counts: number[];
      favoredLabel2Counts: number[];
      favoredPositionInconclusiveCounts: number[];
      modelsShowingBiasCounts: number[];
      modelNames: Set<string>;
      totalFirstSlotPicks_temp: number;
      totalDecisions_temp: number;
    }> = {};

    allProcessedDataForAverages.forEach(modelEntry => {
      modelEntry.data.forEach(item => {
        const key = `${item.variantName}---${item.labelingSchemeName}`;
        if (!groupedByVariantSchemeForAverages[key]) {
          groupedByVariantSchemeForAverages[key] = {
            variantName: item.variantName,
            labelingSchemeName: item.labelingSchemeName,
            schemeDescription: item.schemeDescription,
            schemeDisplayLabel1: item.schemeDisplayLabel1,
            schemeDisplayLabel2: item.schemeDisplayLabel2,
            biasRates: [], consistencyRates: [], favoredLabel1Counts: [],
            favoredLabel2Counts: [], favoredPositionInconclusiveCounts: [],
            modelsShowingBiasCounts: [], modelNames: new Set<string>(),
            totalFirstSlotPicks_temp: 0, totalDecisions_temp: 0,
          };
        }
        const group = groupedByVariantSchemeForAverages[key];
        group.modelNames.add(modelEntry.modelName);
        if (item.biasRate !== undefined) group.biasRates.push(item.biasRate);
        if (item.consistencyRate !== undefined) group.consistencyRates.push(item.consistencyRate);
        
        const hasBias = item.biasRate > 0 && item.totalValidPairsForBias > 0;
        group.modelsShowingBiasCounts.push(hasBias ? 1 : 0);
        group.favoredLabel1Counts.push(item.favoredLabel1Count > 0 ? 1 : 0);
        group.favoredLabel2Counts.push(item.favoredLabel2Count > 0 ? 1 : 0);
        group.favoredPositionInconclusiveCounts.push(item.favoredPositionInconclusiveCount > 0 ? 1 : 0);
      });
    });

    allRawPickingDataFromModels.forEach(modelEntry => {
      modelEntry.rawData.forEach(schemeResult => {
        const key = `${schemeResult.variant_name}---${schemeResult.labeling_scheme_name}`;
        if (groupedByVariantSchemeForAverages[key]) {
          const group = groupedByVariantSchemeForAverages[key];
          group.modelNames.add(modelEntry.modelName);

          schemeResult.pairs_summary_for_scheme.forEach(pairDetail => {
            const reps = schemeResult.repetitions_per_order_run || 1;
            
            const run1Slot1ContentKey = "text_A";
            const run1PicksForSlot1 = pairDetail.run1_pick_distribution?.[run1Slot1ContentKey] || 0;
            group.totalFirstSlotPicks_temp += run1PicksForSlot1;
            group.totalDecisions_temp += reps;

            const run2Slot1ContentKey = "text_B"; 
            const run2PicksForSlot1 = pairDetail.run2_pick_distribution?.[run2Slot1ContentKey] || 0;
            group.totalFirstSlotPicks_temp += run2PicksForSlot1;
            group.totalDecisions_temp += reps;
          });
        }
      });
    });
    
    let grandTotalFirstSlotPicks_overall = 0;
    let grandTotalDecisions_overall = 0;

    const aggregatedVariantSchemes: AggregatedPickingVariantSchemeData[] = Object.values(groupedByVariantSchemeForAverages).map(group => {
      const biasRates = group.biasRates.filter(r => r !== undefined && !isNaN(r));
      const consistencyRates = group.consistencyRates.filter(r => r !== undefined && !isNaN(r));
      
      const avgBias = biasRates.length > 0 ? biasRates.reduce((a, b) => a + b, 0) / biasRates.length : 0;
      const stdDevBias = biasRates.length > 1 ? Math.sqrt(biasRates.map(x => Math.pow(x - avgBias, 2)).reduce((a, b) => a + b, 0) / (biasRates.length -1)) : 0;
      
      const avgConsistency = consistencyRates.length > 0 ? consistencyRates.reduce((a, b) => a + b, 0) / consistencyRates.length : 0;
      const stdDevConsistency = consistencyRates.length > 1 ? Math.sqrt(consistencyRates.map(x => Math.pow(x - avgConsistency, 2)).reduce((a, b) => a + b, 0) / (consistencyRates.length -1)) : 0;

      const overallFirstSlotPreferencePercentage = group.totalDecisions_temp > 0
        ? (group.totalFirstSlotPicks_temp / group.totalDecisions_temp) * 100
        : 0;
        
      grandTotalFirstSlotPicks_overall += group.totalFirstSlotPicks_temp;
      grandTotalDecisions_overall += group.totalDecisions_temp;

      return {
        variantName: group.variantName,
        labelingSchemeName: group.labelingSchemeName,
        schemeDescription: group.schemeDescription,
        schemeDisplayLabel1: group.schemeDisplayLabel1,
        schemeDisplayLabel2: group.schemeDisplayLabel2,
        modelCount: group.modelNames.size,
        averageBiasRate: parseFloat(avgBias.toFixed(2)),
        stdDevBiasRate: parseFloat(stdDevBias.toFixed(2)),
        averageConsistencyRate: parseFloat(avgConsistency.toFixed(2)),
        stdDevConsistencyRate: parseFloat(stdDevConsistency.toFixed(2)),
        totalModelsFavoredLabel1: group.favoredLabel1Counts.reduce((a,b) => a+b, 0),
        totalModelsFavoredLabel2: group.favoredLabel2Counts.reduce((a,b) => a+b, 0),
        totalModelsFavoredPositionInconclusive: group.favoredPositionInconclusiveCounts.reduce((a,b) => a+b, 0),
        totalModelsShowingBias: group.modelsShowingBiasCounts.reduce((a,b) => a+b, 0),
        totalFirstSlotPicksAcrossModelsAndRepetitions: group.totalFirstSlotPicks_temp,
        totalDecisionsAcrossModelsAndRepetitions: group.totalDecisions_temp,
        overallFirstSlotPreferencePercentage: parseFloat(overallFirstSlotPreferencePercentage.toFixed(2)),
      };
    });
    
    const grandOverallFirstSlotPreferencePercentage_calc = grandTotalDecisions_overall > 0
        ? (grandTotalFirstSlotPicks_overall / grandTotalDecisions_overall) * 100
        : 0;

    return {
      experimentType: 'picking',
      overallModelCount: new Set(allRawPickingDataFromModels.map(m => m.modelName)
                                .concat(allProcessedDataForAverages.map(m => m.modelName))).size,
      aggregatedVariantSchemes: aggregatedVariantSchemes.sort((a,b) => a.variantName.localeCompare(b.variantName) || a.labelingSchemeName.localeCompare(b.labelingSchemeName)),
      grandTotalFirstSlotPicks: grandTotalFirstSlotPicks_overall,
      grandTotalDecisions: grandTotalDecisions_overall,
      grandOverallFirstSlotPreferencePercentage: parseFloat(grandOverallFirstSlotPreferencePercentage_calc.toFixed(2)),
    };
  };

export const calculateAggregatedScoringData = (
    modelDataStates: ModelDataStatesForAggregation,
    currentSelectedModels: string[]
  ): AggregatedScoringOverallSummary | null => {
    if (!currentSelectedModels || currentSelectedModels.length === 0) {
      return null;
    }

    const allScoringVariantResultsFromModels: { modelName: string, variantResult: ScoringVariantResult }[] = [];
    currentSelectedModels.forEach(modelName => {
      const modelState = modelDataStates[modelName];
      if (modelState && modelState.scoringExperimentData) {
        modelState.scoringExperimentData.forEach((variantResult: ScoringVariantResult) => {
          allScoringVariantResultsFromModels.push({ modelName, variantResult });
        });
      }
    });

    if (allScoringVariantResultsFromModels.length === 0) {
      return null;
    }

    const uniqueModelNamesOverall = new Set(allScoringVariantResultsFromModels.map(entry => entry.modelName));
    const aggregatedVariants: AggregatedScoringVariantSummary[] = [];
    const allProcessedItemIds = new Set<string>();

    const groupedByVariantName: Record<string, { modelName: string, variantResult: ScoringVariantResult }[]> = {};
    allScoringVariantResultsFromModels.forEach(entry => {
      const variantName = entry.variantResult.variant_config.name;
      if (!groupedByVariantName[variantName]) {
        groupedByVariantName[variantName] = [];
      }
      groupedByVariantName[variantName].push(entry);
    });

    for (const variantName in groupedByVariantName) {
      const entriesForVariant = groupedByVariantName[variantName];
      const uniqueModelsForVariant = new Set(entriesForVariant.map(e => e.modelName));
      const aggregatedItemsStats: AggregatedScoringItemStats[] = [];
      const allNormalizedScoresForVariantOverall: (number | null)[] = [];

      const itemsInVariant: Record<string, { item_id: string, item_title?: string, item_text_snippet: string, dataset_name: string, scores: (number | null)[], modelNames: Set<string>}> = {};
      
      entriesForVariant.forEach(modelEntry => {
        modelEntry.variantResult.detailed_item_results.forEach((itemResult: ScoringItemResult) => {
          allProcessedItemIds.add(itemResult.item_id);
          if (!itemsInVariant[itemResult.item_id]) {
            itemsInVariant[itemResult.item_id] = {
              item_id: itemResult.item_id,
              item_title: itemResult.item_title,
              item_text_snippet: itemResult.item_text_snippet,
              dataset_name: itemResult.dataset_name,
              scores: [],
              modelNames: new Set<string>()
            };
          }
          if (itemResult.avg_normalized_score_for_item !== undefined) {
            itemsInVariant[itemResult.item_id].scores.push(itemResult.avg_normalized_score_for_item);
            allNormalizedScoresForVariantOverall.push(itemResult.avg_normalized_score_for_item);
          }
          itemsInVariant[itemResult.item_id].modelNames.add(modelEntry.modelName);
        });
      });

      for (const itemId in itemsInVariant) {
        const itemData = itemsInVariant[itemId];
        const validScores = itemData.scores.filter(s => s !== null && !isNaN(s)) as number[];
        const avgScore = validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / validScores.length : null;
        const stdDevScore = validScores.length > 1 ? Math.sqrt(validScores.map(x => Math.pow(x - (avgScore || 0), 2)).reduce((a, b) => a + b, 0) / (validScores.length - 1)) : (validScores.length === 1 ? 0 : null);

        aggregatedItemsStats.push({
          item_id: itemData.item_id,
          item_title: itemData.item_title,
          item_text_snippet: itemData.item_text_snippet,
          dataset_name: itemData.dataset_name,
          modelCount: itemData.modelNames.size,
          averageNormalizedScore: avgScore !== null ? parseFloat(avgScore.toFixed(2)) : null,
          stdDevNormalizedScore: stdDevScore !== null ? parseFloat(stdDevScore.toFixed(2)) : null,
          allNormalizedScores: itemData.scores, 
        });
      }
      
      const validOverallScoresForVariant = allNormalizedScoresForVariantOverall.filter(s => s !== null && !isNaN(s)) as number[];
      const overallAvgScoreForVariant = validOverallScoresForVariant.length > 0 ? validOverallScoresForVariant.reduce((a,b) => a+b, 0) / validOverallScoresForVariant.length : null;
      const overallStdDevForVariant = validOverallScoresForVariant.length > 1 ? Math.sqrt(validOverallScoresForVariant.map(x => Math.pow(x - (overallAvgScoreForVariant || 0), 2)).reduce((a,b) => a+b, 0) / (validOverallScoresForVariant.length -1)) : (validOverallScoresForVariant.length === 1 ? 0 : null);

      aggregatedVariants.push({
        variantName: variantName,
        variantConfig: entriesForVariant[0]?.variantResult.variant_config, 
        modelCountOverall: uniqueModelsForVariant.size,
        itemCountOverall: Object.keys(itemsInVariant).length,
        overallAverageNormalizedScore: overallAvgScoreForVariant !== null ? parseFloat(overallAvgScoreForVariant.toFixed(2)) : null,
        overallStdDevNormalizedScore: overallStdDevForVariant !== null ? parseFloat(overallStdDevForVariant.toFixed(2)) : null,
        itemsAggregatedStats: aggregatedItemsStats.sort((a,b) => a.item_id.localeCompare(b.item_id)),
      });
    }

    return {
      experimentType: 'scoring',
      overallModelCount: uniqueModelNamesOverall.size,
      overallUniqueItemsScored: allProcessedItemIds.size,
      variantsSummaries: aggregatedVariants.sort((a,b) => a.variantName.localeCompare(b.variantName)),
    };
  };

export const calculateAggregatedEloData = (
    modelDataStates: ModelDataStatesForAggregation,
    currentSelectedModels: string[]
  ): AggregatedEloOverallSummary | null => {
    if (!currentSelectedModels || currentSelectedModels.length === 0) {
      return null;
    }

    const allEloVariantDataFromModels: {
      modelName: string;
      criterion?: string | null; 
      rankingSetId?: string | null; 
      variantName: string;
      rank: number;
      item_id: string;
      elo_rating: number;
      wins: number;
      losses: number;
      ties: number;
      item_text_snippet?: string;
    }[] = [];

    currentSelectedModels.forEach(modelName => {
      const modelState = modelDataStates[modelName];
      if (modelState && modelState.pairwiseEloData && modelState.pairwiseEloData.variants_summary) {
        modelState.pairwiseEloData.variants_summary.forEach(itemSummary => {
          allEloVariantDataFromModels.push({
            modelName,
            criterion: modelState.pairwiseEloData?.criterion,
            rankingSetId: modelState.pairwiseEloData?.ranking_set_id,
            variantName: itemSummary.variant_name,
            rank: itemSummary.rank,
            item_id: itemSummary.item_id,
            elo_rating: itemSummary.elo_rating,
            wins: itemSummary.wins,
            losses: itemSummary.losses,
            ties: itemSummary.ties,
            item_text_snippet: itemSummary.item_text_snippet,
          });
        });
      }
    });

    if (allEloVariantDataFromModels.length === 0) {
      return null;
    }

    const uniqueModelNamesOverall = new Set(allEloVariantDataFromModels.map(entry => entry.modelName));
    const allProcessedItemIds = new Set<string>();
    const aggregatedVariants: AggregatedEloVariantSummary[] = [];

    const groupedByVariantName: Record<string, typeof allEloVariantDataFromModels> = {};
    allEloVariantDataFromModels.forEach(entry => {
      if (!groupedByVariantName[entry.variantName]) {
        groupedByVariantName[entry.variantName] = [];
      }
      groupedByVariantName[entry.variantName].push(entry);
    });

    let overallCriterion: string | null | undefined = undefined;
    let overallRankingSetId: string | null | undefined = undefined;
    if (allEloVariantDataFromModels.length > 0) {
      overallCriterion = allEloVariantDataFromModels[0].criterion;
      overallRankingSetId = allEloVariantDataFromModels[0].rankingSetId;
    }

    for (const variantName in groupedByVariantName) {
      const entriesForVariant = groupedByVariantName[variantName];
      const uniqueModelsForVariant = new Set(entriesForVariant.map(e => e.modelName));
      const itemsInVariant: Record<string, {
        item_id: string;
        item_text_snippet?: string;
        elos: number[];
        ranks: number[];
        totalWins: number;
        totalLosses: number;
        totalTies: number;
        modelNames: Set<string>;
      }> = {};

      entriesForVariant.forEach(entry => {
        allProcessedItemIds.add(entry.item_id);
        if (!itemsInVariant[entry.item_id]) {
          itemsInVariant[entry.item_id] = {
            item_id: entry.item_id,
            item_text_snippet: entry.item_text_snippet,
            elos: [],
            ranks: [],
            totalWins: 0,
            totalLosses: 0,
            totalTies: 0,
            modelNames: new Set<string>(),
          };
        }
        itemsInVariant[entry.item_id].elos.push(entry.elo_rating);
        itemsInVariant[entry.item_id].ranks.push(entry.rank);
        itemsInVariant[entry.item_id].totalWins += entry.wins;
        itemsInVariant[entry.item_id].totalLosses += entry.losses;
        itemsInVariant[entry.item_id].totalTies += entry.ties;
        itemsInVariant[entry.item_id].modelNames.add(entry.modelName);
      });

      const aggregatedItemsStats: AggregatedEloItemStats[] = Object.values(itemsInVariant).map(itemData => {
        const elos = itemData.elos.filter(e => e !== null && !isNaN(e));
        const ranks = itemData.ranks.filter(r => r !== null && !isNaN(r));
        
        const avgElo = elos.length > 0 ? elos.reduce((a, b) => a + b, 0) / elos.length : null;
        const stdDevElo = elos.length > 1 ? Math.sqrt(elos.map(x => Math.pow(x - (avgElo || 0), 2)).reduce((a, b) => a + b, 0) / (elos.length -1)) : (elos.length === 1 ? 0 : null);
        
        const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
        const stdDevRank = ranks.length > 1 ? Math.sqrt(ranks.map(x => Math.pow(x - (avgRank || 0), 2)).reduce((a, b) => a + b, 0) / (ranks.length -1)) : (ranks.length === 1 ? 0 : null);

        return {
          item_id: itemData.item_id,
          item_text_snippet: itemData.item_text_snippet,
          modelCount: itemData.modelNames.size,
          averageEloRating: avgElo !== null ? parseFloat(avgElo.toFixed(1)) : null, 
          stdDevEloRating: stdDevElo !== null ? parseFloat(stdDevElo.toFixed(1)) : null,
          averageRank: avgRank !== null ? parseFloat(avgRank.toFixed(1)) : null,
          stdDevRank: stdDevRank !== null ? parseFloat(stdDevRank.toFixed(1)) : null,
          totalWins: itemData.totalWins,
          totalLosses: itemData.totalLosses,
          totalTies: itemData.totalTies,
        };
      });

      aggregatedVariants.push({
        variantName: variantName,
        modelCountOverall: uniqueModelsForVariant.size,
        itemCountOverall: Object.keys(itemsInVariant).length,
        itemsAggregatedStats: aggregatedItemsStats.sort((a,b) => (b.averageEloRating ?? -Infinity) - (a.averageEloRating ?? -Infinity) || a.item_id.localeCompare(b.item_id)),
      });
    }

    return {
      experimentType: 'pairwise_elo',
      overallModelCount: uniqueModelNamesOverall.size,
      overallUniqueItemsRanked: allProcessedItemIds.size,
      criterion: overallCriterion,
      rankingSetId: overallRankingSetId,
      variantsSummaries: aggregatedVariants.sort((a,b) => a.variantName.localeCompare(b.variantName)),
    };
  };

export const calculateAggregatedPermutedData = (
    modelDataStates: ModelDataStatesForAggregation,
    currentSelectedModels: string[]
  ): AggregatedAdvancedPermutedOverallSummary | null => {
    if (!currentSelectedModels || currentSelectedModels.length === 0) return null;

    const allPermutedData: {
      modelName: string;
      taskName: string; 
      itemId: string;
      itemTitle?: string;
      criterionName: string;
      orderName: string;
      avgScore: number | null;
      stdDevScore: number | null;
    }[] = [];

    let firstTaskName: string | undefined = undefined;

    currentSelectedModels.forEach(modelName => {
      const modelState = modelDataStates[modelName];
      if (modelState && modelState.permutedOrderData) {
        modelState.permutedOrderData.forEach(itemSummary => {
          if (!firstTaskName) {
            const firstOrderName = itemSummary.order_comparison_results[0]?.scores_by_order 
                                 ? Object.keys(itemSummary.order_comparison_results[0].scores_by_order)[0] 
                                 : undefined;
            if (firstOrderName && firstOrderName.includes('_')) {
              firstTaskName = firstOrderName.split('_').pop()?.substring(0,3); 
            }
          }
          itemSummary.order_comparison_results.forEach(criterionComp => {
            Object.entries(criterionComp.scores_by_order).forEach(([orderName, stats]) => {
              if (stats.avg !== null) {
                allPermutedData.push({
                  modelName,
                  taskName: "PermutedOrderTask", 
                  itemId: itemSummary.item_id,
                  itemTitle: itemSummary.item_title,
                  criterionName: criterionComp.criterion_name,
                  orderName,
                  avgScore: (typeof stats.avg === 'number') ? stats.avg : (typeof stats.avg === 'string' && !isNaN(parseFloat(stats.avg)) ? parseFloat(stats.avg) : null),
                  stdDevScore: (typeof stats.std === 'number') ? stats.std : (typeof stats.std === 'string' && !isNaN(parseFloat(stats.std)) ? parseFloat(stats.std) : null),
                });
              }
            });
          });
        });
      }
    });

    if (allPermutedData.length === 0) return null;

    const finalTaskName = firstTaskName || "UnknownTask"; 
    const uniqueModelsOverall = new Set(allPermutedData.map(d => d.modelName));
    const aggregatedItems: AggregatedPermutedItemSummary[] = [];

    const groupedByItem = allPermutedData.reduce((acc, curr) => {
      (acc[curr.itemId] = acc[curr.itemId] || []).push(curr);
      return acc;
    }, {} as Record<string, typeof allPermutedData>);

    for (const itemId in groupedByItem) {
      const itemDataEntries = groupedByItem[itemId];
      const itemTitle = itemDataEntries[0].itemTitle;
      const criteriaComparisons: AggregatedPermutedItemCriterionComparison[] = [];
      
      const groupedByCriterion = itemDataEntries.reduce((acc, curr) => {
        (acc[curr.criterionName] = acc[curr.criterionName] || []).push(curr);
        return acc;
      }, {} as Record<string, typeof itemDataEntries>);

      for (const criterionName in groupedByCriterion) {
        const criterionEntries = groupedByCriterion[criterionName];
        const scoresByOrderStats: AggregatedPermutedCriterionOrderStats[] = [];

        const groupedByOrder = criterionEntries.reduce((acc, curr) => {
          (acc[curr.orderName] = acc[curr.orderName] || []).push(curr);
          return acc;
        }, {} as Record<string, typeof criterionEntries>);

        for (const orderName in groupedByOrder) {
          const orderEntries = groupedByOrder[orderName];
          const validScores = orderEntries.map(e => e.avgScore).filter(s => typeof s === 'number') as number[];
          const avgScore = validScores.length > 0 ? validScores.reduce((sum, val) => sum + val, 0) / validScores.length : null;
          
          const validStdDevs = orderEntries.map(e => e.stdDevScore).filter(s => typeof s === 'number') as number[];
          const avgStdDev = validStdDevs.length > 0 ? validStdDevs.reduce((sum, val) => sum + val, 0) / validStdDevs.length : null;

          scoresByOrderStats.push({
            orderName,
            averageScore: avgScore !== null && !isNaN(avgScore) ? parseFloat(avgScore.toFixed(2)) : null,
            stdDevScore: avgStdDev !== null && !isNaN(avgStdDev) ? parseFloat(avgStdDev.toFixed(2)) : null, 
            modelCount: new Set(orderEntries.map(e => e.modelName)).size,
          });
        }
        criteriaComparisons.push({
          criterionName,
          scoresByOrder: scoresByOrderStats.sort((a,b) => a.orderName.localeCompare(b.orderName)),
        });
      }
      aggregatedItems.push({
        itemId,
        itemTitle,
        criteriaComparisons: criteriaComparisons.sort((a,b) => a.criterionName.localeCompare(b.criterionName)),
      });
    }

    return {
      experimentType: 'adv_multi_criteria_permuted',
      taskName: finalTaskName, 
      overallModelCount: uniqueModelsOverall.size,
      itemSummaries: aggregatedItems.sort((a,b) => a.itemId.localeCompare(b.itemId)),
    };
  };

export const calculateAggregatedIsolatedData = (
    modelDataStates: ModelDataStatesForAggregation,
    currentSelectedModels: string[]
  ): AggregatedAdvancedIsolatedOverallSummary | null => {
    if (!currentSelectedModels || currentSelectedModels.length === 0) return null;

    const allIsolatedData: {
      modelName: string;
      taskName: string; 
      itemId: string;
      itemTitle?: string;
      criterionName: string;
      avgScoreIsolated: number | null;
      stdDevIsolated: number | null;
      avgScoreHolistic: number | null;
      stdDevHolistic: number | null;
      deltaAvg: number | null;
    }[] = [];
    
    let firstTaskNameIsolated: string | undefined = undefined;

    currentSelectedModels.forEach(modelName => {
      const modelState = modelDataStates[modelName];
      if (modelState && modelState.isolatedHolisticData) {
        modelState.isolatedHolisticData.forEach(itemSummary => {
          if (!firstTaskNameIsolated && itemSummary.item_title) {
             if (itemSummary.item_title.toLowerCase().includes('argument')) firstTaskNameIsolated = "Argument";
             else if (itemSummary.item_title.toLowerCase().includes('story')) firstTaskNameIsolated = "StoryOpening";
          }

          itemSummary.comparison_details.forEach(detail => {
            allIsolatedData.push({
              modelName,
              taskName: "IsolatedHolisticTask", 
              itemId: itemSummary.item_id,
              itemTitle: itemSummary.item_title,
              criterionName: detail.criterion,
              avgScoreIsolated: detail.isolated_avg,
              stdDevIsolated: detail.isolated_std ?? null,
              avgScoreHolistic: detail.holistic_avg,
              stdDevHolistic: detail.holistic_std ?? null,
              deltaAvg: detail.delta_avg,
            });
          });
        });
      }
    });

    if (allIsolatedData.length === 0) return null;

    const finalTaskNameIsolated = firstTaskNameIsolated || "UnknownTask";
    const uniqueModelsOverallIsolated = new Set(allIsolatedData.map(d => d.modelName));
    const aggregatedItemsIsolated: AggregatedIsolatedItemSummary[] = [];

    const groupedByItemIsolated = allIsolatedData.reduce((acc, curr) => {
      (acc[curr.itemId] = acc[curr.itemId] || []).push(curr);
      return acc;
    }, {} as Record<string, typeof allIsolatedData>);

    for (const itemId in groupedByItemIsolated) {
      const itemDataEntries = groupedByItemIsolated[itemId];
      const itemTitle = itemDataEntries[0].itemTitle;
      const criteriaComparisonStats: AggregatedIsolatedHolisticCriterionStats[] = [];

      const groupedByCriterion = itemDataEntries.reduce((acc, curr) => {
        (acc[curr.criterionName] = acc[curr.criterionName] || []).push(curr);
        return acc;
      }, {} as Record<string, typeof itemDataEntries>);

      for (const criterionName in groupedByCriterion) {
        const criterionEntries = groupedByCriterion[criterionName];
        
        const isoScores = criterionEntries.map(e => e.avgScoreIsolated).filter(s => typeof s === 'number') as number[];
        const holScores = criterionEntries.map(e => e.avgScoreHolistic).filter(s => typeof s === 'number') as number[];
        const deltas = criterionEntries.map(e => e.deltaAvg).filter(s => typeof s === 'number') as number[];

        const avgIso = isoScores.length > 0 ? isoScores.reduce((s, v) => s + v, 0) / isoScores.length : null;
        const avgHol = holScores.length > 0 ? holScores.reduce((s, v) => s + v, 0) / holScores.length : null;
        const avgDelta = deltas.length > 0 ? deltas.reduce((s, v) => s + v, 0) / deltas.length : null;

        const validStdDevsIso = criterionEntries.map(e => e.stdDevIsolated).filter(s => typeof s === 'number') as number[];
        const avgStdDevIso = validStdDevsIso.length > 0 
          ? validStdDevsIso.reduce((s,v)=>s+v,0) / validStdDevsIso.length
          : null;
        
        const validStdDevsHol = criterionEntries.map(e => e.stdDevHolistic).filter(s => typeof s === 'number') as number[];
        const avgStdDevHol = validStdDevsHol.length > 0 
          ? validStdDevsHol.reduce((s,v)=>s+v,0) / validStdDevsHol.length
          : null;

        criteriaComparisonStats.push({
          criterionName,
          averageScoreIsolated: avgIso !== null && !isNaN(avgIso) ? parseFloat(avgIso.toFixed(2)) : null,
          stdDevScoreIsolated: avgStdDevIso !== null && !isNaN(avgStdDevIso) ? parseFloat(avgStdDevIso.toFixed(2)) : null,
          modelCountIsolated: new Set(criterionEntries.filter(e => e.avgScoreIsolated !== null).map(e => e.modelName)).size,
          averageScoreHolistic: avgHol !== null && !isNaN(avgHol) ? parseFloat(avgHol.toFixed(2)) : null,
          stdDevScoreHolistic: avgStdDevHol !== null && !isNaN(avgStdDevHol) ? parseFloat(avgStdDevHol.toFixed(2)) : null,
          modelCountHolistic: new Set(criterionEntries.filter(e => e.avgScoreHolistic !== null).map(e => e.modelName)).size,
          deltaAverageScore: avgDelta !== null && !isNaN(avgDelta) ? parseFloat(avgDelta.toFixed(2)) : null,
        });
      }
      aggregatedItemsIsolated.push({
        itemId,
        itemTitle,
        criteriaComparisonStats: criteriaComparisonStats.sort((a,b) => a.criterionName.localeCompare(b.criterionName)),
      });
    }

    return {
      experimentType: 'adv_multi_criteria_isolated',
      taskName: finalTaskNameIsolated, 
      overallModelCount: uniqueModelsOverallIsolated.size,
      itemSummaries: aggregatedItemsIsolated.sort((a,b) => a.itemId.localeCompare(b.itemId)),
    };
  }; 