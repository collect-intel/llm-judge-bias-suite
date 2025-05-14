import React from 'react';
import { IsolatedHolisticExperimentData, IsolatedHolisticItemSummary, IsolatedHolisticScoreDetail } from '@/types/advancedMultiCriteriaExperiment';

interface Props {
  data: IsolatedHolisticExperimentData;
  modelName: string;
}

const AdvancedIsolatedHolisticViewer: React.FC<Props> = ({ data, modelName }) => {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-500 p-2">No isolated vs. holistic data available for {modelName}.</p>;
  }

  return (
    <div className="space-y-6">
      <h4 className="text-md font-semibold text-gray-700 mb-2">Isolated vs. Holistic Analysis</h4>
      {data.map((itemSummary: IsolatedHolisticItemSummary) => (
        <div key={itemSummary.item_id} className="p-3 border rounded-md shadow-sm bg-gray-50">
          <h5 className="text-base font-semibold text-gray-800">
            Item: {itemSummary.item_title} (ID: {itemSummary.item_id})
          </h5>
          <table className="min-w-full divide-y divide-gray-200 mt-2 text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-2 py-1 text-left font-medium text-gray-600">Criterion</th>
                <th className="px-2 py-1 text-left font-medium text-gray-600">Isolated Avg</th>
                <th className="px-2 py-1 text-left font-medium text-gray-600">Holistic Avg</th>
                <th className="px-2 py-1 text-left font-medium text-gray-600">Delta (Iso - Hol)</th>
                <th className="px-2 py-1 text-left font-medium text-gray-600">Iso N/Reps</th>
                <th className="px-2 py-1 text-left font-medium text-gray-600">Hol N/Reps</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {itemSummary.comparison_details.map((detail: IsolatedHolisticScoreDetail) => (
                <tr key={detail.criterion}>
                  <td className="px-2 py-1 font-medium">{detail.criterion}</td>
                  <td className="px-2 py-1">
                    {detail.isolated_error 
                      ? <span className="text-red-500" title={detail.isolated_error}>Error</span> 
                      : (typeof detail.isolated_avg === 'number' ? detail.isolated_avg.toFixed(2) : 'N/A')}
                  </td>
                  <td className="px-2 py-1">{typeof detail.holistic_avg === 'number' ? detail.holistic_avg.toFixed(2) : 'N/A'}</td>
                  <td className={`px-2 py-1 ${detail.delta_avg && detail.delta_avg > 0.01 ? 'text-green-600 font-semibold' : detail.delta_avg && detail.delta_avg < -0.01 ? 'text-red-600 font-semibold' : ''}`}>
                    {typeof detail.delta_avg === 'number' ? detail.delta_avg.toFixed(2) : 'N/A'}
                  </td>
                  <td className="px-2 py-1">{detail.isolated_n ?? 'N/A'} / {detail.isolated_reps ?? 'N/A'}</td>
                  <td className="px-2 py-1">{detail.holistic_n ?? 'N/A'} / {detail.holistic_reps ?? 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default AdvancedIsolatedHolisticViewer; 