import { PairwiseEloExperimentDataWrapper, EloItemVariantSummary } from '@/types/pairwiseEloExperiment';

// Helper interface for the transformed data structure used in crossover calculation
interface TransformedEloItemForCrossover {
  itemId: string;
  // itemTextSnippet: string; // Not strictly needed for crossover calculation itself
  resultsByVariant: {
    [variantName: string]: {
      rank: number;
      // eloRating: number; // Not needed
      // wins: number; // Not needed
      // losses: number; // Not needed
      // ties: number; // Not needed
    } | undefined;
  };
}

/**
 * Calculates the Crossover Score for a single ELO dataset.
 * A Crossover Score counts the number of times the relative ranking of any two items
 * flips when moving from one prompt variant to the next adjacent one.
 * A lower score indicates more stability in rankings across variants for this set.
 * @param eloSetData The data for a single ELO ranking set.
 * @returns The calculated crossover score, or 0 if not applicable. Returns undefined if input is invalid.
 */
export const calculateCrossoverScoreForEloSet = (eloSetData: PairwiseEloExperimentDataWrapper): number | undefined => {
  if (!eloSetData || !eloSetData.variants_summary) {
    // console.warn("calculateCrossoverScoreForEloSet: Invalid eloSetData provided.");
    return undefined;
  }

  // Sort unique variant names to ensure consistent order for comparison
  const uniqueVariantNames = Array.from(new Set(eloSetData.variants_summary.map(item => item.variant_name))).sort();
  const uniqueItemIds = Array.from(new Set(eloSetData.variants_summary.map(item => item.item_id))).sort();

  // Crossover calculation requires at least 2 variants and 2 items.
  if (uniqueVariantNames.length < 2 || uniqueItemIds.length < 2) {
    return 0;
  }

  // Transform data into a structure focusing on ranks per item per variant
  const transformedData: TransformedEloItemForCrossover[] = uniqueItemIds.map(itemId => {
    const itemResults: TransformedEloItemForCrossover = {
      itemId: itemId,
      resultsByVariant: {}
    };
    uniqueVariantNames.forEach(variantName => {
      const variantData = eloSetData.variants_summary.find(
        summary => summary.item_id === itemId && summary.variant_name === variantName
      );
      if (variantData) {
        itemResults.resultsByVariant[variantName] = {
          rank: variantData.rank,
        };
      }
    });
    return itemResults;
  });

  // After transformation, re-check if there are enough items with variant data.
  // This handles cases where items might not appear in all variants.
  // We are interested in items that are present across variants to compare.
  // The current logic implicitly handles this by only comparing items present in transformedData.

  let crossoverCount = 0;

  // Iterate through all unique pairs of items
  for (let i = 0; i < transformedData.length; i++) {
    for (let j = i + 1; j < transformedData.length; j++) {
      const item_i_data = transformedData[i];
      const item_j_data = transformedData[j];

      // Iterate through all adjacent pairs of prompt variants
      for (let k = 0; k < uniqueVariantNames.length - 1; k++) {
        const variant1Name = uniqueVariantNames[k];
        const variant2Name = uniqueVariantNames[k + 1];

        const rank_i_v1 = item_i_data.resultsByVariant[variant1Name]?.rank;
        const rank_j_v1 = item_j_data.resultsByVariant[variant1Name]?.rank;
        const rank_i_v2 = item_i_data.resultsByVariant[variant2Name]?.rank;
        const rank_j_v2 = item_j_data.resultsByVariant[variant2Name]?.rank;

        // Ensure all ranks are defined for a valid comparison for this pair of items in this pair of variants
        if (
          rank_i_v1 !== undefined && rank_j_v1 !== undefined &&
          rank_i_v2 !== undefined && rank_j_v2 !== undefined
        ) {
          // Condition 1: Item i was ranked higher (lower rank number) than item j in variant 1, 
          // AND item i is ranked lower (higher rank number) than item j in variant 2.
          const condition1 = rank_i_v1 < rank_j_v1 && rank_i_v2 > rank_j_v2;
          
          // Condition 2: Item i was ranked lower (higher rank number) than item j in variant 1,
          // AND item i is ranked higher (lower rank number) than item j in variant 2.
          const condition2 = rank_i_v1 > rank_j_v1 && rank_i_v2 < rank_j_v2;

          if (condition1 || condition2) {
            crossoverCount++;
          }
        }
      }
    }
  }
  return crossoverCount;
}; 