import React from 'react';
import {
  AggregatedAdvancedIsolatedOverallSummary,
  AggregatedIsolatedItemSummary,
  AggregatedIsolatedHolisticCriterionStats,
} from '@/types/aggregatedAdvancedIsolated';

interface Props {
  data: AggregatedAdvancedIsolatedOverallSummary;
}

// Helper function to generate textual insights for Isolated vs. Holistic
const generateIsolatedSummaryInsights = (data: AggregatedAdvancedIsolatedOverallSummary): string[] => {
  const insights: string[] = [];
  if (!data || !data.itemSummaries || data.itemSummaries.length === 0) {
    return ["No data to generate insights."];
  }

  let maxAbsDelta = 0;
  let criterionWithMaxAbsDelta = '';
  let itemWithMaxAbsDelta = '';
  let valueOfMaxAbsDelta = 0;

  const criteriaDeltas: Record<string, { totalDelta: number; count: number; itemSources: Set<string> }> = {};
  let overallTotalDelta = 0;
  let overallComparisonsCount = 0;

  for (const itemSummary of data.itemSummaries) {
    for (const detail of itemSummary.criteriaComparisonStats) {
      if (typeof detail.deltaAverageScore === 'number') {
        const currentDelta = detail.deltaAverageScore;
        const currentAbsDelta = Math.abs(currentDelta);

        if (currentAbsDelta > maxAbsDelta) {
          maxAbsDelta = currentAbsDelta;
          criterionWithMaxAbsDelta = detail.criterionName;
          itemWithMaxAbsDelta = itemSummary.itemTitle || itemSummary.itemId;
          valueOfMaxAbsDelta = currentDelta;
        }

        if (!criteriaDeltas[detail.criterionName]) {
          criteriaDeltas[detail.criterionName] = { totalDelta: 0, count: 0, itemSources: new Set() };
        }
        criteriaDeltas[detail.criterionName].totalDelta += currentDelta;
        criteriaDeltas[detail.criterionName].count++;
        criteriaDeltas[detail.criterionName].itemSources.add(itemSummary.itemId);
        
        overallTotalDelta += currentDelta;
        overallComparisonsCount++;
      }
    }
  }

  if (criterionWithMaxAbsDelta) {
    insights.push(
      `The largest absolute difference between isolated and holistic scoring was ${valueOfMaxAbsDelta.toFixed(2)} points for criterion '${criterionWithMaxAbsDelta}' in item '${itemWithMaxAbsDelta}'.`
    );
  } else {
    insights.push("No significant differences between isolated and holistic scoring were identified across items and criteria.");
  }

  let maxPositiveAvgDelta = 0;
  let criterionWithMaxPositiveAvgDelta = '';
  let maxNegativeAvgDelta = 0; // Actually min negative, so most negative
  let criterionWithMaxNegativeAvgDelta = '';

  for (const [criterion, stats] of Object.entries(criteriaDeltas)) {
    if (stats.count > 0) {
      const avgDelta = stats.totalDelta / stats.count;
      if (avgDelta > maxPositiveAvgDelta) {
        maxPositiveAvgDelta = avgDelta;
        criterionWithMaxPositiveAvgDelta = criterion;
      }
      if (avgDelta < maxNegativeAvgDelta) { // looking for the most negative value
        maxNegativeAvgDelta = avgDelta;
        criterionWithMaxNegativeAvgDelta = criterion;
      }
    }
  }

  if (criterionWithMaxPositiveAvgDelta) {
    insights.push(
      `Criterion '${criterionWithMaxPositiveAvgDelta}' tended to score highest in isolation (average positive delta: +${maxPositiveAvgDelta.toFixed(2)} points).`
    );
  }
  if (criterionWithMaxNegativeAvgDelta) {
    insights.push(
      `Criterion '${criterionWithMaxNegativeAvgDelta}' tended to score lowest in isolation (i.e., higher holistically, average delta: ${maxNegativeAvgDelta.toFixed(2)} points).`
    );
  }
  
  if (overallComparisonsCount > 0) {
    const overallAverageEffect = overallTotalDelta / overallComparisonsCount;
    const direction = overallAverageEffect > 0 ? "higher" : "lower";
    insights.push(
      `Overall, scores were on average ${Math.abs(overallAverageEffect).toFixed(2)} points ${direction} when evaluated in isolation compared to holistically (across ${overallComparisonsCount} item-criterion comparisons).`
    );
  }
  
  if (insights.length === 1 && insights[0].startsWith("No significant differences")) {
      insights.push("Detailed per-item analysis below may still reveal model-specific or item-specific trends.");
  }

  return insights;
};

const AggregatedAdvancedIsolatedDisplay: React.FC<Props> = ({ data }) => {
  if (!data || !data.itemSummaries || data.itemSummaries.length === 0) {
    return (
      <p className="text-sm text-gray-500 p-2">
        No aggregated isolated vs. holistic data available to display.
      </p>
    );
  }

  const summaryInsights = generateIsolatedSummaryInsights(data); // Generate insights

  return (
    <div className="space-y-6">
      {/* Display Summary Insights */}
      {summaryInsights && summaryInsights.length > 0 && (
        <div className="mb-6 p-4 border border-teal-200 rounded-lg bg-teal-50 shadow">
          <h4 className="text-md font-semibold text-teal-700 mb-2">Aggregated Insights (Isolated vs. Holistic - Task: {data.taskName}):</h4>
          <ul className="list-disc pl-5 space-y-1 text-sm text-teal-800">
            {summaryInsights.map((insight, index) => (
              <li key={index}>{insight}</li>
            ))}
          </ul>
        </div>
      )}
      
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