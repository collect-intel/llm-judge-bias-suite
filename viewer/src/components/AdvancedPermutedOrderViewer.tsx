import React from 'react';
import { PermutedOrderExperimentData, PermutedOrderItemSummary, PermutedOrderCriterionComparison, PermutedOrderScoreStats } from '@/types/advancedMultiCriteriaExperiment';

interface Props {
  data: PermutedOrderExperimentData;
  modelName: string;
}

const AdvancedPermutedOrderViewer: React.FC<Props> = ({ data, modelName }) => {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-500 p-2">No permuted order data available for {modelName}.</p>;
  }

  return (
    <div className="space-y-6">
      <h4 className="text-md font-semibold text-gray-700 mb-2">Permuted Order Analysis</h4>
      {data.map((itemSummary: PermutedOrderItemSummary) => (
        <div key={itemSummary.item_id} className="p-3 border rounded-md shadow-sm bg-gray-50">
          <h5 className="text-base font-semibold text-gray-800">
            Item: {itemSummary.item_title} (ID: {itemSummary.item_id})
          </h5>
          <div className="mt-2 space-y-3">
            {itemSummary.order_comparison_results.map((criterionComp: PermutedOrderCriterionComparison) => {
              const orderNames = Object.keys(criterionComp.scores_by_order);
              let originalOrderName = orderNames.find(name => name.toLowerCase().includes('original'));
              let reversedOrderName = orderNames.find(name => name.toLowerCase().includes('reversed'));

              if (!originalOrderName && orderNames.length > 0) originalOrderName = orderNames[0];
              if (!reversedOrderName && orderNames.length > 1) reversedOrderName = orderNames[1];
              else if (!reversedOrderName && orderNames.length === 1 && originalOrderName !== orderNames[0]) reversedOrderName = orderNames[0];
              else if (!reversedOrderName && originalOrderName === orderNames[0] && orderNames.length ===1 ) reversedOrderName = originalOrderName;
              
              const statsOriginal = originalOrderName ? criterionComp.scores_by_order[originalOrderName] : null;
              const statsReversed = reversedOrderName ? criterionComp.scores_by_order[reversedOrderName] : null;

              let delta: number | string = 'N/A';
              let deltaExplanation = 'N/A';

              if (statsOriginal && statsReversed && typeof statsOriginal.avg === 'number' && typeof statsReversed.avg === 'number') {
                delta = statsReversed.avg - statsOriginal.avg;
                deltaExplanation = `${reversedOrderName || 'Order 2'} Avg - ${originalOrderName || 'Order 1'} Avg`;
              } else if (orderNames.length === 1 && statsOriginal && typeof statsOriginal.avg === 'number'){
                delta = 'N/A';
                deltaExplanation = 'Only one order run';
              }

              return (
                <div key={criterionComp.criterion_name} className="pl-3 border-l-2 border-indigo-100">
                  <p className="font-medium text-gray-700 text-sm">Criterion: <span className='font-semibold'>{criterionComp.criterion_name}</span></p>
                  <table className="min-w-full divide-y divide-gray-200 mt-1 text-xs">
                    <thead className="bg-gray-100"><tr>
                        <th className="px-2 py-1 text-left font-medium text-gray-600">Metric</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-600">{originalOrderName || (orderNames.length > 0 ? orderNames[0] : 'Order 1')}</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-600">{reversedOrderName || (orderNames.length > 1 ? orderNames[1] : (orderNames.length === 1 ? 'N/A' : 'Order 2'))}</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-600 whitespace-nowrap">
                          Delta <span className="font-normal text-gray-500 text-[10px]">({deltaExplanation})</span>
                        </th>
                      </tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200"><tr>
                        <td className="px-2 py-1 font-medium">Avg Score</td>
                        <td className="px-2 py-1">{statsOriginal && typeof statsOriginal.avg === 'number' ? statsOriginal.avg.toFixed(2) : (statsOriginal?.avg || 'N/A')}</td>
                        <td className="px-2 py-1">{statsReversed && typeof statsReversed.avg === 'number' ? statsReversed.avg.toFixed(2) : (statsReversed?.avg || 'N/A')}</td>
                        <td className={`px-2 py-1 font-semibold ${typeof delta === 'number' && delta > 0.01 ? 'text-green-600' : typeof delta === 'number' && delta < -0.01 ? 'text-red-600' : ''}`}>
                          {typeof delta === 'number' ? delta.toFixed(2) : delta}
                        </td>
                      </tr><tr>
                        <td className="px-2 py-1 font-medium">Std Dev</td>
                        <td className="px-2 py-1">{statsOriginal && typeof statsOriginal.std === 'number' ? statsOriginal.std.toFixed(2) : (String(statsOriginal?.std ?? 'N/A'))}</td>
                        <td className="px-2 py-1">{statsReversed && typeof statsReversed.std === 'number' ? statsReversed.std.toFixed(2) : (String(statsReversed?.std ?? 'N/A'))}</td>
                        <td className="px-2 py-1"></td>
                      </tr><tr>
                        <td className="px-2 py-1 font-medium">N Valid / Reps</td>
                        <td className="px-2 py-1">{statsOriginal?.n_scores ?? 'N/A'} / {statsOriginal?.total_reps ?? 'N/A'}</td>
                        <td className="px-2 py-1">{statsReversed?.n_scores ?? 'N/A'} / {statsReversed?.total_reps ?? 'N/A'}</td>
                        <td className="px-2 py-1"></td>
                      </tr></tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AdvancedPermutedOrderViewer; 