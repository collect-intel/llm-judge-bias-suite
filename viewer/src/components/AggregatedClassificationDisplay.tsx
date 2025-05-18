import React from 'react';
import { AggregatedClassificationOverallSummary, AggregatedClassificationModelStats, AggregatedClassificationSensitiveItem, AggregatedClassificationStrategyStats } from '@/types/aggregatedClassification';

interface AggregatedClassificationDisplayProps {
  data: AggregatedClassificationOverallSummary;
}

const AggregatedClassificationDisplay: React.FC<AggregatedClassificationDisplayProps> = ({ data }) => {
  if (!data || (!data.modelOverallStats?.length && !data.topSensitiveItems?.length && !data.strategyStats?.length)) {
    return <p className="text-sm text-gray-500 p-4">No aggregated classification data to display for the selected models.</p>;
  }

  const sortedModelStats = data.modelOverallStats ? [...data.modelOverallStats].sort((a, b) => {
    if (b.sensitivityScore !== a.sensitivityScore) {
      return b.sensitivityScore - a.sensitivityScore;
    }
    return a.modelName.localeCompare(b.modelName);
  }) : [];

  // topSensitiveItems is already sorted by diversity score by the calculator
  const topSensitiveItems = data.topSensitiveItems || [];
  
  // Sort strategyStats: higher unanimous agreement is better, lower diversity is better
  const sortedStrategyStats = data.strategyStats ? [...data.strategyStats].sort((a, b) => {
    if (b.percentageItemsWithUnanimousAgreement !== a.percentageItemsWithUnanimousAgreement) {
      return b.percentageItemsWithUnanimousAgreement - a.percentageItemsWithUnanimousAgreement;
    }
    if (a.averageItemClassificationDiversity !== b.averageItemClassificationDiversity) {
      return a.averageItemClassificationDiversity - b.averageItemClassificationDiversity;
    }
    return a.strategyId.localeCompare(b.strategyId);
  }) : [];

  return (
    <>
      {/* Model Sensitivity Table */}
      {sortedModelStats.length > 0 && (
        <div className="bg-white shadow-xl rounded-lg p-6 ring-1 ring-gray-200 mb-8">
          <h3 className="text-xl font-semibold text-gray-800 mb-1">Model Classification Consistency & Sensitivity</h3>
          <p className="text-xs text-gray-500 mb-4">
            Comparing how consistently models classify items across different prompt strategies ({data.overallModelCount} model(s) processed).
            <br />
            Sensitivity Score = (% of ambiguous items where the model changed classification based on strategy).
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Model Name</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Sensitivity Score (%)</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Sensitive Items</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Ambiguous Items Seen</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Total Items Seen</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Escape Hatch (Total)</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Escape Hatch (Ambiguous)</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Escape Hatch (Control)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedModelStats.map((modelStat: AggregatedClassificationModelStats) => (
                  <tr key={modelStat.modelName} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{modelStat.modelName}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-indigo-700 font-bold">{modelStat.sensitivityScore.toFixed(2)}%</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700">{modelStat.sensitiveItemCount}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700">{modelStat.totalAmbiguousItemsSeenByModel}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700">{modelStat.totalItemsSeenByModel}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700">{modelStat.escapeHatchStats.totalUses}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700">{modelStat.escapeHatchStats.onAmbiguousItems}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-red-500">{modelStat.escapeHatchStats.onControlItems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Item Sensitivity Ranking Table */}
      {topSensitiveItems.length > 0 && (
        <div className="bg-white shadow-xl rounded-lg p-6 ring-1 ring-gray-200 mt-8">
          <h3 className="text-xl font-semibold text-gray-800 mb-1">Item Classification Sensitivity Ranking</h3>
          <p className="text-xs text-gray-500 mb-4">
            Items ranked by how diversely they were classified across selected models and strategies.
            <br />
            Item Diversity Score = (Number of unique categories this item was classified into).
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Item ID</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Text Snippet</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Diversity Score</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Ambiguity Score</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Control?</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Distinct Classifications (Count)</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Models Showing Sensitivity</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {topSensitiveItems.map((item: AggregatedClassificationSensitiveItem) => (
                  <tr key={item.itemId} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-700" title={item.itemId}>{item.itemId.length > 15 ? `${item.itemId.substring(0,15)}...` : item.itemId}</td>
                    <td className="px-3 py-3 text-sm text-gray-600" title={item.itemTextSnippet}>{item.itemTextSnippet}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-indigo-700 font-bold text-center">{item.itemDiversityScore}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 text-center">{item.ambiguityScore.toFixed(2)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 text-center">{item.isControlItem ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">
                      {item.distinctClassifications.map(dc => `${dc.categoryId} (${dc.count})`).join(', ')}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600">{item.modelsShowingSensitivity.join(', ') || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* NEW: Strategy Consistency Overview Table */}
      {sortedStrategyStats.length > 0 && (
        <div className="bg-white shadow-xl rounded-lg p-6 ring-1 ring-gray-200 mt-8">
          <h3 className="text-xl font-semibold text-gray-800 mb-1">Strategy Consistency Overview</h3>
          <p className="text-xs text-gray-500 mb-4">
            Prompting strategies ranked by consistency across selected models and items.
            <br />
            Higher unanimous agreement and lower average diversity indicate more consistent strategies.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Strategy ID & Focus</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">% Items with Unanimous Agreement</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg. Item Classification Diversity</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Unique Items Processed</th>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Models Using Strategy</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedStrategyStats.map((strategy: AggregatedClassificationStrategyStats) => (
                  <tr key={strategy.strategyId} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-3 py-3 whitespace-normal text-sm font-medium text-gray-700" title={strategy.strategyDescription}>
                        {strategy.strategyId}
                        {strategy.experimentalFocus && <p className="text-xs text-purple-600 italic mt-0.5">🎯 {strategy.experimentalFocus}</p>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-green-700 font-bold text-center">{strategy.percentageItemsWithUnanimousAgreement.toFixed(2)}%</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700 font-bold text-center">{strategy.averageItemClassificationDiversity.toFixed(2)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600 text-center">{strategy.uniqueItemIdsProcessedCount}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600 text-center">{strategy.uniqueModelsThatUsedStrategyCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};

export default AggregatedClassificationDisplay; 