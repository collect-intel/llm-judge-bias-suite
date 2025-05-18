import React, { useMemo } from 'react';
import { AggregatedEloOverallSummary, AggregatedEloVariantSummary, AggregatedEloItemStats } from '@/types/aggregatedPairwiseElo';
import { calculateAggregatedVariantStability, VariantStabilityRank } from '@/utils/eloStabilityCalculator';

interface ModelCrossoverScoreData {
  modelName: string;
  crossoverScore: number;
}

interface AggregatedEloDisplayProps {
  data: AggregatedEloOverallSummary | null;
  modelCrossoverScores?: ModelCrossoverScoreData[];
}

const AggregatedEloDisplay: React.FC<AggregatedEloDisplayProps> = ({ data, modelCrossoverScores }) => {
  const stabilityRanking = useMemo(() => {
    if (!data || !data.variantsSummaries || data.variantsSummaries.length < 2) {
      return [];
    }
    // The calculateAggregatedVariantStability function expects AggregatedEloVariantSummaryMinimal[],
    // but AggregatedEloVariantSummary from data.variantsSummaries is compatible (it has at least variantName and itemsAggregatedStats)
    return calculateAggregatedVariantStability(data.variantsSummaries);
  }, [data]);

  const sortedModelCrossoverRankings = useMemo(() => {
    if (!modelCrossoverScores || modelCrossoverScores.length === 0) {
      return [];
    }
    return [...modelCrossoverScores].sort((a, b) => a.crossoverScore - b.crossoverScore);
  }, [modelCrossoverScores]);

  if (!data || data.variantsSummaries.length === 0) {
    return <p className='text-gray-600 p-4 text-center'>No aggregated ELO data to display or insufficient models/variants processed.</p>;
  }

  return (
    <section className='mt-8 bg-green-50 p-4 md:p-6 rounded-lg shadow-xl'>
      <header className='mb-6 border-b border-green-300 pb-3'>
        <h2 className='text-2xl md:text-3xl font-bold text-green-800 text-center'>
          Aggregated Pairwise ELO Summary
        </h2>
        <div className='text-sm text-green-700 text-center mt-1 space-x-2'>
          <span>(Overall Models: {data.overallModelCount}</span>
          <span>| Unique Items Ranked: {data.overallUniqueItemsRanked})</span>
          {data.criterion && <span>| Criterion: {data.criterion}</span>}
          {data.rankingSetId && <span>| Set ID: {data.rankingSetId}</span>}
        </div>
      </header>

      {/* Prompt Variant Stability Ranking Section */}
      {stabilityRanking.length > 0 && (
        <div className='mb-8 p-4 bg-green-100 border border-green-300 rounded-lg shadow'>
          <h3 className='text-lg font-semibold text-green-700 mb-1 text-center'>
            Prompt Variant Stability Ranking (Aggregated)
          </h3>
          <div className='text-xs text-green-600 mb-3 text-center space-y-1 px-2'>
            <p>
              This ranks prompt variants by their average consistency (Spearman's ρ) with all other tested variants across models. 
              A <strong>higher score (closer to 1)</strong> suggests the variant's item ranking is more similar to the consensus ranking order.
            </p>
            <p>
              <strong>Note:</strong> High stability indicates consistency <span className="italic">relative to other tested variants</span>; 
              it does <span className="font-semibold">not</span> guarantee the variant is unbiased or objectively "best". 
              However, a more stable and sensible prompt may reduce variability from phrasing alone.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className='min-w-full w-auto table-auto text-xs border border-green-200'>
              <thead className='bg-green-200'>
                <tr>
                  <th className='px-3 py-2 text-left font-medium text-green-700 tracking-wider'>#</th>
                  <th className='px-3 py-2 text-left font-medium text-green-700 tracking-wider'>Prompt Variant</th>
                  <th className='px-3 py-2 text-center font-medium text-green-700 tracking-wider'>Avg. Spearman (ρ)</th>
                  <th className='px-3 py-2 text-center font-medium text-green-700 tracking-wider'>Compared Variants</th>
                </tr>
              </thead>
              <tbody className='bg-white divide-y divide-green-100'>
                {stabilityRanking.map((variantRank, index) => (
                  <tr key={variantRank.variantName} className='hover:bg-green-50'>
                    <td className='px-3 py-2 whitespace-nowrap text-green-800 font-medium'>{index + 1}</td>
                    <td className='px-3 py-2 whitespace-nowrap text-green-800 font-semibold'>{variantRank.variantName}</td>
                    <td className='px-3 py-2 whitespace-nowrap text-center text-green-800 font-bold'>
                      {variantRank.averageSpearmanCorrelation !== null 
                        ? variantRank.averageSpearmanCorrelation.toFixed(3)
                        : 'N/A'}
                    </td>
                    <td className='px-3 py-2 whitespace-nowrap text-center text-green-700'>{variantRank.comparedToVariantsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Model Ranking by Crossover Score Section */} 
      {sortedModelCrossoverRankings.length > 0 && (
        <div className='mb-8 p-4 bg-sky-50 border border-sky-300 rounded-lg shadow'>
          <h3 className='text-lg font-semibold text-sky-700 mb-1 text-center'>
            Model Ranking by Internal Prompt Stability (Crossover Score)
          </h3>
          <div className='text-xs text-sky-600 mb-3 text-center space-y-1 px-2'>
            <p>
              This ranks selected models by their internal Crossover Score, calculated from the first ELO set for each model.
              A <strong>lower score</strong> suggests the model's item rankings were more consistent (less sensitive) across its own prompt variants for this ELO task.
            </p>
            <p>
              <strong>Note:</strong> This score reflects stability against the model's <span className="italic">own</span> prompt variations, not necessarily correctness or comparison to other models' outputs directly.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className='min-w-full w-auto table-auto text-xs border border-sky-200'>
              <thead className='bg-sky-200'>
                <tr>
                  <th className='px-3 py-2 text-left font-medium text-sky-700 tracking-wider'>#</th>
                  <th className='px-3 py-2 text-left font-medium text-sky-700 tracking-wider'>Model Name</th>
                  <th className='px-3 py-2 text-center font-medium text-sky-700 tracking-wider'>Crossover Score (Lower is Better)</th>
                </tr>
              </thead>
              <tbody className='bg-white divide-y divide-sky-100'>
                {sortedModelCrossoverRankings.map((modelRank, index) => (
                  <tr key={modelRank.modelName} className='hover:bg-sky-50'>
                    <td className='px-3 py-2 whitespace-nowrap text-sky-800 font-medium'>{index + 1}</td>
                    <td className='px-3 py-2 whitespace-nowrap text-sky-800 font-semibold'>{modelRank.modelName}</td>
                    <td className='px-3 py-2 whitespace-nowrap text-center text-sky-800 font-bold'>
                      {modelRank.crossoverScore}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className='space-y-8'>
        {data.variantsSummaries.map((variantItem, index) => (
          <article key={index} className='p-4 md:p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-150 ease-in-out'>
            <header className='mb-4 border-b border-gray-200 pb-2'>
              <h3 className='text-xl font-semibold text-teal-700'>{variantItem.variantName}</h3>
              <div className='text-xs text-gray-500 mt-1 space-x-3'>
                <span>Models in Variant: <strong className='text-gray-700'>{variantItem.modelCountOverall}</strong></span>
                <span>Items in Variant: <strong className='text-gray-700'>{variantItem.itemCountOverall}</strong></span>
              </div>
            </header>

            {variantItem.itemsAggregatedStats.length > 0 ? (
              <div className='max-h-96 overflow-y-auto pr-2'> {/* Scrollable items area */}
                <table className='min-w-full divide-y divide-gray-200 text-xs'>
                  <thead className='bg-gray-50 sticky top-0'>
                    <tr>
                      <th className='px-3 py-2 text-left font-medium text-gray-500 tracking-wider'>Item (ID/Snippet)</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>Models</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>Avg. ELO (StdDev)</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>Avg. Rank (StdDev)</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>W</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>L</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>T</th>
                    </tr>
                  </thead>
                  <tbody className='bg-white divide-y divide-gray-200'>
                    {/* Items are pre-sorted by ELO in calculateAggregatedEloData */}
                    {variantItem.itemsAggregatedStats.map((itemStat, itemIndex) => {
                      const eloStdDevThreshold = 100;
                      const rankStdDevThreshold = 3;

                      const highlightEloCell = itemStat.stdDevEloRating !== null && itemStat.stdDevEloRating > eloStdDevThreshold;
                      const highlightRankCell = itemStat.stdDevRank !== null && itemStat.stdDevRank > rankStdDevThreshold;

                      return (
                        <tr key={itemIndex} className='hover:bg-gray-50'>
                          <td className='px-3 py-2 whitespace-normal max-w-xs break-words'>
                            <div className='font-medium text-gray-900'>{itemStat.item_id}</div>
                            {itemStat.item_text_snippet && 
                              <div className='text-gray-500 truncate' title={itemStat.item_text_snippet}>{itemStat.item_text_snippet}</div>}
                          </td>
                          <td className='px-3 py-2 whitespace-nowrap text-center text-gray-700'>{itemStat.modelCount}</td>
                          <td className={`px-3 py-2 whitespace-nowrap text-center font-semibold text-gray-800 ${highlightEloCell ? 'bg-orange-100' : ''}`}>
                            {itemStat.averageEloRating?.toFixed(1) ?? 'N/A'}
                            <span className='text-xs text-gray-500 ml-1'>
                              (&plusmn;{itemStat.stdDevEloRating?.toFixed(1) ?? 'N/A'})
                            </span>
                          </td>
                          <td className={`px-3 py-2 whitespace-nowrap text-center text-gray-700 ${highlightRankCell ? 'bg-orange-100' : ''}`}>
                            {itemStat.averageRank?.toFixed(1) ?? 'N/A'}
                            <span className='text-xs text-gray-500 ml-1'>
                               (&plusmn;{itemStat.stdDevRank?.toFixed(1) ?? 'N/A'})
                            </span>
                          </td>
                          <td className='px-3 py-2 whitespace-nowrap text-center text-green-600 font-semibold'>{itemStat.totalWins}</td>
                          <td className='px-3 py-2 whitespace-nowrap text-center text-red-600 font-semibold'>{itemStat.totalLosses}</td>
                          <td className='px-3 py-2 whitespace-nowrap text-center text-blue-600 font-semibold'>{itemStat.totalTies}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className='text-xs text-gray-500 italic text-center py-4'>No specific item ELO data aggregated for this variant.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

export default AggregatedEloDisplay; 