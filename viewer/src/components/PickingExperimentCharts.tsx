import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  ChartData
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Define the structure of the data expected by the charts AFTER processing
export interface ProcessedPickingData {
  variantName: string;
  labelingSchemeName: string; 
  schemeDescription: string; 
  schemeDisplayLabel1: string; 
  schemeDisplayLabel2: string; 
  
  // METRIC DERIVED FROM FULL REPETITION DATA (calculated in page.tsx)
  avgFirstSlotPreferenceForScheme: number; // Average % of times the item in the first presentation slot was picked for this scheme
  
  repetitionsPerOrderRun?: number; 
}

interface PickingExperimentChartsProps {
  processedData: ProcessedPickingData[]; // Expects data pre-processed by page.tsx
  modelName: string;
}

// Helper function to get class names for highlighting picking stats
const getPickingStatClass = (metricName: 'avgFirstSlotPreference', value: number): string => {
  let baseClasses = "font-semibold";
  if (metricName === 'avgFirstSlotPreference') {
    // Higher deviation from 50% is more biased. Let's say >10% deviation (i.e., <40% or >60%) is notable.
    if (value < 40 || value > 60) return `${baseClasses} text-red-600`;
    if (value < 45 || value > 55) return `${baseClasses} text-yellow-600`;
  }
  // Removed consensusBiasRate and consensusConsistencyRate logic
  return `${baseClasses} text-gray-700`; // Default color if no threshold met
};

// The processPickingData function is MOVED to page.tsx as it needs the full experiment data (all variants).
// This component now only focuses on rendering the charts with the processed data.

const PickingExperimentCharts: React.FC<PickingExperimentChartsProps> = ({ processedData, modelName }) => {
  if (!processedData || processedData.length === 0) {
    return <p className="text-gray-500">No data available for picking experiment charts for model: {modelName}.</p>;
  }

  // --- Data Prep for Overview Chart ---
  const uniqueLabelingSchemes = Array.from(new Set(processedData.map(d => d.labelingSchemeName))).sort();
  const uniqueVariantNames = Array.from(new Set(processedData.map(d => d.variantName))).sort();

  const overviewChartColors = [
    'rgba(75, 192, 192, 0.7)', // Teal
    'rgba(255, 159, 64, 0.7)', // Orange
    'rgba(153, 102, 255, 0.7)',// Purple
    'rgba(255, 205, 86, 0.7)', // Yellow
    'rgba(54, 162, 235, 0.7)', // Blue
    'rgba(255, 99, 132, 0.7)',  // Red
    'rgba(201, 203, 207, 0.7)' // Grey
  ];

  const overviewChartDatasets = uniqueVariantNames.map((variantName, index) => {
    const dataForVariant = uniqueLabelingSchemes.map(schemeName => {
      const entry = processedData.find(d => d.variantName === variantName && d.labelingSchemeName === schemeName);
      // Plot deviation from 50% for avgFirstSlotPreferenceForScheme
      return entry ? Math.abs(entry.avgFirstSlotPreferenceForScheme - 50) : 0; 
    });
    return {
      label: variantName,
      data: dataForVariant,
      backgroundColor: overviewChartColors[index % overviewChartColors.length],
      borderColor: overviewChartColors[index % overviewChartColors.length].replace('0.7', '1'),
      borderWidth: 1,
    };
  });

  const overviewChartData: ChartData<'bar'> = {
    labels: uniqueLabelingSchemes,
    datasets: overviewChartDatasets,
  };

  const overviewChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: true,
        text: `Positional Influence: Avg. First Slot Preference Deviation from 50% (Model: ${modelName})`,
        font: { size: 18, weight: 'bold' },
        padding: { top: 10, bottom: 20 }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) label += ': ';
            if (context.parsed.y !== null) label += context.parsed.y.toFixed(2) + '%';
            return label;
          }
        }
      },
      legend: {
        position: 'top' as const,
        labels: {
          boxWidth: 20,
          padding: 20
        }
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Labeling Scheme',
          font: { size: 14, weight: 'normal'}
        },
      },
      y: {
        title: {
          display: true,
          text: 'Avg. First Slot Pref. Deviation from 50% (%)',
          font: { size: 14, weight: 'normal'}
        },
        min: 0,
        max: 50, // Max deviation is 50% (e.g., 100% preference for one slot or 0% for the other)
        ticks: {
          callback: function(value) {
            return value + '%';
          }
        }
      },
    },
    indexAxis: 'x', // Ensure bars are vertical for grouped chart
  };

  // --- End Data Prep for Overview Chart ---

  // Group data by variantName for detailed breakdown charts (existing logic)
  const dataByVariant: Record<string, ProcessedPickingData[]> = processedData.reduce((acc, curr) => {
    if (!acc[curr.variantName]) {
      acc[curr.variantName] = [];
    }
    acc[curr.variantName].push(curr);
    return acc;
  }, {} as Record<string, ProcessedPickingData[]>);

  return (
    <div className="space-y-12"> {/* Increased spacing for multiple charts */}
      {/* New Overview Chart */}
      <div className="p-4 border border-gray-200 rounded-lg bg-white shadow-lg">
        <div className="h-[500px]"> {/* Increased height for overview chart */}
            <Bar options={overviewChartOptions} data={overviewChartData} />
        </div>
      </div>

      {/* Existing Detailed Breakdown Charts and Summaries */} {/* THIS SECTION WILL BE REMOVED/HEAVILY MODIFIED */} Broadband
      {Object.entries(dataByVariant).map(([variantName, variantDataArray]) => {
        
        // const labels = variantDataArray.map(vd => vd.labelingSchemeName); // No longer needed for detailed chart
        
        // The detailedChartData and detailedChartOptions are for the stacked bar chart which we are removing.
        // So, we will remove this entire block related to detailedChartData and detailedChartOptions.

        return (
          <div key={variantName} className="p-4 border border-gray-200 rounded-lg bg-white shadow-md">
            <h3 className="text-xl font-semibold text-indigo-600 mb-1 text-center">
              Prompt Variant Detail: {variantName}
            </h3>
            
            {/* REMOVE The detailed breakdown chart (Bar component) */}
            {/* <div className="mb-6 h-80"> 
              <Bar options={detailedChartOptions} data={detailedChartData} />
            </div> */}

            {/* Detailed Summary Cards - MODIFIED */}
            <div className="space-y-3 mt-4">
              {variantDataArray.map((singleVariantData, index) => {
                // const totalBiasedPairs = singleVariantData.consensusFavoredLabel1Count + singleVariantData.consensusFavoredLabel2Count + singleVariantData.consensusFavoredPositionInconclusiveCount;
                // const totalConsistentPairs = singleVariantData.totalValidPairsForBias - totalBiasedPairs;
                // These consensus-based calcs are no longer needed here.

                return (
                  <div key={index} className="p-3 border border-gray-200 rounded-md bg-gray-50 hover:shadow-sm transition-shadow">
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">
                      Labeling Scheme: {singleVariantData.labelingSchemeName} 
                      <span className="text-xs text-gray-500 ml-1">({singleVariantData.schemeDescription})</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mb-2"> {/* Changed to 1 col for simplicity now */}
                      <div>
                        <p className="text-sm text-gray-600">
                          Avg. First Slot Preference: 
                          <span className={getPickingStatClass('avgFirstSlotPreference', singleVariantData.avgFirstSlotPreferenceForScheme)}>
                            {singleVariantData.avgFirstSlotPreferenceForScheme.toFixed(2)}%
                          </span>
                        </p>
                        <p className="text-xs text-gray-500 italic">
                          Avg. times item in 1st slot was picked (50% = no bias). Based on {singleVariantData.repetitionsPerOrderRun || 'N/A'} reps per order.
                        </p>
                      </div>
                      {/* Removed the Consensus Bias Rate and Consensus Consistency Rate sections */}
                    </div>
                    {/* Removed totalValidPairsForBias check as it was for consensus */}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PickingExperimentCharts; 