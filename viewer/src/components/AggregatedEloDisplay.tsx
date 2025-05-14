import React from 'react';
import { AggregatedEloOverallSummary, AggregatedEloVariantSummary, AggregatedEloItemStats } from '@/types/aggregatedPairwiseElo';

interface AggregatedEloDisplayProps {
  data: AggregatedEloOverallSummary | null;
}

const AggregatedEloDisplay: React.FC<AggregatedEloDisplayProps> = ({ data }) => {
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