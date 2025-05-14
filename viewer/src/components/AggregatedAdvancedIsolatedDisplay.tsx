import React from 'react';
import {
  AggregatedAdvancedIsolatedOverallSummary,
  AggregatedIsolatedItemSummary,
  AggregatedIsolatedHolisticCriterionStats,
} from '@/types/aggregatedAdvancedIsolated';

interface Props {
  data: AggregatedAdvancedIsolatedOverallSummary;
}

const AggregatedAdvancedIsolatedDisplay: React.FC<Props> = ({ data }) => {
  if (!data || !data.itemSummaries || data.itemSummaries.length === 0) {
    return (
      <p className="text-sm text-gray-500 p-2">
        No aggregated isolated vs. holistic data available to display.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall summary if needed in the future - data.overallModelCount, data.taskName */}
      {/* <p className="text-sm text-gray-600">Task: {data.taskName}, Models Aggregated: {data.overallModelCount}</p> */}
      
      {data.itemSummaries.map((itemSummary: AggregatedIsolatedItemSummary) => (
        <div key={itemSummary.itemId} className="p-4 border rounded-lg shadow-md bg-white">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">
            Item: {itemSummary.itemTitle || itemSummary.itemId} (ID: {itemSummary.itemId})
          </h3>
          {itemSummary.criteriaComparisonStats.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-300 text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Criterion</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Avg. Isolated Score</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Avg. Holistic Score</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Delta (Iso - Hol)</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Models (Iso)</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Models (Hol)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {itemSummary.criteriaComparisonStats.map((detail: AggregatedIsolatedHolisticCriterionStats) => {
                  const delta = detail.deltaAverageScore;
                  let deltaColorClass = '';
                  if (typeof delta === 'number') {
                    if (delta > 0.01) deltaColorClass = 'text-green-700 font-bold';
                    else if (delta < -0.01) deltaColorClass = 'text-red-700 font-bold';
                  }

                  return (
                    <tr key={detail.criterionName}>
                      <td className="px-3 py-2 font-medium text-gray-800">{detail.criterionName}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {typeof detail.averageScoreIsolated === 'number'
                          ? detail.averageScoreIsolated.toFixed(2)
                          : 'N/A'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {typeof detail.averageScoreHolistic === 'number'
                          ? detail.averageScoreHolistic.toFixed(2)
                          : 'N/A'}
                      </td>
                      <td className={`px-3 py-2 ${deltaColorClass}`}>
                        {typeof delta === 'number' ? delta.toFixed(2) : 'N/A'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{detail.modelCountIsolated ?? 'N/A'}</td>
                      <td className="px-3 py-2 text-gray-700">{detail.modelCountHolistic ?? 'N/A'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-500">No criteria comparison data for this item.</p>
          )}
        </div>
      ))}
    </div>
  );
};

export default AggregatedAdvancedIsolatedDisplay; 