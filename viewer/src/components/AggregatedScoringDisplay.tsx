import React from 'react';
import { AggregatedScoringOverallSummary, AggregatedScoringVariantSummary, AggregatedScoringItemStats } from '@/types/aggregatedScoring';

interface AggregatedScoringDisplayProps {
  data: AggregatedScoringOverallSummary | null;
}

const AggregatedScoringDisplay: React.FC<AggregatedScoringDisplayProps> = ({ data }) => {
  if (!data || data.variantsSummaries.length === 0) {
    return <p className='text-gray-600 p-4 text-center'>No aggregated scoring data to display or insufficient models/variants processed.</p>;
  }

  return (
    <section className='mt-8 bg-slate-50 p-4 md:p-6 rounded-lg shadow-xl'>
      <header className='mb-6 border-b border-slate-300 pb-3'>
        <h2 className='text-2xl md:text-3xl font-bold text-slate-800 text-center'>
          Aggregated Scoring Experiment Summary
        </h2>
        <p className='text-sm text-slate-600 text-center mt-1'>
          (Overall Models: {data.overallModelCount} | Overall Unique Items Scored: {data.overallUniqueItemsScored})
        </p>
      </header>

      <div className='space-y-8'>
        {data.variantsSummaries.map((variantItem, index) => (
          <article key={index} className='p-4 md:p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-150 ease-in-out'>
            <header className='mb-4 border-b border-gray-200 pb-2'>
              <h3 className='text-xl font-semibold text-indigo-700'>{variantItem.variantName}</h3>
              <div className='text-xs text-gray-500 mt-1 space-x-3'>
                <span>Models in Variant: <strong className='text-gray-700'>{variantItem.modelCountOverall}</strong></span>
                <span>Items Scored: <strong className='text-gray-700'>{variantItem.itemCountOverall}</strong></span>
              </div>
              <div className='text-xs text-gray-500 mt-1'>
                Overall Avg. Norm. Score: 
                <strong className='text-gray-700'> {variantItem.overallAverageNormalizedScore?.toFixed(2) ?? 'N/A'}</strong>
                (StdDev: {variantItem.overallStdDevNormalizedScore?.toFixed(2) ?? 'N/A'})
              </div>
              {variantItem.variantConfig?.criterion_override && 
                <p className='text-xs text-gray-500 mt-1'>Criterion: <em className='text-gray-600'>{variantItem.variantConfig.criterion_override}</em></p>}
              {variantItem.variantConfig?.scale_type && 
                <p className='text-xs text-gray-500 mt-1'>Scale: <em className='text-gray-600'>{variantItem.variantConfig.scale_type}</em></p>}
            </header>

            {variantItem.itemsAggregatedStats.length > 0 ? (
              <div className='max-h-96 overflow-y-auto pr-2'> {/* Scrollable items area */}
                <table className='min-w-full divide-y divide-gray-200 text-xs'>
                  <thead className='bg-gray-50 sticky top-0'>
                    <tr>
                      <th className='px-3 py-2 text-left font-medium text-gray-500 tracking-wider'>Item ID/Title</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500 tracking-wider'>Dataset</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>Models</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>Avg. Score</th>
                      <th className='px-3 py-2 text-center font-medium text-gray-500 tracking-wider'>StdDev</th>
                    </tr>
                  </thead>
                  <tbody className='bg-white divide-y divide-gray-200'>
                    {variantItem.itemsAggregatedStats.map((itemStat, itemIndex) => (
                      <tr key={itemIndex} className='hover:bg-gray-50'>
                        <td className='px-3 py-2 whitespace-nowrap'>
                          <div className='font-medium text-gray-900'>{itemStat.item_title || itemStat.item_id}</div>
                          <div className='text-gray-500 truncate max-w-xs' title={itemStat.item_text_snippet}>{itemStat.item_text_snippet}</div>
                        </td>
                        <td className='px-3 py-2 whitespace-nowrap text-gray-700'>{itemStat.dataset_name}</td>
                        <td className='px-3 py-2 whitespace-nowrap text-center text-gray-700'>{itemStat.modelCount}</td>
                        <td className='px-3 py-2 whitespace-nowrap text-center font-semibold text-gray-800'>
                          {itemStat.averageNormalizedScore?.toFixed(2) ?? 'N/A'}
                        </td>
                        <td className='px-3 py-2 whitespace-nowrap text-center text-gray-700'>
                          {itemStat.stdDevNormalizedScore?.toFixed(2) ?? 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className='text-xs text-gray-500 italic text-center py-4'>No specific item data aggregated for this variant.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

export default AggregatedScoringDisplay; 