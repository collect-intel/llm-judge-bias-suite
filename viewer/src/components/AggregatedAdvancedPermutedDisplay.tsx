import React from 'react';
import {
  AggregatedAdvancedPermutedOverallSummary,
  AggregatedPermutedItemSummary,
  AggregatedPermutedItemCriterionComparison,
  AggregatedPermutedCriterionOrderStats,
} from '@/types/aggregatedAdvancedPermuted';

interface Props {
  data: AggregatedAdvancedPermutedOverallSummary;
}

// Helper function to generate textual insights
const generateSummaryInsights = (data: AggregatedAdvancedPermutedOverallSummary): string[] => {
  const insights: string[] = [];
  if (!data || !data.itemSummaries || data.itemSummaries.length === 0) {
    return ["No data to generate insights."];
  }

  let maxDelta = 0;
  let criterionWithMaxDelta = '';
  let itemWithMaxDelta = '';
  let orderPairForMaxDelta: [string, string] = ['', ''];

  let overallOrderTendencies: Record<string, { totalDelta: number, count: number, criteriaAffected: Set<string> }> = {};

  for (const itemSummary of data.itemSummaries) {
    for (const criterionComp of itemSummary.criteriaComparisons) {
      const originalOrder = criterionComp.scoresByOrder.find(o => o.orderName.toLowerCase().includes('original'));
      const otherOrders = criterionComp.scoresByOrder.filter(o => !originalOrder || o.orderName !== originalOrder.orderName);

      if (originalOrder && typeof originalOrder.averageScore === 'number') {
        for (const otherOrder of otherOrders) {
          if (typeof otherOrder.averageScore === 'number') {
            const delta = otherOrder.averageScore - originalOrder.averageScore;
            const absDelta = Math.abs(delta);

            if (absDelta > Math.abs(maxDelta)) {
              maxDelta = delta;
              criterionWithMaxDelta = criterionComp.criterionName;
              itemWithMaxDelta = itemSummary.itemTitle || itemSummary.itemId;
              orderPairForMaxDelta = [originalOrder.orderName, otherOrder.orderName];
            }

            const orderKey = `${otherOrder.orderName} vs ${originalOrder.orderName}`;
            if (!overallOrderTendencies[orderKey]) {
              overallOrderTendencies[orderKey] = { totalDelta: 0, count: 0, criteriaAffected: new Set() };
            }
            overallOrderTendencies[orderKey].totalDelta += delta;
            overallOrderTendencies[orderKey].count++;
            overallOrderTendencies[orderKey].criteriaAffected.add(criterionComp.criterionName);
          }
        }
      }
    }
  }

  if (criterionWithMaxDelta) {
    insights.push(
      `The largest average score change observed was for criterion '${criterionWithMaxDelta}' in item '${itemWithMaxDelta}', with a delta of ${maxDelta.toFixed(2)} when comparing '${orderPairForMaxDelta[1]}' to '${orderPairForMaxDelta[0]}'.`
    );
  } else {
    insights.push("No significant score changes due to order permutation were identified across items and criteria.")
  }

  for (const [orderComparison, stats] of Object.entries(overallOrderTendencies)) {
    if (stats.count > 0) {
      const avgDelta = stats.totalDelta / stats.count;
      const affectedCriteriaList = Array.from(stats.criteriaAffected).slice(0, 3).join(', ');
      const moreOrLess = avgDelta > 0 ? "higher" : "lower";
      insights.push(
        `On average, scores tended to be ${Math.abs(avgDelta).toFixed(2)} points ${moreOrLess} when using '${orderComparison.split(' vs ')[0]}' compared to '${orderComparison.split(' vs ')[1]}', affecting criteria like ${affectedCriteriaList}${stats.criteriaAffected.size > 3 ? ' and others' : ''} (based on ${stats.count} comparisons across items).`
      );
    }
  }
  
  if (insights.length === 1 && insights[0].startsWith("No significant score changes")) { // if only the default "no significant changes" message is there
      insights.push("Detailed per-item analysis below may still reveal model-specific or item-specific trends.");
  }


  return insights;
};

const AggregatedAdvancedPermutedDisplay: React.FC<Props> = ({ data }) => {
  if (!data || !data.itemSummaries || data.itemSummaries.length === 0) {
    return (
      <p className="text-sm text-gray-500 p-2">
        No aggregated permuted order data available to display.
      </p>
    );
  }

  // Helper to find a baseline order (e.g., original) and others for comparison
  const findOrderStats = (orders: AggregatedPermutedCriterionOrderStats[]) => {
    const originalOrder = orders.find(o => o.orderName.toLowerCase().includes('original'));
    const otherOrders = orders.filter(o => !originalOrder || o.orderName !== originalOrder.orderName);
    return { originalOrder, otherOrders };
  };

  const summaryInsights = generateSummaryInsights(data); // Generate insights

  return (
    <div className="space-y-6">
      {/* Display Summary Insights */}
      {summaryInsights && summaryInsights.length > 0 && (
        <div className="mb-6 p-4 border border-indigo-200 rounded-lg bg-indigo-50 shadow">
          <h4 className="text-md font-semibold text-indigo-700 mb-2">Aggregated Insights (Permuted Order - Task: {data.taskName}):</h4>
          <ul className="list-disc pl-5 space-y-1 text-sm text-indigo-800">
            {summaryInsights.map((insight, index) => (
              <li key={index}>{insight}</li>
            ))}
          </ul>
        </div>
      )}

      {data.itemSummaries.map((itemSummary: AggregatedPermutedItemSummary) => (
        <div key={itemSummary.itemId} className="p-4 border rounded-lg shadow-md bg-white">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">
            Item: {itemSummary.itemTitle || itemSummary.itemId} (ID: {itemSummary.itemId})
          </h3>
          {itemSummary.criteriaComparisons.length > 0 ? (
            <div className="space-y-4">
              {itemSummary.criteriaComparisons.map((criterionComp: AggregatedPermutedItemCriterionComparison) => {
                const { originalOrder, otherOrders } = findOrderStats(criterionComp.scoresByOrder);
                const allOrdersForHeader = [originalOrder, ...otherOrders].filter(Boolean) as AggregatedPermutedCriterionOrderStats[];

                return (
                  <div key={criterionComp.criterionName} className="pl-3 border-l-2 border-indigo-200 py-2">
                    <p className="text-md font-semibold text-gray-700 mb-1">Criterion: {criterionComp.criterionName}</p>
                    {criterionComp.scoresByOrder.length > 0 ? (
                      <table className="min-w-full divide-y divide-gray-300 text-sm">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Order Name</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Avg. Score</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Std. Dev</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Models</th>
                            {originalOrder && otherOrders.map(other => other && (
                                <th key={`${other.orderName}-delta-header`} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                                    Delta vs Original
                                    <span className="block text-xs font-normal text-gray-500">({other.orderName.replace('Order','').replace('_'+data.taskName.substring(0,3),'')} - Original)</span>
                                </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {allOrdersForHeader.map((orderStats) => {
                            let deltaCell = null;
                            if (originalOrder && orderStats.orderName !== originalOrder.orderName) {
                              const delta = (typeof orderStats.averageScore === 'number' && typeof originalOrder.averageScore === 'number')
                                ? orderStats.averageScore - originalOrder.averageScore
                                : null;
                              let deltaColorClass = '';
                              if (typeof delta === 'number') {
                                if (delta > 0.01) deltaColorClass = 'text-green-700 font-bold';
                                else if (delta < -0.01) deltaColorClass = 'text-red-700 font-bold';
                              }
                              deltaCell = (
                                <td className={`px-3 py-2 ${deltaColorClass}`}>
                                  {typeof delta === 'number' ? delta.toFixed(2) : 'N/A'}
                                </td>
                              );
                            }

                            return (
                              <tr key={orderStats.orderName}>
                                <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{orderStats.orderName}</td>
                                <td className="px-3 py-2 text-gray-700">
                                  {typeof orderStats.averageScore === 'number' ? orderStats.averageScore.toFixed(2) : 'N/A'}
                                </td>
                                <td className="px-3 py-2 text-gray-700">
                                  {typeof orderStats.stdDevScore === 'number' ? orderStats.stdDevScore.toFixed(2) : 'N/A'}
                                </td>
                                <td className="px-3 py-2 text-gray-700">{orderStats.modelCount ?? 'N/A'}</td>
                                {originalOrder && orderStats.orderName === originalOrder.orderName && otherOrders.map(_ => <td key={`${orderStats.orderName}-empty-delta`} className="px-3 py-2">-</td>) }
                                {deltaCell}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-gray-500">No score data for this criterion.</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No criteria comparison data for this item.</p>
          )}
        </div>
      ))}
    </div>
  );
};

export default AggregatedAdvancedPermutedDisplay; 