'use client';

import { useEffect, useState, useCallback } from 'react';

// Import Actual Types from @/types - these should be properly exported from their definition files
import { ScoringExperimentData } from '@/types/scoringExperiment'; // Assuming ScoringVariantResult, ScoringItemResult are used internally or not needed at top level here
import { PermutedOrderExperimentData, IsolatedHolisticExperimentData } from '@/types/advancedMultiCriteriaExperiment';
import { PairwiseEloExperimentDataWrapper } from '@/types/pairwiseEloExperiment';
import { AggregatedPickingSummary } from '@/types/aggregatedPicking';
import { AggregatedScoringOverallSummary } from '@/types/aggregatedScoring';
import { AggregatedEloOverallSummary } from '@/types/aggregatedPairwiseElo';
import { AggregatedAdvancedPermutedOverallSummary } from '@/types/aggregatedAdvancedPermuted';
import { AggregatedAdvancedIsolatedOverallSummary } from '@/types/aggregatedAdvancedIsolated';

// Import Components
import PickingExperimentCharts from '@/components/PickingExperimentCharts';
import ScoringExperimentViewer from '@/components/ScoringExperimentViewer';
import AdvancedPermutedOrderViewer from '@/components/AdvancedPermutedOrderViewer';
import AdvancedIsolatedHolisticViewer from '@/components/AdvancedIsolatedHolisticViewer';
import PairwiseEloViewer from '@/components/PairwiseEloViewer';
import AggregatedPickingDisplay from '@/components/AggregatedPickingDisplay';
import AggregatedScoringDisplay from '@/components/AggregatedScoringDisplay';
import AggregatedEloDisplay from '@/components/AggregatedEloDisplay';
import AggregatedAdvancedPermutedDisplay from '@/components/AggregatedAdvancedPermutedDisplay';
import AggregatedAdvancedIsolatedDisplay from '@/components/AggregatedAdvancedIsolatedDisplay';
import { calculateAggregatedPickingData, calculateAggregatedScoringData, calculateAggregatedEloData, calculateAggregatedPermutedData, calculateAggregatedIsolatedData, ModelDataStatesForAggregation } from '@/utils/aggregationCalculators';

// --- START: Locally Defined Types (originally from page.tsx or similar context) ---
interface ExperimentScanFile {
    experimentType: string;
    modelName: string;
    fileName: string;
    filePath: string;
}

interface ExperimentScanData {
    models: Record<string, ExperimentScanFile[]>;
    modelNames: string[];
}

interface ScanResults {
    resultsDir: string;
    experiments: Record<string, ExperimentScanData>;
    availableModels: string[];
}

interface PickingPairDetail { // As defined in Python output for picking experiments
    pair_id: string;
    labeling_scheme_name: string; 
    scheme_label1_used_for_pair: string; 
    scheme_label2_used_for_pair: string; 
    question: string;
    text1_id: string;
    text2_id: string;
    expected_better_id?: string | null;
    analysis_status: string; 
    consistent_choice: string | null; 
    positional_bias_detected: boolean | null; 
    favored_actual_label_text?: string | null; 
    run1_order: string; 
    run1_majority_pick_id?: string | null;
    run1_pick_consistency: string; // e.g., "3/5"
    run1_pick_distribution: { [key: string]: number }; 
    run1_errors: string; // e.g., "0/5"
    run2_order: string; 
    run2_majority_pick_id?: string | null;
    run2_pick_consistency: string;
    run2_pick_distribution: { [key: string]: number };
    run2_errors: string;
    // Raw responses might be too large for this high-level type, handled in ModelExperimentState if needed
}

interface PickingExperimentSchemeResult { // Matches Python output structure for run_positional_bias_picking_experiment
    model_name: string;
    variant_name: string;
    labeling_scheme_name: string;
    scheme_description: string;
    scheme_display_label1: string;
    scheme_display_label2: string;
    total_pairs_tested_in_scheme: number;
    repetitions_per_order_run: number;
    pairs_with_errors_or_inconclusive_in_scheme: number;
    valid_pairs_for_bias_calculation: number;
    positional_bias_detected_count: number;
    positional_bias_rate_percentage: number;
    favored_scheme_label1_count: number;
    favored_scheme_label2_count: number;
    favored_position_inconclusive_count: number;
    valid_pairs_for_consistency_calculation: number;
    consistent_choices_count: number;
    consistency_rate_percentage: number;
    pairs_summary_for_scheme: PickingPairDetail[]; 
}

type PickingExperimentApiResponse = PickingExperimentSchemeResult[];

interface ProcessedPickingData { // For PickingExperimentCharts component
    variantName: string;
    labelingSchemeName: string; 
    schemeDescription: string; 
    schemeDisplayLabel1: string; 
    schemeDisplayLabel2: string; 
    biasRate: number; 
    consistencyRate: number; 
    totalValidPairsForBias: number;
    totalValidPairsForConsistency: number;
    favoredLabel1Count: number; 
    favoredLabel2Count: number; 
    favoredPositionInconclusiveCount: number; 
}

const transformPickingJsonToChartData = (apiResponse: PickingExperimentApiResponse): ProcessedPickingData[] => {
    if (!apiResponse || !Array.isArray(apiResponse)) return [];
    return apiResponse.map(schemeResult => ({
        variantName: schemeResult.variant_name,
        labelingSchemeName: schemeResult.labeling_scheme_name,
        schemeDescription: schemeResult.scheme_description,
        schemeDisplayLabel1: schemeResult.scheme_display_label1,
        schemeDisplayLabel2: schemeResult.scheme_display_label2,
        biasRate: schemeResult.positional_bias_rate_percentage,
        consistencyRate: schemeResult.consistency_rate_percentage,
        totalValidPairsForBias: schemeResult.valid_pairs_for_bias_calculation,
        totalValidPairsForConsistency: schemeResult.valid_pairs_for_consistency_calculation,
        favoredLabel1Count: schemeResult.favored_scheme_label1_count,
        favoredLabel2Count: schemeResult.favored_scheme_label2_count,
        favoredPositionInconclusiveCount: schemeResult.favored_position_inconclusive_count
    }));
};

interface ModelExperimentState { // Simplified from page.tsx, tailored for this report page
    data: any | null; // Raw JSON data from API
    processedPickingData?: ProcessedPickingData[] | null;
    scoringExperimentData?: ScoringExperimentData | null;
    permutedOrderData?: PermutedOrderExperimentData | null;
    isolatedHolisticData?: IsolatedHolisticExperimentData | null;
    pairwiseEloData?: PairwiseEloExperimentDataWrapper | null;
    isLoading: boolean; // Should be false once processed for this page
    error: string | null;
    fileName: string | null;
}
// --- END: Locally Defined Types ---

interface ApiError {
  error: string;
  details?: string;
}

const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = true }) => {
  return (
    <details className='mt-6 bg-white shadow-md rounded-lg overflow-hidden' open={defaultOpen}>
      <summary className='px-4 py-3 bg-gray-100 hover:bg-gray-200 cursor-pointer font-semibold text-gray-700 text-lg flex justify-between items-center'>
        {title}
        <span className='text-sm text-gray-500 group-open:rotate-90 transition-transform'>▼</span>
      </summary>
      <div className='p-4 border-t border-gray-200'>
        {children}
      </div>
    </details>
  );
};

interface FullReportData {
  experimentType: string;
  modelData: Record<string, ModelExperimentState>; 
  aggregatedSummary?: AggregatedPickingSummary | AggregatedScoringOverallSummary | AggregatedEloOverallSummary | AggregatedAdvancedPermutedOverallSummary | AggregatedAdvancedIsolatedOverallSummary | null;
}

export default function AllResultsReportPage() {
  const [reportData, setReportData] = useState<FullReportData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<ScanResults | null>(null); 
  const [scanResultsDir, setScanResultsDir] = useState<string | null>(null);

  const handleDownloadHtml = useCallback(() => {
    if (isLoading || error) {
      alert("Report is still loading or an error occurred. Please wait or resolve the error before downloading.");
      return;
    }
    try {
      const fullHtml = document.documentElement.outerHTML;
      const blob = new Blob([fullHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'comprehensive_llm_report.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error generating HTML for download:", e);
      alert("An error occurred while trying to generate the HTML file for download.");
    }
  }, [isLoading, error]);

  useEffect(() => {
    async function fetchAllData() { 
      setIsLoading(true);
      setError(null);
      try {
        const scanResponse = await fetch('/api/scan-results');
        if (!scanResponse.ok) {
          const errorData: ApiError = await scanResponse.json();
          throw new Error(errorData.error || `HTTP error! status: ${scanResponse.status}`);
        }
        const scanData: ScanResults = await scanResponse.json();
        setScanResults(scanData); 
        setScanResultsDir(scanData.resultsDir);

        if (!scanData.experiments || Object.keys(scanData.experiments).length === 0) {
          setError("No experiments found in scan results.");
          setIsLoading(false);
          return;
        }

        const allReportData: FullReportData[] = [];

        for (const experimentType of Object.keys(scanData.experiments).sort()) {
          const experimentMeta = scanData.experiments[experimentType];
          const currentExperimentProcessedModels: Record<string, ModelExperimentState> = {};
          const modelDataForAgg: ModelDataStatesForAggregation = {};

          for (const modelName of experimentMeta.modelNames.sort()) {
            const modelFiles = experimentMeta.models[modelName];
            if (modelFiles && modelFiles.length > 0) {
              let fileToFetch = modelFiles.find((f: ExperimentScanFile) => f.experimentType === experimentType);
              if (!fileToFetch) { 
                if (experimentType.startsWith('scoring') && modelFiles.some((f: ExperimentScanFile) => f.experimentType.startsWith('scoring'))) {
                    fileToFetch = modelFiles.find((f: ExperimentScanFile) => f.experimentType.startsWith('scoring'));
                } else {
                    fileToFetch = modelFiles[0]; 
                }
              }
              
              if (!fileToFetch) {
                console.warn(`No suitable file found for ${experimentType} / ${modelName}`);
                currentExperimentProcessedModels[modelName] = {
                    data: null, isLoading: false, error: `No suitable file found for ${experimentType}`, fileName: null
                };
                continue;
              }

              try {
                const apiUrl = `/api/get-experiment-data?filePath=${encodeURIComponent(fileToFetch.filePath)}`;
                const dataResponse = await fetch(apiUrl);
                if (!dataResponse.ok) {
                  const errorData: ApiError = await dataResponse.json();
                  throw new Error(errorData.error || `Failed to fetch data for ${modelName} / ${fileToFetch.fileName}`);
                }
                const rawData = await dataResponse.json();

                let processedPickingDataForChart: ProcessedPickingData[] | undefined = undefined;
                let processedScoringData: ScoringExperimentData | undefined = undefined;
                let permutedOrderDataForViewer: PermutedOrderExperimentData | undefined = undefined;
                let isolatedHolisticDataForViewer: IsolatedHolisticExperimentData | undefined = undefined;
                let pairwiseEloDataForViewer: PairwiseEloExperimentDataWrapper | undefined = undefined;

                const actualExperimentTypeFromFile = fileToFetch.experimentType;

                if (actualExperimentTypeFromFile === 'picking') {
                  processedPickingDataForChart = transformPickingJsonToChartData(rawData as PickingExperimentApiResponse);
                } else if (actualExperimentTypeFromFile.startsWith('scoring')) {
                  processedScoringData = rawData as ScoringExperimentData;
                } else if (actualExperimentTypeFromFile.startsWith('adv_multi_criteria_permuted')) {
                  permutedOrderDataForViewer = rawData as PermutedOrderExperimentData;
                } else if (actualExperimentTypeFromFile.startsWith('adv_multi_criteria_isolated')) {
                  isolatedHolisticDataForViewer = rawData as IsolatedHolisticExperimentData;
                } else if (actualExperimentTypeFromFile.startsWith('pairwise_elo')) {
                  pairwiseEloDataForViewer = rawData as PairwiseEloExperimentDataWrapper;
                }

                currentExperimentProcessedModels[modelName] = {
                  data: rawData,
                  processedPickingData: processedPickingDataForChart,
                  scoringExperimentData: processedScoringData,
                  permutedOrderData: permutedOrderDataForViewer,
                  isolatedHolisticData: isolatedHolisticDataForViewer,
                  pairwiseEloData: pairwiseEloDataForViewer,
                  isLoading: false,
                  error: null,
                  fileName: fileToFetch.fileName,
                };
                
                if (actualExperimentTypeFromFile === 'picking') {
                    modelDataForAgg[modelName] = { rawPickingData: rawData as PickingExperimentApiResponse, processedPickingData: processedPickingDataForChart };
                } else if (actualExperimentTypeFromFile.startsWith('scoring')) {
                    modelDataForAgg[modelName] = { scoringExperimentData: processedScoringData };
                } else if (actualExperimentTypeFromFile.startsWith('pairwise_elo')) {
                    modelDataForAgg[modelName] = { pairwiseEloData: pairwiseEloDataForViewer };
                } else if (actualExperimentTypeFromFile.startsWith('adv_multi_criteria_permuted')) {
                    modelDataForAgg[modelName] = { permutedOrderData: permutedOrderDataForViewer };
                } else if (actualExperimentTypeFromFile.startsWith('adv_multi_criteria_isolated')) {
                    modelDataForAgg[modelName] = { isolatedHolisticData: isolatedHolisticDataForViewer };
                }

              } catch (e: any) {
                console.error(`Error fetching/processing for ${modelName}, ${fileToFetch.fileName}:`, e);
                currentExperimentProcessedModels[modelName] = {
                  data: null, isLoading: false, error: e.message || 'Unknown error', fileName: fileToFetch.fileName
                };
              }
            }
          }
          
          let aggregatedSummary: FullReportData['aggregatedSummary'] = null;
          const relevantModelNamesForAgg = Object.keys(currentExperimentProcessedModels).filter(mn => !currentExperimentProcessedModels[mn].error && currentExperimentProcessedModels[mn].data);

          if (experimentType === 'picking') {
            aggregatedSummary = calculateAggregatedPickingData(modelDataForAgg, relevantModelNamesForAgg);
          } else if (experimentType.startsWith('scoring')) {
            aggregatedSummary = calculateAggregatedScoringData(modelDataForAgg, relevantModelNamesForAgg);
          } else if (experimentType.startsWith('pairwise_elo')) {
            aggregatedSummary = calculateAggregatedEloData(modelDataForAgg, relevantModelNamesForAgg);
          } else if (experimentType.startsWith('adv_multi_criteria_permuted')) {
            aggregatedSummary = calculateAggregatedPermutedData(modelDataForAgg, relevantModelNamesForAgg);
          } else if (experimentType.startsWith('adv_multi_criteria_isolated')) {
            aggregatedSummary = calculateAggregatedIsolatedData(modelDataForAgg, relevantModelNamesForAgg);
          }

          allReportData.push({
            experimentType: experimentType,
            modelData: currentExperimentProcessedModels,
            aggregatedSummary: aggregatedSummary,
          });
        }
        setReportData(allReportData);
      } catch (e: any) {
        console.error("Failed to fetch or process report data:", e);
        setError(e.message || 'An unknown error occurred.');
      }
      setIsLoading(false);
    }
    fetchAllData();
  }, []);

  if (isLoading) {
    return <div className="p-8 text-center text-xl">Generating comprehensive report... Please wait.</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-600 text-xl">Error generating report: {error}</div>;
  }

  if (reportData.length === 0) {
    return <div className="p-8 text-center text-lg">No data available to display in the report.</div>;
  }

  return (
    <div className="p-4 font-sans bg-gray-50 min-h-screen">
      <header className="mb-10 text-center relative">
        <h1 className="text-4xl font-bold text-gray-800">Comprehensive LLM Experiment Report</h1>
        {scanResultsDir && <p className="text-md text-gray-600 mt-2">Data sourced from: <code>{scanResultsDir}</code></p>}
        <p className="text-sm text-gray-500 mt-1">Report Generated: {new Date().toLocaleString()}</p>
        <button 
          onClick={handleDownloadHtml}
          disabled={isLoading || !!error}
          title={isLoading || error ? "Report not fully loaded or error present" : "Download current view as HTML"}
          className="absolute top-0 right-0 mt-2 mr-2 px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:bg-gray-400 transition-colors"
        >
          Download HTML
        </button>
      </header>

      {reportData.map((expReport, index) => (
        <CollapsibleSection 
            key={expReport.experimentType + index} 
            title={`${expReport.experimentType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} Experiment Summary`}
            defaultOpen={true} >
          
          <div className="mb-8 p-4 bg-indigo-50 rounded-lg shadow">
            <h2 className="text-2xl font-semibold text-indigo-700 mb-4">Overall Aggregated Results</h2>
            {expReport.experimentType === 'picking' && expReport.aggregatedSummary && (
              <AggregatedPickingDisplay data={expReport.aggregatedSummary as AggregatedPickingSummary} />
            )}
            {expReport.experimentType.startsWith('scoring') && expReport.aggregatedSummary && (
              <AggregatedScoringDisplay data={expReport.aggregatedSummary as AggregatedScoringOverallSummary} />
            )}
            {expReport.experimentType.startsWith('pairwise_elo') && expReport.aggregatedSummary && (
              <AggregatedEloDisplay data={expReport.aggregatedSummary as AggregatedEloOverallSummary} />
            )}
            {expReport.experimentType.startsWith('adv_multi_criteria_permuted') && expReport.aggregatedSummary && (
              <AggregatedAdvancedPermutedDisplay data={expReport.aggregatedSummary as AggregatedAdvancedPermutedOverallSummary} />
            )}
            {expReport.experimentType.startsWith('adv_multi_criteria_isolated') && expReport.aggregatedSummary && (
              <AggregatedAdvancedIsolatedDisplay data={expReport.aggregatedSummary as AggregatedAdvancedIsolatedOverallSummary} />
            )}
            {!expReport.aggregatedSummary && <p>No aggregated summary available for this experiment type, or an error occurred during aggregation.</p>}
          </div>

          <h2 className="text-2xl font-semibold text-gray-700 mt-8 mb-4">Model-Specific Results</h2>
          {Object.keys(expReport.modelData).sort().map(modelName => {
            const modelState = expReport.modelData[modelName];
            if (modelState.error) {
              return (
                <CollapsibleSection key={modelName} title={`Model: ${modelName} (Error)`} defaultOpen={true}>
                  <p className="text-red-500">Error loading data: {modelState.error} (File: {modelState.fileName || 'N/A'})</p>
                </CollapsibleSection>
              );
            }
            if (!modelState.data && !modelState.processedPickingData && !modelState.scoringExperimentData && !modelState.permutedOrderData && !modelState.isolatedHolisticData && !modelState.pairwiseEloData) {
                 return (
                    <CollapsibleSection key={modelName} title={`Model: ${modelName} (No Data)`} defaultOpen={true}>
                        <p className="text-gray-500">No data processed for this model for this experiment type (File: {modelState.fileName || 'N/A'}).</p>
                    </CollapsibleSection>
                );
            }

            const fileExperimentType = scanResults?.experiments[expReport.experimentType]?.models[modelName]?.find((f: ExperimentScanFile) => f.fileName === modelState.fileName)?.experimentType || expReport.experimentType;

            return (
              <CollapsibleSection key={modelName} title={`Model: ${modelName} (File: ${modelState.fileName || 'N/A'})`} defaultOpen={true}>
                {fileExperimentType === 'picking' && modelState.processedPickingData && (
                  <PickingExperimentCharts processedData={modelState.processedPickingData} modelName={modelName} />
                )}
                {fileExperimentType.startsWith('scoring') && modelState.scoringExperimentData && (
                  <ScoringExperimentViewer data={modelState.scoringExperimentData} modelName={modelName} />
                )}
                {fileExperimentType.startsWith('adv_multi_criteria_permuted') && modelState.permutedOrderData && (
                  <AdvancedPermutedOrderViewer data={modelState.permutedOrderData} modelName={modelName} />
                )}
                {fileExperimentType.startsWith('adv_multi_criteria_isolated') && modelState.isolatedHolisticData && (
                  <AdvancedIsolatedHolisticViewer data={modelState.isolatedHolisticData} modelName={modelName} />
                )}
                {fileExperimentType.startsWith('pairwise_elo') && modelState.pairwiseEloData && (
                  <PairwiseEloViewer data={modelState.pairwiseEloData} modelName={modelName} />
                )}
                 {!(fileExperimentType === 'picking' && modelState.processedPickingData) &&
                  !(fileExperimentType.startsWith('scoring') && modelState.scoringExperimentData) &&
                  !(fileExperimentType.startsWith('adv_multi_criteria_permuted') && modelState.permutedOrderData) &&
                  !(fileExperimentType.startsWith('adv_multi_criteria_isolated') && modelState.isolatedHolisticData) &&
                  !(fileExperimentType.startsWith('pairwise_elo') && modelState.pairwiseEloData) &&
                  modelState.data && 
                  <p className='text-sm text-gray-500'>Raw JSON data is available but no specific viewer is configured for this exact data structure in the comprehensive report.</p> }
              </CollapsibleSection>
            );
          })}
        </CollapsibleSection>
      ))}
    </div>
  );
} 