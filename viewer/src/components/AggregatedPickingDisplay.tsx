import React from 'react';
import { AggregatedPickingSummary, AggregatedPickingVariantSchemeData } from '@/types/aggregatedPicking';

// Assuming AggregatedPickingSummary and AggregatedPickingVariantSchemeData
// will be imported from a shared types file or from page.tsx if hoisted.
// For now, let's redefine them here for clarity if this were a standalone file.
// Ideally, these types would be in `viewer/src/types/pickingExperiment.ts` or similar.

interface AggregatedPickingDisplayProps {
  data: AggregatedPickingSummary | null;
}

// Helper function to get class names for highlighting picking stats - can be shared or defined locally
// If shared, this could be imported from a utils file or a common components area.
// For this example, I'm redefining it. In a real app, consider centralizing if used in many places.
const getPickingStatClass = (metricName: 'biasRate' | 'consistencyRate', value: number | null | undefined): string => {
  let baseClasses = "font-semibold";
  if (value === null || typeof value === 'undefined') return `${baseClasses} text-gray-500`; // Handle N/A or undefined

  if (metricName === 'biasRate') {
    if (value > 20) return `${baseClasses} text-red-600`;
    if (value > 10) return `${baseClasses} text-yellow-600`;
  }
  if (metricName === 'consistencyRate') {
    if (value < 80) return `${baseClasses} text-red-600`;
    if (value < 90) return `${baseClasses} text-yellow-600`;
  }
  return `${baseClasses} text-gray-700`; // Default color if no threshold met
};

// NEW Helper function to get background color class based on bias severity
const getBiasSeverityColorClass = (averageBiasRate: number | null | undefined): string => {
  if (averageBiasRate === null || typeof averageBiasRate === 'undefined') return 'bg-gray-100'; // Default for N/A

  // CORRECTED LOGIC: Lower averageBiasRate is better (closer to 0%)
  if (averageBiasRate <= 1) return 'bg-green-100 hover:bg-green-200';    // Excellent (e.g., 0-1%)
  if (averageBiasRate <= 2.5) return 'bg-green-50 hover:bg-green-100';  // Very good (e.g., >1-2.5%)
  if (averageBiasRate <= 5) return 'bg-yellow-50 hover:bg-yellow-100'; // Good (e.g., >2.5-5%)
  if (averageBiasRate <= 10) return 'bg-yellow-100 hover:bg-yellow-200';// Okay (e.g., >5-10%)
  if (averageBiasRate <= 15) return 'bg-orange-100 hover:bg-orange-200';// Concerning (e.g., >10-15%)
  if (averageBiasRate <= 25) return 'bg-red-100 hover:bg-red-200';      // Bad (e.g., >15-25%)
  return 'bg-red-200 hover:bg-red-300';                         // Very bad (e.g., >25%)
};

// Helper to truncate text
const truncateText = (text: string | null | undefined, maxLength: number = 50): string => {
  if (!text) return 'N/A';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

const AggregatedPickingDisplay: React.FC<AggregatedPickingDisplayProps> = ({ data }) => {
  if (!data || data.aggregatedVariantSchemes.length === 0) {
    return <p className="text-gray-600">No aggregated picking data to display or insufficient models processed.</p>;
  }

  console.log("Aggregated Picking Data:", data);
  data?.aggregatedVariantSchemes.forEach((item, index) => {
    console.log(`Aggregated Scheme Item ${index}:`, item);
  });

  // Sort by overallFirstSlotPreferencePercentage (deviation from 50%) - highest deviation first
  const sortedSchemes = [...data.aggregatedVariantSchemes].sort((a, b) => {
    const deviationA = Math.abs(a.overallFirstSlotPreferencePercentage - 50);
    const deviationB = Math.abs(b.overallFirstSlotPreferencePercentage - 50);
    return deviationB - deviationA; // Sort descending by deviation
  });

  const handleViewPrompts = (item: AggregatedPickingVariantSchemeData) => {
    console.log("Prompts for:", item.variantName, item.labelingSchemeName);
    console.log("System Prompt:", item.systemPromptUsed || "N/A");
    console.log("User Prompt Template:", item.userPromptTemplateUsed || "N/A");
    // For a real implementation, this would open a modal or an expandable section.
    alert(`System Prompt:\n${item.systemPromptUsed || 'N/A'}\n\nUser Prompt Template:\n${item.userPromptTemplateUsed || 'N/A'}`);
  };

  return (
    <div className="bg-gray-50 p-4 md:p-6 rounded-lg shadow-xl">
      <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-4">
        Aggregated Picking Experiment Summary ({data.overallModelCount} Models)
      </h2>
      {/* Display Grand Overall First Slot Preference if available */} 
      {data.grandOverallFirstSlotPreferencePercentage !== undefined && (
        <div className="mb-6 p-4 bg-blue-100 border border-blue-300 rounded-md text-center shadow">
          <p className="text-md md:text-lg font-semibold text-blue-800">Grand Overall First Slot Preference:</p>
          <p className="text-2xl md:text-3xl font-bold text-blue-700">{data.grandOverallFirstSlotPreferencePercentage.toFixed(2)}%</p>
          <p className="text-xs md:text-sm text-gray-600">
            (Based on {data.grandTotalFirstSlotPicks} first slot picks out of {data.grandTotalDecisions} total decisions)
          </p>
        </div>
      )}
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 border border-gray-300 shadow-md">
          <thead className="bg-gray-100">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider sticky left-0 bg-gray-100 z-10">Variant & Scheme</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">1st Slot Pref. (%)</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Prompts</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedSchemes.map((item, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 whitespace-nowrap text-sm sticky left-0 bg-white group-hover:bg-gray-50 z-10">
                  <div className="font-medium text-gray-900">{item.variantName}</div>
                  <div className="text-xs text-gray-500" title={item.schemeDescription}>
                    {item.labelingSchemeName} ({truncateText(item.schemeDescription, 30)})
                  </div>
                  <div className="text-xs text-gray-400 mt-1">({item.modelCount} model(s) in agg.)</div>
                </td>
                <td className={`px-4 py-3 whitespace-nowrap text-sm font-medium ${getBiasSeverityColorClass(Math.abs(item.overallFirstSlotPreferencePercentage - 50))}`}>
                  <div className={`text-lg font-bold ${getPickingStatClass('biasRate', item.overallFirstSlotPreferencePercentage)}`}>
                    {item.overallFirstSlotPreferencePercentage.toFixed(2)}%
                  </div>
                  <div className="text-xs text-gray-700 opacity-80">
                    (50% = no slot preference)
                  </div>
                  {(item.totalFirstSlotPicksAcrossModelsAndRepetitions !== undefined && item.totalDecisionsAcrossModelsAndRepetitions !== undefined) && (
                    <div className="text-xs text-gray-500">
                        ({item.totalFirstSlotPicksAcrossModelsAndRepetitions} / {item.totalDecisionsAcrossModelsAndRepetitions} picks)
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  <button
                    onClick={() => handleViewPrompts(item)}
                    className="text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none text-xs"
                    title="Click to view prompts in console/alert"
                  >
                    View Prompts
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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