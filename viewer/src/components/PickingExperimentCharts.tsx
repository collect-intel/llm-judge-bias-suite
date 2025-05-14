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
  labelingSchemeName: string; // New: Name of the labeling scheme used
  schemeDescription: string; // New: Description of the scheme
  schemeDisplayLabel1: string; // New: e.g., "(A)" or "ID_rand1" - the first label from the scheme
  schemeDisplayLabel2: string; // New: e.g., "(B)" or "ID_rand2" - the second label from the scheme
  biasRate: number; // Percentage
  consistencyRate: number; // Percentage
  totalValidPairsForBias: number;
  totalValidPairsForConsistency: number;
  favoredLabel1Count: number; // New: Count of pairs biased towards the scheme's first label
  favoredLabel2Count: number; // New: Count of pairs biased towards the scheme's second label
  favoredPositionInconclusiveCount: number; // Count of biased pairs where position was inconclusive (name can remain)
}

interface PickingExperimentChartsProps {
  processedData: ProcessedPickingData[]; // Expects data pre-processed by page.tsx
  modelName: string;
}

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
      return entry ? entry.biasRate : 0; // Show 0 if no data for this variant/scheme combo
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
        text: `Overall Positional Bias Rate Comparison (Model: ${modelName})`,
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
          text: 'Positional Bias Rate (%)',
          font: { size: 14, weight: 'normal'}
        },
        min: 0,
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

      {/* Existing Detailed Breakdown Charts and Summaries */}
      {Object.entries(dataByVariant).map(([variantName, variantDataArray]) => {
        
        const labels = variantDataArray.map(vd => vd.labelingSchemeName);
        
        const detailedChartData: ChartData<'bar'> = {
          labels: labels,
          datasets: [
            {
              label: `Favored ${variantDataArray[0]?.schemeDisplayLabel1 || 'Label 1'} (% of biased)`,
              data: variantDataArray.map(vd => vd.totalValidPairsForBias > 0 ? (vd.favoredLabel1Count / (vd.favoredLabel1Count + vd.favoredLabel2Count + vd.favoredPositionInconclusiveCount || 1)) * 100 : 0),
              backgroundColor: 'rgba(54, 162, 235, 0.6)', 
              stack: 'biasStack',
            },
            {
              label: `Favored ${variantDataArray[0]?.schemeDisplayLabel2 || 'Label 2'} (% of biased)`,
              data: variantDataArray.map(vd => vd.totalValidPairsForBias > 0 ? (vd.favoredLabel2Count / (vd.favoredLabel1Count + vd.favoredLabel2Count + vd.favoredPositionInconclusiveCount || 1)) * 100 : 0),
              backgroundColor: 'rgba(255, 99, 132, 0.6)', 
              stack: 'biasStack',
            },
            {
              label: 'Favored (Inconclusive) (% of biased)',
              data: variantDataArray.map(vd => vd.totalValidPairsForBias > 0 ? (vd.favoredPositionInconclusiveCount / (vd.favoredLabel1Count + vd.favoredLabel2Count + vd.favoredPositionInconclusiveCount || 1)) * 100 : 0),
              backgroundColor: 'rgba(201, 203, 207, 0.6)',
              stack: 'biasStack',
            },
          ],
        };

        const detailedChartOptions: ChartOptions<'bar'> = {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: `Positional Bias Breakdown for Variant: ${variantName}`,
              font: { size: 16 },
              padding: { top: 10, bottom: 10}
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: function(context) {
                  let label = context.dataset.label || '';
                  if (label) label += ': ';
                  if (context.parsed.y !== null) label += context.parsed.y.toFixed(2) + '%';
                  
                  const schemeIndex = context.dataIndex;
                  const schemeData = variantDataArray[schemeIndex];
                  if (schemeData) {
                     const totalBiasedForThisStack = schemeData.favoredLabel1Count + schemeData.favoredLabel2Count + schemeData.favoredPositionInconclusiveCount;
                     if (totalBiasedForThisStack > 0 && context.dataset.stack === 'biasStack') {
                        label += ` (Total Bias: ${schemeData.biasRate.toFixed(2)}%, ${totalBiasedForThisStack} pairs)`
                     }
                  }
                  return label;
                }
              }
            },
            legend: {
              position: 'top' as const,
            },
          },
          scales: {
            x: {
              stacked: true,
              title: {
                display: true,
                text: 'Labeling Scheme',
              },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: 'Breakdown of Biased Pairs (%)',
              },
              min: 0,
              max: 100, // Max is 100 because it's percentage of biased pairs
              ticks: {
                callback: function(value) {
                  return value + '%';
                }
              }
            },
          },
        };

        return (
          <div key={variantName} className="p-4 border border-gray-200 rounded-lg bg-white shadow-md">
            <h3 className="text-xl font-semibold text-indigo-600 mb-1 text-center">
              Prompt Variant Detail: {variantName}
            </h3>
            
            <div className="mb-6 h-80"> 
              <Bar options={detailedChartOptions} data={detailedChartData} />
            </div>

            {/* Detailed Summary Cards - slightly restyled */}
            <div className="space-y-3 mt-4">
              {variantDataArray.map((singleVariantData, index) => {
                const totalBiasedPairs = singleVariantData.favoredLabel1Count + singleVariantData.favoredLabel2Count + singleVariantData.favoredPositionInconclusiveCount;
                const totalConsistentPairs = singleVariantData.totalValidPairsForBias - totalBiasedPairs;

                return (
                  <div key={index} className="p-3 border border-gray-200 rounded-md bg-gray-50 hover:shadow-sm transition-shadow">
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">
                      Labeling Scheme: {singleVariantData.labelingSchemeName} 
                      <span className="text-xs text-gray-500 ml-1">({singleVariantData.schemeDescription})</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div>
                        <p><strong>Positional Bias Rate:</strong> {singleVariantData.biasRate.toFixed(2)}% 
                          <span className="text-gray-600"> ({totalBiasedPairs} of {singleVariantData.totalValidPairsForBias} valid pairs)</span>
                        </p>
                        {totalBiasedPairs > 0 && (
                          <ul className="list-disc list-inside pl-3 mt-0.5 text-gray-500">
                            <li>Favored "{singleVariantData.schemeDisplayLabel1}": {singleVariantData.favoredLabel1Count}</li>
                            <li>Favored "{singleVariantData.schemeDisplayLabel2}": {singleVariantData.favoredLabel2Count}</li>
                            {singleVariantData.favoredPositionInconclusiveCount > 0 && (
                              <li>Inconclusive Bias: {singleVariantData.favoredPositionInconclusiveCount}</li>
                            )}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p><strong>Consistency Rate:</strong> {singleVariantData.consistencyRate.toFixed(2)}% 
                          <span className="text-gray-600"> ({totalConsistentPairs} of {singleVariantData.totalValidPairsForBias} valid pairs)</span>
                        </p>
                      </div>
                    </div>
                    {(singleVariantData.totalValidPairsForBias === 0) && (
                         <p className="text-xs text-orange-600 mt-1">Note: No valid pairs for bias/consistency calculation.</p>
                    )}
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