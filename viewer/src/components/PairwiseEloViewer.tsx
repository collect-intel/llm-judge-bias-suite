'use client';

import React from 'react';
import { PairwiseEloExperimentDataWrapper, EloItemVariantSummary } from '@/types/pairwiseEloExperiment';
import { calculateCrossoverScoreForEloSet } from '@/utils/eloCrossoverCalculator';

// Import Chart.js and react-chartjs-2
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface PairwiseEloViewerProps {
  data: PairwiseEloExperimentDataWrapper;
  modelName: string;
}

// Helper interface for the transformed data structure
interface TransformedEloItem {
  itemId: string;
  itemTextSnippet: string; // Assuming one snippet is enough, or fetch full text
  resultsByVariant: {
    [variantName: string]: {
      rank: number;
      eloRating: number;
      wins: number;
      losses: number;
      ties: number;
    } | undefined; // Undefined if item not in a variant (shouldn't happen if all items ranked)
  };
}

const PairwiseEloViewer: React.FC<PairwiseEloViewerProps> = ({ data, modelName }) => {
  // --- 1. Data Transformation --- 
  const uniqueVariantNames = Array.from(new Set(data.variants_summary.map(item => item.variant_name))).sort();
  
  const uniqueItemIds = Array.from(new Set(data.variants_summary.map(item => item.item_id))).sort();

  const transformedData: TransformedEloItem[] = uniqueItemIds.map(itemId => {
    const firstOccurrence = data.variants_summary.find(summary => summary.item_id === itemId);
    const itemResults: TransformedEloItem = {
      itemId: itemId,
      itemTextSnippet: firstOccurrence?.item_text_snippet || 'N/A',
      resultsByVariant: {}
    };

    uniqueVariantNames.forEach(variantName => {
      const variantData = data.variants_summary.find(
        summary => summary.item_id === itemId && summary.variant_name === variantName
      );
      if (variantData) {
        itemResults.resultsByVariant[variantName] = {
          rank: variantData.rank,
          eloRating: variantData.elo_rating,
          wins: variantData.wins,
          losses: variantData.losses,
          ties: variantData.ties,
        };
      }
    });
    return itemResults;
  });

  // --- 2. Rendering Logic --- 
  
  // --- Chart Data Preparation ---
  const PALE_COLORS = [
    'rgba(255, 99, 132, 0.9)', 'rgba(54, 162, 235, 0.9)', 'rgba(255, 206, 86, 0.9)',
    'rgba(75, 192, 192, 0.9)', 'rgba(153, 102, 255, 0.9)', 'rgba(255, 159, 64, 0.9)',
    'rgba(199, 199, 199, 0.9)', 'rgba(83, 102, 89, 0.9)', 'rgba(230, 120, 170, 0.9)',
    'rgba(100, 180, 220, 0.9)', 'rgba(250, 128, 114, 0.9)', 'rgba(60, 179, 113, 0.9)',
    'rgba(255, 215, 0, 0.9)', 'rgba(138, 43, 226, 0.9)', 'rgba(240, 128, 128, 0.9)'
  ];

  const generateColor = (index: number) => {
    return PALE_COLORS[index % PALE_COLORS.length];
  };

  const chartLabels = uniqueVariantNames;
  const chartDatasets = transformedData.map((item, index) => ({
    label: item.itemTextSnippet.substring(0,30) + (item.itemTextSnippet.length > 30 ? '...': ''), // Shorten for legend
    data: uniqueVariantNames.map(variantName => {
      const result = item.resultsByVariant[variantName];
      return result ? result.rank : null; 
    }),
    borderColor: generateColor(index),
    backgroundColor: generateColor(index), 
    fill: false,
    tension: 0.1, 
    borderWidth: 2.5,
    pointRadius: 5,
    pointHoverRadius: 7,
    pointHitRadius: 15,
  }));

  const bumpChartData = {
    labels: chartLabels,
    datasets: chartDatasets,
  };

  const allRanks = transformedData.flatMap(item => 
    Object.values(item.resultsByVariant).map(v => v?.rank)
  ).filter(rank => rank !== undefined && rank !== null) as number[];
  
  const minDataRank = allRanks.length > 0 ? Math.min(...allRanks) : 1;
  const maxDataRank = allRanks.length > 0 ? Math.max(...allRanks) : 1;

  const bumpChartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        reverse: true, 
        min: minDataRank, 
        max: maxDataRank,
        ticks: {
          stepSize: 1,
          callback: function(value: any) {
            return `Rank ${value}`;
          },
          font: { size: 10}
        },
        title: {
          display: true,
          text: 'Rank',
          font: { size: 12, weight: 'bold' }
        },
        grid: { // Add grid lines for y-axis
            drawOnChartArea: true,
            color: 'rgba(200, 200, 200, 0.2)', // Light grid lines
        }
      },
      x: {
        title: {
          display: true,
          text: 'Prompt Variant',
          font: { size: 12, weight: 'bold' }
        },
        ticks: {
          font: { size: 10 },
          maxRotation: 45, // Rotate labels if they overlap
          minRotation: 0
        },
        grid: { // Add grid lines for x-axis (usually less common for bump charts but can help)
            drawOnChartArea: false, // Typically false for x-axis to not clutter lines
        }
      }
    },
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
            font: { size: 10 },
            boxWidth: 15,
            padding: 15,
        }
      },
      title: {
        display: true,
        text: 'Item Rank Fluctuation Across Prompt Variants',
        font: { size: 16, weight: 'bold' as const },
        padding: { top:10, bottom: 20}
      },
      tooltip: {
        enabled: true,
        mode: 'index' as const, // Show tooltips for all datasets at that x-index
        intersect: false,      // Tooltip will show even if not directly hovering over point
        callbacks: {
            title: function(tooltipItems: any) {
                // Display variant name as tooltip title
                return tooltipItems[0].label;
            },
            label: function(context: any) {
                let label = context.dataset.label || '';
                if (label) {
                    label += ': ';
                }
                if (context.parsed.y !== null) {
                    label += `Rank ${context.parsed.y}`;
                }
                return label;
            }
        }
      }
    },
    elements: {
        line: {
            tension: 0.25 // A bit more curve for bump chart aesthetics
        }
    }
  };

  // --- Calculate Crossover Score using the utility function ---
  const crossoverScore = calculateCrossoverScoreForEloSet(data);
  // --- End Calculate Crossover Score ---

  return (
    <div className="bg-slate-50 p-3 rounded">
      <h3 className="text-lg font-semibold text-slate-700 mb-1">
        Pairwise ELO Ranking Comparison 
      </h3>
      <p className="text-sm text-slate-600 mb-1">Criterion: <span className='font-medium'>{data.criterion}</span></p>
      <p className="text-xs text-slate-500 mb-3">Ranking Set: <span className='font-mono text-xs'>{data.ranking_set_id}</span></p>

      {transformedData.length === 0 ? (
        <p className="text-slate-500">No ELO ranking data to display.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 border border-slate-200">
            <thead className="bg-slate-100">
              <tr>
                <th 
                  scope="col"
                  rowSpan={2} 
                  className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider border-r border-slate-200 align-middle"
                >
                  Item (ID & Snippet)
                </th>
                {uniqueVariantNames.map(variantName => (
                  <th 
                    key={variantName} 
                    colSpan={5} // Rank, ELO, W, L, T
                    scope="col"
                    className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider border-r border-slate-200"
                  >
                    {variantName}
                  </th>
                ))}
              </tr>
              <tr>
                {uniqueVariantNames.map(variantName => (
                  <React.Fragment key={`${variantName}-details`}>
                    <th scope="col" className="px-2 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider border-r border-slate-200">Rank</th>
                    <th scope="col" className="px-2 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider border-r border-slate-200">ELO</th>
                    <th scope="col" className="px-2 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider border-r border-slate-200">W</th>
                    <th scope="col" className="px-2 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider border-r border-slate-200">L</th>
                    <th scope="col" className="px-2 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider border-r border-slate-200">T</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {transformedData.map(item => (
                <tr key={item.itemId} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-700 border-r border-slate-200">
                    <div className="font-semibold">{item.itemId}</div>
                    <div className="text-xs text-slate-500 truncate max-w-xs" title={item.itemTextSnippet}>{item.itemTextSnippet}</div>
                  </td>
                  {uniqueVariantNames.map(variantName => {
                    const result = item.resultsByVariant[variantName];
                    return (
                      <React.Fragment key={`${item.itemId}-${variantName}`}>
                        <td className="px-2 py-2 whitespace-nowrap text-sm text-slate-600 text-center border-r border-slate-200">{result?.rank ?? '-'}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-sm text-slate-600 text-center border-r border-slate-200">{result?.eloRating?.toFixed(1) ?? '-'}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-sm text-slate-600 text-center border-r border-slate-200">{result?.wins ?? '-'}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-sm text-slate-600 text-center border-r border-slate-200">{result?.losses ?? '-'}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-sm text-slate-600 text-center border-r border-slate-200">{result?.ties ?? '-'}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bump Chart Section */}
      {transformedData.length > 0 && uniqueVariantNames.length > 1 && (
        <div className="mt-8 pt-4 border-t border-slate-200">
          <h4 className="text-md font-semibold text-slate-700 mb-1 text-center">
            Item Rank Fluctuation Across Prompt Variants
          </h4>
          <p className="text-center text-sm text-slate-600 mb-1">
            Heuristic Crossover Score: <span className="font-bold text-indigo-600">{crossoverScore === undefined ? 'N/A' : crossoverScore}</span>
          </p>
          <p className="text-center text-xs text-slate-500 mb-3 italic">
            (Counts rank order changes between adjacent variants. Higher score = more sensitivity to prompt phrasing.)
          </p>
          <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-md text-sm text-indigo-700">
            <p className="font-semibold mb-1">Interpreting this Bump Chart:</p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li>Each colored line represents a unique item being ranked. The vertical axis shows the item's rank (Rank 1 is best), and the horizontal axis shows the different ELO prompt variants used.</li>
              <li><strong>Ideal Consistency:</strong> If the LLM were perfectly consistent and uninfluenced by prompt phrasing, all lines would be horizontal and parallel. An item's rank would remain constant across all variants.</li>
              <li><strong>Detecting Inconsistency/Bias:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5 text-indigo-600">
                  <li><span className="font-medium">Crossing Lines:</span> Indicate that the relative order of items changes depending on the prompt. This is a strong visual indicator of the prompt variant affecting the LLM's judgment.</li>
                  <li><span className="font-medium">Steep Line Angles:</span> Show a large change in an item's rank between two variants.</li>
                  <li><span className="font-medium">"Tangled" Appearance:</span> Generally, the more lines cross and the more varied their paths, the greater the influence of prompt phrasing on the ranking outcome for this set of items and criterion.</li>
                </ul>
              </li>
              <li>This chart helps visualize how sensitive the model's comparative judgments are to the way questions are asked.</li>
              <li>A higher <strong>Crossover Score</strong> (shown above) suggests more instances where item rankings change order between adjacent prompt variants. This can be an indicator of greater sensitivity to prompt phrasing or inconsistencies in judgment.</li>
            </ul>
          </div>
          <div className="relative h-[500px] w-full md:h-[600px]"> {/* Responsive height example */}
            <Line options={bumpChartOptions} data={bumpChartData} />
          </div>
        </div>
      )}
    </div>
  );
};

export default PairwiseEloViewer; 