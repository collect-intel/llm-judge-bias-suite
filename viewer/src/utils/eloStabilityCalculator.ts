export interface VariantStabilityRank {
  variantName: string;
  averageSpearmanCorrelation: number | null;
  comparedToVariantsCount: number;
}

// Interface for item stats, used in AggregatedEloVariantSummary
// This should align with what's in AggregatedEloOverallSummary from aggregatedPairwiseElo.ts
interface AggregatedEloItemStatsMinimal {
  item_id: string;
  averageRank: number | null;
}

// Interface for items with rank, used by getRanksForSingleModelCommonItems
interface ItemWithRank {
  item_id: string;
  rank: number;
}

// Interface representing an item within a single model's ELO variant summary (from PairwiseEloExperimentDataWrapper)
// This must include variant_name for initial grouping.
interface SingleModelEloFullItemInfo {
  variant_name: string;
  item_id: string;
  rank: number;
  // other fields from EloItemVariantSummary can be here if needed, but not for this calculation
}


// Helper to get ranks for common items between two variants (for aggregated data)
function getRanksForAggregatedCommonItems(
  itemsA: AggregatedEloItemStatsMinimal[],
  itemsB: AggregatedEloItemStatsMinimal[]
): { ranksA: number[], ranksB: number[], commonItemIds: string[] } {
  const ranksMapA = new Map<string, number>();
  itemsA.forEach(item => {
    if (item.averageRank !== null) ranksMapA.set(item.item_id, item.averageRank);
  });

  const commonRanksA: number[] = [];
  const commonRanksB: number[] = [];
  const commonItemIds: string[] = [];

  itemsB.forEach(itemB => {
    if (itemB.averageRank !== null && ranksMapA.has(itemB.item_id)) {
      const rankA = ranksMapA.get(itemB.item_id);
      if (rankA !== undefined) { 
        commonRanksA.push(rankA);
        commonRanksB.push(itemB.averageRank);
        commonItemIds.push(itemB.item_id);
      }
    }
  });
  return { ranksA: commonRanksA, ranksB: commonRanksB, commonItemIds };
}

// Helper to get ranks for common items between two variants (for single model data)
function getRanksForSingleModelCommonItems(
  itemsA: ItemWithRank[], // Expects { item_id: string; rank: number; }[]
  itemsB: ItemWithRank[]  // Expects { item_id: string; rank: number; }[]
): { ranksA: number[], ranksB: number[], commonItemIds: string[] } {
  const ranksMapA = new Map<string, number>();
  itemsA.forEach(item => ranksMapA.set(item.item_id, item.rank));

  const commonRanksA: number[] = [];
  const commonRanksB: number[] = [];
  const commonItemIds: string[] = [];

  itemsB.forEach(itemB => {
    if (ranksMapA.has(itemB.item_id)) {
      const rankA = ranksMapA.get(itemB.item_id);
       if (rankA !== undefined) {
        commonRanksA.push(rankA);
        commonRanksB.push(itemB.rank);
        commonItemIds.push(itemB.item_id);
      }
    }
  });
  return { ranksA: commonRanksA, ranksB: commonRanksB, commonItemIds };
}


/**
 * Calculates Spearman's Rank Correlation Coefficient.
 * A simplified version that does not handle ties in ranks with specific adjustments.
 * For robust tie handling, a statistics library would be more appropriate.
 * @param ranksX Array of ranks for the first variable.
 * @param ranksY Array of ranks for the second variable (must correspond to ranksX).
 * @returns Spearman's rho, or null if calculation is not possible.
 */
function calculateSpearman(ranksX: number[], ranksY: number[]): number | null {
  const n = ranksX.length;

  if (n === 0 || n !== ranksY.length) {
    // console.warn("Spearman: Input arrays are empty or of different lengths.");
    return null;
  }
  if (n === 1) { // If only one item, correlation is undefined or considered perfect by convention.
    return 1; // Or null, depending on desired strictness for single-pair comparison
  }

  // Check for zero variance in ranks (all ranks are the same)
  const allSame = (arr: number[]) => arr.every(val => val === arr[0]);
  const xHasNoVariance = allSame(ranksX);
  const yHasNoVariance = allSame(ranksY);

  if (xHasNoVariance && yHasNoVariance) {
    return 1; // Both lists have constant ranks, perfectly correlated.
  }
  if (xHasNoVariance || yHasNoVariance) {
    // If one list has no variance and the other does, Spearman is typically undefined or 0.
    // This happens because the denominator term in more complete formulas would be zero.
    // For this simplified version, returning 0 indicates no discernible monotonic relationship.
    // A more advanced formula would handle this via tie correction or by returning NaN.
    return 0; 
  }

  let sumDSquared = 0;
  for (let i = 0; i < n; i++) {
    const diff = ranksX[i] - ranksY[i];
    sumDSquared += diff * diff;
  }
  
  const denominator = n * (n * n - 1);
  if (denominator === 0) { // Should be caught by n < 2 check essentially
    return null; 
  }

  const spearman = 1 - (6 * sumDSquared) / denominator;

  // Clamp result to [-1, 1] as floating point issues can sometimes push it slightly out
  return Math.max(-1, Math.min(1, spearman));
}


// Type for AggregatedEloVariantSummary to use the minimal item stats
interface AggregatedEloVariantSummaryMinimal {
    variantName: string;
    itemsAggregatedStats: AggregatedEloItemStatsMinimal[];
}

export function calculateAggregatedVariantStability(
  variantsSummaries: AggregatedEloVariantSummaryMinimal[]
): VariantStabilityRank[] {
  const stabilityRanks: VariantStabilityRank[] = [];

  if (!variantsSummaries || variantsSummaries.length < 2) {
    return variantsSummaries.map(v => ({
        variantName: v.variantName,
        averageSpearmanCorrelation: null,
        comparedToVariantsCount: 0,
    }));
  }

  for (let i = 0; i < variantsSummaries.length; i++) {
    const variantA = variantsSummaries[i];
    let totalSpearman = 0;
    let comparisons = 0;

    for (let j = 0; j < variantsSummaries.length; j++) {
      if (i === j) continue; 

      const variantB = variantsSummaries[j];
      const { ranksA, ranksB } = getRanksForAggregatedCommonItems(
        variantA.itemsAggregatedStats,
        variantB.itemsAggregatedStats
      );

      if (ranksA.length > 1) { 
        const spearman = calculateSpearman(ranksA, ranksB);
        if (spearman !== null) {
          totalSpearman += spearman;
          comparisons++;
        }
      }
    }

    stabilityRanks.push({
      variantName: variantA.variantName,
      averageSpearmanCorrelation: comparisons > 0 ? totalSpearman / comparisons : null,
      comparedToVariantsCount: comparisons,
    });
  }

  stabilityRanks.sort((a, b) => {
    if (a.averageSpearmanCorrelation === null && b.averageSpearmanCorrelation === null) return 0;
    if (a.averageSpearmanCorrelation === null) return 1; // Put nulls at the end
    if (b.averageSpearmanCorrelation === null) return -1;
    return b.averageSpearmanCorrelation - a.averageSpearmanCorrelation; // Sort descending
  });

  return stabilityRanks;
}

// Type for the input for single model stability, aligning with PairwiseEloExperimentDataWrapper structure
// PairwiseEloExperimentDataWrapper has variants_summary which is EloItemVariantSummary[]
// EloItemVariantSummary includes item_id and rank.
interface SingleModelEloSetDataForStabilityCalc {
    // criterion: string; // Not needed for calculation
    // ranking_set_id: string; // Not needed for calculation
    variants_summary: SingleModelEloFullItemInfo[]; 
}


export function calculateSingleModelVariantStability(
  modelEloSetData: SingleModelEloSetDataForStabilityCalc 
): VariantStabilityRank[] {
  const stabilityRanks: VariantStabilityRank[] = [];
  
  const groupedByVariant = new Map<string, ItemWithRank[]>();
  
  // Group items from modelEloSetData.variants_summary by their variant_name
  // Each item in variants_summary is expected to be SingleModelEloFullItemInfo
  modelEloSetData.variants_summary.forEach(itemSummary => {
      if (!groupedByVariant.has(itemSummary.variant_name)) {
          groupedByVariant.set(itemSummary.variant_name, []);
      }
      // Store as ItemWithRank for the getRanksForSingleModelCommonItems function
      groupedByVariant.get(itemSummary.variant_name)!.push({
          item_id: itemSummary.item_id, 
          rank: itemSummary.rank,   
      });
  });

  const variantNames = Array.from(groupedByVariant.keys());

  if (variantNames.length < 2) {
     return variantNames.map(name => ({
        variantName: name,
        averageSpearmanCorrelation: null,
        comparedToVariantsCount: 0,
    }));
  }

  for (let i = 0; i < variantNames.length; i++) {
    const variantNameA = variantNames[i];
    const itemsA = groupedByVariant.get(variantNameA)!; // This is ItemWithRank[]
    
    let totalSpearman = 0;
    let comparisons = 0;

    for (let j = 0; j < variantNames.length; j++) {
      if (i === j) continue;

      const variantNameB = variantNames[j];
      const itemsB = groupedByVariant.get(variantNameB)!; // This is ItemWithRank[]
      
      const { ranksA, ranksB } = getRanksForSingleModelCommonItems(itemsA, itemsB);

      if (ranksA.length > 1) {
        const spearman = calculateSpearman(ranksA, ranksB);
        if (spearman !== null) {
          totalSpearman += spearman;
          comparisons++;
        }
      }
    }
    stabilityRanks.push({
      variantName: variantNameA,
      averageSpearmanCorrelation: comparisons > 0 ? totalSpearman / comparisons : null,
      comparedToVariantsCount: comparisons,
    });
  }

  stabilityRanks.sort((a, b) => {
    if (a.averageSpearmanCorrelation === null && b.averageSpearmanCorrelation === null) return 0;
    if (a.averageSpearmanCorrelation === null) return 1;
    if (b.averageSpearmanCorrelation === null) return -1;
    return b.averageSpearmanCorrelation - a.averageSpearmanCorrelation;
  });

  return stabilityRanks;
}

// Ensure types are imported or defined if they live elsewhere and are complex
// For AggregatedEloVariantSummaryMinimal, ensure it matches the structure from AggregatedEloDisplay props
// For SingleModelEloSetData, its variants_summary should match EloItemVariantSummary from pairwiseEloExperiment.ts

// Example usage (conceptual, actual data would come from props/state):
/*
const sampleAggregatedVariants: AggregatedEloVariantSummaryMinimal[] = [
  { variantName: "Classic", itemsAggregatedStats: [{item_id: "a", averageRank:1}, {item_id: "b", averageRank:2}, {item_id: "c", averageRank:3}] },
  { variantName: "JSON", itemsAggregatedStats: [{item_id: "a", averageRank:1}, {item_id: "b", averageRank:3}, {item_id: "c", averageRank:2}] },
  { variantName: "CoT", itemsAggregatedStats: [{item_id: "a", averageRank:2}, {item_id: "b", averageRank:1}, {item_id: "c", averageRank:3}] },
];
const aggregatedStability = calculateAggregatedVariantStability(sampleAggregatedVariants);
console.log("Aggregated Stability:", aggregatedStability);

const sampleSingleModelData: SingleModelEloSetDataForStabilityCalc = {
    variants_summary: [ 
        { variant_name: "Classic", item_id: "a", rank: 1 },
        { variant_name: "Classic", item_id: "b", rank: 2 },
        { variant_name: "JSON", item_id: "a", rank: 2 },
        { variant_name: "JSON", item_id: "b", rank: 1 },
    ]
};
const singleModelStability = calculateSingleModelVariantStability(sampleSingleModelData);
console.log("Single Model Stability:", singleModelStability);
*/ 