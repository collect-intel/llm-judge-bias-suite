import React, { useState, useMemo } from 'react';
import {
  ScoringExperimentData,
  ScoringVariantResult,
  ScoringVariantAggregateStats,
} from '@/types/scoringExperiment'; // Adjust path as necessary

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
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface ScoringExperimentViewerProps {
  data: ScoringExperimentData;
  modelName: string;
}

// Helper to format numbers or show N/A
const formatStat = (value: number | null | undefined): string => {
  if (value === null || typeof value === 'undefined') return 'N/A';
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
};

// Helper function to get cell class names for highlighting
const getStatCellClass = (metricKey: keyof ScoringVariantAggregateStats, value: number | null | undefined): string => {
  let className = "px-4 py-2";
  if (value === null || typeof value === 'undefined') return className;

  switch (metricKey) {
    case 'std_dev_normalized_score_overall':
      if (value > 1.5) className += ' bg-red-200';
      else if (value > 1.0) className += ' bg-yellow-200';
      break;
    case 'iqr_normalized_score_overall':
      if (value > 2.5) className += ' bg-red-200';
      else if (value > 2.0) className += ' bg-yellow-200';
      break;
    case 'total_errors_in_runs':
      if (value > 0) className += ' bg-orange-200'; // Using orange for errors
      break;
    default:
      break;
  }
  return className;
};

const ScoringExperimentViewer: React.FC<ScoringExperimentViewerProps> = ({ data, modelName }) => {
  const [selectedDataSource, setSelectedDataSource] = useState<string | null>(null);

  if (!data || data.length === 0) {
    return <p className="text-gray-500">No scoring experiment data available for model: {modelName}.</p>;
  }

  const availableDataSources = useMemo(() => {
    const sources = new Set(data.map(vr => vr.variant_config.data_source_tag));
    return Array.from(sources);
  }, [data]);

  // Set initial selectedDataSource if not already set and sources are available
  useState(() => {
    if (!selectedDataSource && availableDataSources.length > 0) {
      setSelectedDataSource(availableDataSources[0]);
    }
  }); // Runs once on mount effectively, or when availableDataSources changes

  const filteredData = useMemo(() => {
    if (!selectedDataSource) return data; // Show all if no filter selected, or handle differently
    return data.filter(vr => vr.variant_config.data_source_tag === selectedDataSource);
  }, [data, selectedDataSource]);

  // Prepare data for the Average Normalized Score Comparison chart
  const chartLabels = filteredData.map(variantResult => variantResult.variant_config.name);
  const chartDatasetData = filteredData.map(variantResult => variantResult.aggregate_stats.avg_normalized_score_overall);

  const averageScoresChartData: ChartData<'bar'> = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Avg. Normalized Score (1-5)',
        data: chartDatasetData,
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 1,
      },
    ],
  };

  const chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false, // Allows us to control height better with a wrapper div
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: `Avg. Norm. Scores for ${selectedDataSource || 'All Data Sources'} - Model: ${modelName}`,
        font: { size: 16 },
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            let labelLines: string[] = [];
            const variantIndex = context.dataIndex;
            const variantResult = filteredData[variantIndex]; 

            if (variantResult) {
              labelLines.push(`Variant: ${variantResult.variant_config.name}`);
              labelLines.push(`Avg. Score: ${context.parsed.y !== null ? context.parsed.y.toFixed(2) : 'N/A'}`);
              labelLines.push(`Scale: ${variantResult.variant_config.scale_type}`);
              labelLines.push(`Criterion: ${variantResult.variant_config.criterion_override || variantResult.variant_config.default_criterion || 'N/A'}`);
            }
            return labelLines;
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 5, // Assuming normalized scores are 1-5
        title: {
          display: true,
          text: 'Avg. Normalized Score (1-5)'
        }
      },
      x: {
        title: {
          display: true,
          text: 'Scoring Variant'
        },
        ticks: {
            // Prevent long variant names from overlapping by auto-skipping or rotating
            // For simplicity, let's not implement rotation here but be aware it might be needed.
            // autoSkip: true,
            // maxRotation: 0,
            // minRotation: 0,
            // Alternatively, can truncate labels or use a plugin for better label management if names are very long.
            // For now, rely on chart.js default behavior or manual adjustments to variant names if they cause issues.
        }
      }
    },
  };

  return (
    <div className="space-y-8">
      {/* Data Source Filter Dropdown */}
      <div className="p-4 bg-gray-100 rounded-lg shadow">
        <label htmlFor="dataSourceSelect" className="block text-sm font-medium text-gray-700 mb-1">
          Filter by Data Source:
        </label>
        <select 
          id="dataSourceSelect"
          value={selectedDataSource || ''}
          onChange={e => setSelectedDataSource(e.target.value || null)}
          className="block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        >
          <option value="">All Data Sources</option> {/* Option to show all, or remove if not desired */}
          {availableDataSources.map(source => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
      </div>

      {/* Chart Section */}
      {filteredData.length > 0 ? (
        <div className="p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
          <h2 className="text-xl font-semibold text-indigo-800 mb-4 text-center">
            Comparison: Average Normalized Scores
          </h2>
          <div className="relative h-[400px] md:h-[500px]"> {/* Responsive height */}
            <Bar options={chartOptions} data={averageScoresChartData} />
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500 py-4">No variants to display for the selected data source.</p>
      )}

      {/* Existing detailed variant breakdown (now uses filteredData) */}
      <h3 className="text-xl font-bold text-gray-800 mt-8 mb-4">
        Detailed Variant Statistics {selectedDataSource ? `(for ${selectedDataSource})` : '(All Data Sources)'}
      </h3>
      {filteredData.map((variantResult, index) => (
        <div key={variantResult.variant_config.name + index} className="p-4 border border-gray-200 rounded-lg bg-white shadow-sm mb-6">
          <h4 className="text-lg font-semibold text-indigo-700 mb-2">
            Variant: {variantResult.variant_config.name}
          </h4>
          <div className="mb-3 p-2 border border-dashed border-gray-300 bg-gray-50 rounded">
            <h5 className="text-sm font-medium text-gray-600 mb-1">Configuration:</h5>
            <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
              <li>Data Source: {variantResult.variant_config.data_source_tag}</li>
              <li>Scale Type: {variantResult.variant_config.scale_type}</li>
              <li>Criterion: {variantResult.variant_config.criterion_override || variantResult.variant_config.default_criterion || 'N/A'}</li>
              <li>Invert Scale: {variantResult.variant_config.invert_scale ? 'Yes' : 'No'}</li>
              <li>System Prompt Snippet: {variantResult.variant_config.system_prompt_snippet || 'N/A'}</li>
              <li>User Prompt Snippet: {variantResult.variant_config.user_prompt_template_snippet || 'N/A'}</li>
            </ul>
          </div>

          <h5 className="text-md font-medium text-gray-600 mb-1">Aggregate Statistics:</h5>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left text-gray-700">
              <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                <tr>
                  <th scope="col" className="px-4 py-2">Metric</th>
                  <th scope="col" className="px-4 py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(variantResult.aggregate_stats) as Array<keyof ScoringVariantAggregateStats>).map(key => (
                  <tr key={key} className="bg-white border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                      {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} 
                    </td>
                    <td className={getStatCellClass(key, variantResult.aggregate_stats[key])}>
                      {formatStat(variantResult.aggregate_stats[key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {filteredData.length === 0 && selectedDataSource && (
         <p className="text-center text-gray-500 py-4">No variants found for the data source: {selectedDataSource}.</p>
      )}
    </div>
  );
};

export default ScoringExperimentViewer; 