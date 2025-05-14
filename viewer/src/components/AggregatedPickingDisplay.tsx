import React from 'react';
import { AggregatedPickingSummary, AggregatedPickingVariantSchemeData } from '@/types/aggregatedPicking';

// Assuming AggregatedPickingSummary and AggregatedPickingVariantSchemeData
// will be imported from a shared types file or from page.tsx if hoisted.
// For now, let's redefine them here for clarity if this were a standalone file.
// Ideally, these types would be in `viewer/src/types/pickingExperiment.ts` or similar.

interface AggregatedPickingDisplayProps {
  data: AggregatedPickingSummary | null;
}

const AggregatedPickingDisplay: React.FC<AggregatedPickingDisplayProps> = ({ data }) => {
  if (!data || data.aggregatedVariantSchemes.length === 0) {
    return <p className="text-gray-600">No aggregated picking data to display or insufficient models processed.</p>;
  }

  console.log("Aggregated Picking Data:", data);
  data?.aggregatedVariantSchemes.forEach((item, index) => {
    console.log(`Aggregated Scheme Item ${index}:`, item);
  });

  return (
    <div className="bg-gray-100 p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">
        Aggregated Picking Experiment Summary ({data.overallModelCount} Models)
      </h2>
      {/* Display Grand Overall First Slot Preference if available */} 
      {data.grandOverallFirstSlotPreferencePercentage !== undefined && (
        <div className="mb-6 p-4 bg-blue-100 border border-blue-300 rounded-md text-center">
          <p className="text-lg font-semibold text-blue-800">Grand Overall First Slot Preference:</p>
          <p className="text-3xl font-bold text-blue-700">{data.grandOverallFirstSlotPreferencePercentage.toFixed(2)}%</p>
          <p className="text-sm text-gray-600">
            (Based on {data.grandTotalFirstSlotPicks} first slot picks out of {data.grandTotalDecisions} total decisions across all displayed schemes/variants)
          </p>
        </div>
      )}
      <div className="space-y-6">
        {data.aggregatedVariantSchemes.map((aggItem, index) => (
          <div key={index} className="p-4 bg-white rounded shadow-md hover:shadow-lg transition-shadow">
            <h3 className="text-xl font-semibold text-indigo-700 mb-1">{aggItem.variantName}</h3>
            <p className="text-md text-gray-700 mb-1">
              Scheme: <span className="font-medium">{aggItem.labelingSchemeName}</span> 
              <span className="text-sm text-gray-500 italic"> ({aggItem.schemeDescription})</span>
            </p>
            <p className="text-sm text-gray-500 mb-2">
              Presented Labels: '{aggItem.schemeDisplayLabel1}' vs '{aggItem.schemeDisplayLabel2}' (Models in Group: {aggItem.modelCount})
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
              <div className="p-3 bg-indigo-50 rounded-md lg:col-span-1">
                <p className="font-semibold text-indigo-800">Model-Level Positional Bias:</p>
                <p>Avg. Rate: <span className="font-bold">{aggItem.averageBiasRate.toFixed(2)}%</span></p>
                <p>StdDev: {aggItem.stdDevBiasRate.toFixed(2)}%</p>
                <p>Models Showing Bias: {aggItem.totalModelsShowingBias} / {aggItem.modelCount}</p>
              </div>
              
              <div className="p-3 bg-green-50 rounded-md lg:col-span-1">
                <p className="font-semibold text-green-800">Model-Level Choice Consistency:</p>
                <p>Avg. Rate: <span className="font-bold">{aggItem.averageConsistencyRate.toFixed(2)}%</span></p>
                <p>StdDev: {aggItem.stdDevConsistencyRate.toFixed(2)}%</p>
              </div>

              {/* NEW Section for Overall First Slot Preference for this specific variant/scheme */} 
              {aggItem.overallFirstSlotPreferencePercentage !== undefined && (
                <div className="p-3 bg-blue-50 rounded-md lg:col-span-1">
                  <p className="font-semibold text-blue-800">Overall First Slot Preference:</p>
                  <p>Picked 1st Slot: <span className="font-bold text-lg">{aggItem.overallFirstSlotPreferencePercentage.toFixed(2)}%</span></p>
                  <p className="text-xs text-gray-600">
                    ({aggItem.totalFirstSlotPicksAcrossModelsAndRepetitions} of {aggItem.totalDecisionsAcrossModelsAndRepetitions} decisions)
                  </p>
                </div>
              )}
              
              <div className="md:col-span-2 lg:col-span-3 p-3 bg-yellow-50 rounded-md mt-2">
                <p className="font-semibold text-yellow-800">Model Bias Direction (Favored Label - among {aggItem.modelCount} models in group):</p>
                <p>Favored '{aggItem.schemeDisplayLabel1}': {aggItem.totalModelsFavoredLabel1} model(s)</p>
                <p>Favored '{aggItem.schemeDisplayLabel2}': {aggItem.totalModelsFavoredLabel2} model(s)</p>
                <p>Inconclusive Position Bias: {aggItem.totalModelsFavoredPositionInconclusive} model(s)</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AggregatedPickingDisplay;

// Helper function (if needed, or use a library)
// const calculateStdDev = (array: number[], mean: number): number => {
//   if (array.length < 2) return 0;
//   const variance = array.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (array.length - 1);
//   return parseFloat(Math.sqrt(variance).toFixed(2));
// }; 