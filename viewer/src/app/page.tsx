'use client';

import { useEffect, useState, useCallback } from 'react';
// Remove Image import if not used
// import Image from "next/image"; 

// Import the new components
import DataTable from '@/components/DataTable';
import JsonViewer from '@/components/JsonViewer';
import PickingExperimentCharts, { ProcessedPickingData } from '@/components/PickingExperimentCharts';
// Import the new Scoring types
import {
  ScoringExperimentData,
  ScoringVariantResult,
  ScoringItemResult // Added for type consistency if ModelExperimentState exposes it directly
} from '@/types/scoringExperiment'; // Ensure this path is correct

// Import the new component
import ScoringExperimentViewer from '@/components/ScoringExperimentViewer';
import { PermutedOrderExperimentData, IsolatedHolisticExperimentData } from '@/types/advancedMultiCriteriaExperiment'; 
import AdvancedPermutedOrderViewer from '@/components/AdvancedPermutedOrderViewer';
import AdvancedIsolatedHolisticViewer from '@/components/AdvancedIsolatedHolisticViewer';
// Import the new Pairwise ELO types
import { PairwiseEloExperimentDataWrapper } from '@/types/pairwiseEloExperiment';
// Import the new PairwiseELOViewer component
import PairwiseEloViewer from '@/components/PairwiseEloViewer';

// Import shared types for aggregated picking data
import { AggregatedPickingSummary, AggregatedPickingVariantSchemeData } from '@/types/aggregatedPicking';

// Import the component for displaying aggregated picking data
import AggregatedPickingDisplay from '@/components/AggregatedPickingDisplay';

// Import shared types for aggregated scoring data
import { AggregatedScoringOverallSummary, AggregatedScoringVariantSummary, AggregatedScoringItemStats } from '@/types/aggregatedScoring';

// Import the component for displaying aggregated scoring data
import AggregatedScoringDisplay from '@/components/AggregatedScoringDisplay';

// Import shared types for aggregated ELO data
import { AggregatedEloOverallSummary, AggregatedEloVariantSummary, AggregatedEloItemStats } from '@/types/aggregatedPairwiseElo';

// Import the component for displaying aggregated ELO data
import AggregatedEloDisplay from '@/components/AggregatedEloDisplay';

// Import shared types for aggregated Advanced Multi-Criteria data
import { AggregatedAdvancedPermutedOverallSummary, AggregatedPermutedItemSummary, AggregatedPermutedItemCriterionComparison, AggregatedPermutedCriterionOrderStats } from '@/types/aggregatedAdvancedPermuted';
import { AggregatedAdvancedIsolatedOverallSummary, AggregatedIsolatedItemSummary, AggregatedIsolatedHolisticCriterionStats } from '@/types/aggregatedAdvancedIsolated';

// Import the new display component for aggregated isolated data
import AggregatedAdvancedIsolatedDisplay from '@/components/AggregatedAdvancedIsolatedDisplay';
import AggregatedAdvancedPermutedDisplay from '@/components/AggregatedAdvancedPermutedDisplay';

// Import aggregation calculators
import {
  calculateAggregatedPickingData,
  calculateAggregatedScoringData,
  calculateAggregatedEloData,
  calculateAggregatedPermutedData,
  calculateAggregatedIsolatedData,
  ModelDataStatesForAggregation
} from '@/utils/aggregationCalculators';

// Types matching the API response from scan-results
interface ExperimentScanFile {
  experimentType: string;
  modelName: string;
  fileName: string;
  filePath: string;
  // fileExtension: string; // No longer needed, always json
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

interface ApiError {
  error: string;
  details?: string;
}

// Type for the data fetched for each model
interface ModelExperimentState {
  data: any | null; // Raw JSON data from API (can be Picking or other types)
  processedPickingData?: ProcessedPickingData[] | null; // Specific for picking experiment charts
  scoringExperimentData?: ScoringExperimentData | null; // Specific for scoring experiments
  permutedOrderData?: PermutedOrderExperimentData | null; // New
  isolatedHolisticData?: IsolatedHolisticExperimentData | null; // New
  pairwiseEloData?: PairwiseEloExperimentDataWrapper | null; // New for Pairwise ELO
  isLoading: boolean;
  error: string | null;
  fileName: string | null;
}

// --- Reusable Collapsible Section Component ---
interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, children, defaultOpen = false }) => {
  return (
    <details className='mt-6 bg-white shadow-md rounded-lg overflow-hidden' open={defaultOpen}>
      <summary className='px-4 py-3 bg-gray-100 hover:bg-gray-200 cursor-pointer font-semibold text-gray-700 text-lg flex justify-between items-center'>
        {title}
        <span className='text-sm text-gray-500 group-open:rotate-90 transition-transform'>▼</span> {/* Basic arrow, can be improved */}
      </summary>
      <div className='p-4 border-t border-gray-200'>
        {children}
      </div>
    </details>
  );
};
// --- End Reusable Collapsible Section Component ---

// --- Interfaces for Picking Experiment JSON data structure ---
// This interface describes the detailed breakdown of each pair within a scheme
interface PickingPairDetail {
  pair_id: string;
  labeling_scheme_name: string; // From Python output
  scheme_label1_used_for_pair: string; // From Python output
  scheme_label2_used_for_pair: string; // From Python output
  question: string;
  text1_id: string;
  text2_id: string;
  expected_better_id?: string | null;
  analysis_status: string; 
  consistent_choice: string | null; 
  positional_bias_detected: boolean | null; 
  favored_actual_label_text?: string | null; // Updated from favored_position_label, matches Python output
  run1_majority_pick_id?: string | null;
  run2_majority_pick_id?: string | null;
  // Fields ADDED & MADE NON-OPTIONAL assuming they exist in the raw JSON from Python
  run1_order: string; 
  run2_order: string; 
  run1_pick_distribution: { [key: string]: number }; 
  run2_pick_distribution: { [key: string]: number }; 
}

// This interface matches each element in the JSON array produced by the Python script
// for the picking experiment. Each element is a summary for a specific (variant + scheme).
interface PickingExperimentSchemeResult {
  model_name: string;
  variant_name: string;
  labeling_scheme_name: string;
  scheme_description: string;
  scheme_display_label1: string;
  scheme_display_label2: string;
  total_pairs_tested_in_scheme: number;
  repetitions_per_order_run: number; // Used by calculator
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

// Type for the raw API response for a picking experiment file (top-level is an array of scheme results)
type PickingExperimentApiResponse = PickingExperimentSchemeResult[];

// --- End Interfaces for Picking Experiment ---

// This function transforms the raw API response for picking experiments 
// (which is an array of PickingExperimentSchemeResult) into the 
// ProcessedPickingData structure required by the PickingExperimentCharts component.
const transformPickingJsonToChartData = (apiResponse: PickingExperimentApiResponse): ProcessedPickingData[] => {
  if (!apiResponse || !Array.isArray(apiResponse)) return [];

  return apiResponse.map(schemeResult => {
    // The Python script now pre-calculates all necessary aggregates.
    // We just need to map them to the ProcessedPickingData structure.
    return {
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
    };
  });
};

export default function Home() {
  const [scanResults, setScanResults] = useState<ScanResults | null>(null);
  const [selectedExperiment, setSelectedExperiment] = useState<string>('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  
  const [experimentDataByModel, setExperimentDataByModel] = useState<Record<string, ModelExperimentState>>({});
  const [isScanLoading, setIsScanLoading] = useState<boolean>(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isFetchingModelData, setIsFetchingModelData] = useState<boolean>(false);

  // New state for aggregated data
  const [aggregatedPickingSummary, setAggregatedPickingSummary] = useState<AggregatedPickingSummary | null>(null);
  const [aggregatedScoringSummary, setAggregatedScoringSummary] = useState<AggregatedScoringOverallSummary | null>(null);
  const [aggregatedEloSummary, setAggregatedEloSummary] = useState<AggregatedEloOverallSummary | null>(null);
  const [aggregatedPermutedSummary, setAggregatedPermutedSummary] = useState<AggregatedAdvancedPermutedOverallSummary | null>(null);
  const [aggregatedIsolatedSummary, setAggregatedIsolatedSummary] = useState<AggregatedAdvancedIsolatedOverallSummary | null>(null);

  // --- Helper functions for dynamic grid classes ---
  const numSelectedModels = selectedModels.length;

  const getDataDisplayGridClasses = () => {
    if (numSelectedModels <= 1) { // Handles 0 or 1 model
      return "grid grid-cols-1 gap-8";
    } else if (numSelectedModels === 2) {
      return "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8";
    } else { // numSelectedModels >= 3
      return "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8";
    }
  };

  const getFullSpanGridItemClasses = () => {
    // For items that should span all columns within the dynamic grid
    if (numSelectedModels <= 1) {
      return "col-span-1"; // In a single column grid
    } else if (numSelectedModels === 2) {
      return "md:col-span-2 lg:col-span-2"; 
    } else { // numSelectedModels >= 3
      return "md:col-span-2 lg:col-span-3";
    }
  };
  // --- End Helper functions ---

  // Fetch initial scan of available experiments and models
  useEffect(() => {
    async function fetchScanResults() {
      setIsScanLoading(true);
      setScanError(null);
      try {
        const response = await fetch('/api/scan-results');
        if (!response.ok) {
          const errorData: ApiError = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const data: ScanResults = await response.json();
        setScanResults(data);
        if (data.experiments && Object.keys(data.experiments).length > 0) {
          const firstExperimentType = Object.keys(data.experiments)[0];
          setSelectedExperiment(firstExperimentType);
          // Automatically select the first model of the first experiment if available
          // const firstModel = data.experiments[firstExperimentType]?.modelNames[0];
          // if (firstModel) {
          //   setSelectedModels([firstModel]);
          // }
        }
      } catch (e: any) {
        console.error("Failed to fetch scan results:", e);
        setScanError(e.message || 'An unknown error occurred loading initial experiment list.');
      }
      setIsScanLoading(false);
    }
    fetchScanResults();
  }, []);

  // Fetch data for selected experiment and models
  useEffect(() => {
    if (!selectedExperiment || selectedModels.length === 0 || !scanResults) {
      setExperimentDataByModel({}); 
      setAggregatedPickingSummary(null); 
      setAggregatedScoringSummary(null); 
      setAggregatedEloSummary(null);
      setAggregatedPermutedSummary(null); 
      setAggregatedIsolatedSummary(null); 
      return;
    }

    async function fetchDataForSelections() {
      setIsFetchingModelData(true);
      const initialModelStates: Record<string, ModelExperimentState> = {};
      selectedModels.forEach(modelName => {
        initialModelStates[modelName] = { 
            data: null, 
            processedPickingData: null, 
            scoringExperimentData: null, 
            permutedOrderData: null, 
            isolatedHolisticData: null, 
            pairwiseEloData: null,
            isLoading: true, 
            error: null, 
            fileName: null 
        };
      });
      setExperimentDataByModel(initialModelStates);

      if (!scanResults) {
        console.error("scanResults is null, cannot proceed with data fetching.");
        const errorStateUpdate: Record<string, Partial<ModelExperimentState>> = {};
        selectedModels.forEach(modelName => {
            errorStateUpdate[modelName] = { isLoading: false, error: "Scan results not available."};
        });
        setExperimentDataByModel(prev => {
            const updated = {...prev};
            Object.keys(errorStateUpdate).forEach(key => { updated[key] = {...updated[key], ...errorStateUpdate[key]}; });
            return updated;
        });
        setIsFetchingModelData(false);
        return;
      }

      const experimentMeta = scanResults.experiments[selectedExperiment];
      if (!experimentMeta) {
        console.error(`Experiment metadata not found for ${selectedExperiment}`);
        const errorStateUpdate: Record<string, Partial<ModelExperimentState>> = {};
        selectedModels.forEach(modelName => {
            errorStateUpdate[modelName] = { isLoading: false, error: `Metadata for ${selectedExperiment} not found.`};
        });
        setExperimentDataByModel(prev => {
            const updated = {...prev};
            Object.keys(errorStateUpdate).forEach(key => { updated[key] = {...updated[key], ...errorStateUpdate[key]}; });
            return updated;
        });
        setIsFetchingModelData(false);
        return;
      }

      const currentModelDataUpdates: Record<string, Partial<ModelExperimentState>> = {}; 

      for (const modelName of selectedModels) {
        const modelFiles = experimentMeta.models[modelName];
        if (modelFiles && modelFiles.length > 0) {
          let fileToFetch = modelFiles.find(f => f.experimentType === selectedExperiment);
          if (!fileToFetch && selectedExperiment.startsWith('scoring')) {
            fileToFetch = modelFiles.find(f => f.experimentType.startsWith('scoring'));
          }
          if (!fileToFetch && selectedExperiment !== 'picking' && selectedExperiment !== 'all') { 
            const baseExperimentType = selectedExperiment.split('_')[0];
            if (baseExperimentType) {
                fileToFetch = modelFiles.find(f => f.experimentType.startsWith(baseExperimentType));
            }
          }
          if (!fileToFetch) {
            fileToFetch = modelFiles[0];
          }
          
          if (!fileToFetch) {
            currentModelDataUpdates[modelName] = { 
                isLoading: false, 
                error: `No suitable file found for ${selectedExperiment} and model ${modelName}.`,
            };
            continue; 
          }

          try {
            const apiUrl = `/api/get-experiment-data?filePath=${encodeURIComponent(fileToFetch.filePath)}`;
            const response = await fetch(apiUrl);

            if (!response.ok) {
              const errorData: ApiError = await response.json();
              throw new Error(errorData.error || `Failed to fetch data for ${modelName}`);
            }
            const rawData = await response.json();
            
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
            
            currentModelDataUpdates[modelName] = { 
                data: rawData, 
                processedPickingData: processedPickingDataForChart,
                scoringExperimentData: processedScoringData, 
                permutedOrderData: permutedOrderDataForViewer, 
                isolatedHolisticData: isolatedHolisticDataForViewer, 
                pairwiseEloData: pairwiseEloDataForViewer,
                isLoading: false, 
                error: null, 
                fileName: fileToFetch.fileName
            };
          } catch (e: any) {
            console.error(`Failed to fetch data for ${modelName}, ${fileToFetch.fileName}:`, e);
            currentModelDataUpdates[modelName] = { 
                data: null, 
                isLoading: false, 
                error: e.message || 'Unknown error', 
                fileName: fileToFetch.fileName 
            };
          }
        } else {
          currentModelDataUpdates[modelName] = { 
            isLoading: false, 
            error: 'No result file found for this model and experiment type.', 
          };
        }
      }
      setExperimentDataByModel(prev => {
        const updated = {...prev};
        Object.keys(currentModelDataUpdates).forEach(modelName => {
            updated[modelName] = {...updated[modelName], ...currentModelDataUpdates[modelName]};
        });
        return updated;
      });
      
      const finalModelStatesForAgg = { ...initialModelStates };
      Object.keys(initialModelStates).forEach(modelName => {
        if (currentModelDataUpdates[modelName]) {
          finalModelStatesForAgg[modelName] = { ...initialModelStates[modelName], ...currentModelDataUpdates[modelName] };
        } else {
          finalModelStatesForAgg[modelName] = { ...initialModelStates[modelName] }; // Keep initial loading state if no update occurred
        }
      });

      const modelDataForAgg: ModelDataStatesForAggregation = {};
      selectedModels.forEach(modelName => {
        const state = finalModelStatesForAgg[modelName]; 
        if (state && !state.isLoading && !state.error && state.data) { // Ensure data is not null
          if (selectedExperiment === 'picking') {
             modelDataForAgg[modelName] = {
                rawPickingData: state.data as PickingExperimentApiResponse, 
                processedPickingData: state.processedPickingData 
             };
          } else if (selectedExperiment.startsWith('scoring')) {
             modelDataForAgg[modelName] = {
                scoringExperimentData: state.scoringExperimentData
             };
          } else if (selectedExperiment.startsWith('pairwise_elo')) {
             modelDataForAgg[modelName] = {
                pairwiseEloData: state.pairwiseEloData
             };
          } else if (selectedExperiment.startsWith('adv_multi_criteria_permuted')) {
             modelDataForAgg[modelName] = {
                permutedOrderData: state.permutedOrderData
             };
          } else if (selectedExperiment.startsWith('adv_multi_criteria_isolated')) {
             modelDataForAgg[modelName] = {
                isolatedHolisticData: state.isolatedHolisticData
             };
          }
        }
      });

      if (selectedExperiment === 'picking') {
        const aggData = calculateAggregatedPickingData(modelDataForAgg, selectedModels);
        setAggregatedPickingSummary(aggData);
        setAggregatedScoringSummary(null); 
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
      } else if (selectedExperiment.startsWith('scoring')) { 
        const aggData = calculateAggregatedScoringData(modelDataForAgg, selectedModels);
        setAggregatedScoringSummary(aggData);
        setAggregatedPickingSummary(null); 
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
      } else if (selectedExperiment.startsWith('pairwise_elo')) {
        const aggData = calculateAggregatedEloData(modelDataForAgg, selectedModels);
        setAggregatedEloSummary(aggData);
        setAggregatedPickingSummary(null);
        setAggregatedScoringSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
      } else if (selectedExperiment.startsWith('adv_multi_criteria_permuted')) {
        const aggData = calculateAggregatedPermutedData(modelDataForAgg, selectedModels);
        setAggregatedPermutedSummary(aggData);
        setAggregatedPickingSummary(null); 
        setAggregatedScoringSummary(null);
        setAggregatedEloSummary(null);
        setAggregatedIsolatedSummary(null);
      } else if (selectedExperiment.startsWith('adv_multi_criteria_isolated')) {
        const aggData = calculateAggregatedIsolatedData(modelDataForAgg, selectedModels);
        setAggregatedIsolatedSummary(aggData);
        setAggregatedPickingSummary(null); 
        setAggregatedScoringSummary(null);
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
      } else {
        setAggregatedPickingSummary(null);
        setAggregatedScoringSummary(null);
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
      }

      setIsFetchingModelData(false);
    }

    fetchDataForSelections();
  }, [selectedExperiment, selectedModels, scanResults]);

  const handleExperimentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newExperimentType = e.target.value;
    setSelectedExperiment(newExperimentType);
    setSelectedModels([]); // Reset models when experiment changes
    setExperimentDataByModel({}); // Clear data when experiment changes
    setAggregatedPickingSummary(null); // Clear aggregated data
    setAggregatedScoringSummary(null); // Clear aggregated scoring data
    setAggregatedEloSummary(null); // Clear aggregated ELO data
    setAggregatedPermutedSummary(null);
    setAggregatedIsolatedSummary(null);
  };

  const handleModelToggle = (modelName: string) => {
    setSelectedModels(prev =>
      prev.includes(modelName)
        ? prev.filter(m => m !== modelName)
        : [...prev, modelName]
    );
  };
  
  // Determine available models based on the selected experiment type
  const availableModelsForSelectedExperiment = selectedExperiment && scanResults?.experiments[selectedExperiment]?.modelNames 
    ? scanResults.experiments[selectedExperiment].modelNames 
    : scanResults?.availableModels || []; // Fallback to all models if specific experiment list isn't there (shouldn't happen with new structure)

  if (isScanLoading) {
    return <div className="p-4 text-center">Loading experiment list...</div>;
  }
  if (scanError) {
    return <div className="p-4 text-red-500 text-center">Error: {scanError}</div>;
  }
  if (!scanResults || Object.keys(scanResults.experiments).length === 0) {
    return <div className="p-4 text-center">No experiment results found. Ensure <code>tmp_report_output</code> contains JSON files.</div>;
  }

  return (
    // Using p-4 font-sans for full width, removed container mx-auto
    <div className="p-4 font-sans">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-800">LLM Bias Experiment Viewer</h1>
        <p className="text-gray-600 mt-1">Select an experiment and models to view and compare results.</p>
        {scanResults.resultsDir && <p className="text-sm text-gray-500 mt-1">Reading from: <code>{scanResults.resultsDir}</code> directory (relative to project root)</p>}
      </header>

      {/* Control Section */}
      <div className="bg-gray-50 p-4 rounded-lg shadow mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label htmlFor="experiment-select" className="block text-sm font-medium text-gray-700 mb-1">
              Experiment Type:
            </label>
            <select
              id="experiment-select"
              value={selectedExperiment}
              onChange={handleExperimentChange}
              className="block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              <option value="" disabled={!!selectedExperiment}>Select an experiment</option>
              {Object.keys(scanResults.experiments).sort().map(expType => (
                <option key={expType} value={expType}>
                  {expType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} ({scanResults.experiments[expType].modelNames.length} models)
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Models to Compare: (Select at least one if experiment is chosen)
            </label>
            {selectedExperiment ? (
              availableModelsForSelectedExperiment.length > 0 ? (
                <div className="flex flex-wrap gap-2 p-2 border border-gray-200 rounded-md bg-white min-h-[40px]">
                  {availableModelsForSelectedExperiment.map(modelName => (
                    <button
                      key={modelName}
                      onClick={() => handleModelToggle(modelName)}
                      className={`px-3 py-1 text-sm rounded-full transition-colors duration-150 ease-in-out 
                        ${selectedModels.includes(modelName) 
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                      {modelName}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 p-2">No models available for this experiment type.</p>
              )
            ) : (
              <p className="text-sm text-gray-500 p-2">Select an experiment type to see available models.</p>
            )}
          </div>
        </div>
      </div>

      {/* Aggregated Data Display Area (Moved Above Individual Model Data) */}
      <div className='mb-8'>
        {!isFetchingModelData && aggregatedPickingSummary && selectedExperiment === 'picking' && selectedModels.length > 0 && (
          <CollapsibleSection title={`Aggregated Picking Summary (${aggregatedPickingSummary.overallModelCount} Models)`} defaultOpen={true}>
            <AggregatedPickingDisplay data={aggregatedPickingSummary} />
          </CollapsibleSection>
        )}

        {!isFetchingModelData && aggregatedScoringSummary && selectedExperiment.startsWith('scoring') && selectedModels.length > 0 && (
          <CollapsibleSection title={`Aggregated Scoring Summary (${aggregatedScoringSummary.overallModelCount} Models)`} defaultOpen={true}>
            <AggregatedScoringDisplay data={aggregatedScoringSummary} />
          </CollapsibleSection>
        )}

        {!isFetchingModelData && aggregatedEloSummary && selectedExperiment.startsWith('pairwise_elo') && selectedModels.length > 0 && (
           <CollapsibleSection title={`Aggregated Pairwise ELO Summary (${aggregatedEloSummary.overallModelCount} Models)`} defaultOpen={true}>
            <AggregatedEloDisplay data={aggregatedEloSummary} />
          </CollapsibleSection>
        )}

        {!isFetchingModelData && aggregatedPermutedSummary && selectedExperiment.startsWith('adv_multi_criteria_permuted') && selectedModels.length > 0 && (
           <CollapsibleSection title={`Aggregated Permuted Order Summary (${aggregatedPermutedSummary.overallModelCount} Models - Task: ${aggregatedPermutedSummary.taskName})`} defaultOpen={true}>
            <AggregatedAdvancedPermutedDisplay data={aggregatedPermutedSummary} />
          </CollapsibleSection>
        )}

        {!isFetchingModelData && aggregatedIsolatedSummary && selectedExperiment.startsWith('adv_multi_criteria_isolated') && selectedModels.length > 0 && (
           <CollapsibleSection title={`Aggregated Isolated vs. Holistic Summary (${aggregatedIsolatedSummary.overallModelCount} Models - Task: ${aggregatedIsolatedSummary.taskName})`} defaultOpen={true}>
            <AggregatedAdvancedIsolatedDisplay data={aggregatedIsolatedSummary} />
          </CollapsibleSection>
        )}
      </div>

      {/* Individual Model Data Display Area */}
      <div className={getDataDisplayGridClasses()}>
        {isFetchingModelData && (
            <div className={`${getFullSpanGridItemClasses()} text-center p-4`}>Loading data for selected models...</div>
        )}
        {!isFetchingModelData && selectedModels.length > 0 && selectedModels.map(modelName => {
          const modelDataState = experimentDataByModel[modelName];
          if (!modelDataState) return (
            <div key={modelName} className="text-center p-4 bg-white shadow rounded-lg">
              Preparing to load data for {modelName}...
            </div>
          );
          if (modelDataState.isLoading) return (
            <div key={modelName} className="text-center p-4 bg-white shadow rounded-lg">
              Loading data for {modelName}... (File: {modelDataState.fileName || 'Fetching...'})
            </div>
          );
          if (modelDataState.error) return (
            <div key={modelName} className="text-red-500 p-4 bg-white shadow rounded-lg">
              Error for {modelName}: {modelDataState.error} (File: {modelDataState.fileName || 'N/A'})
            </div>
          );
          
          // Check if any data is available for rendering
          const hasPickingDataForChart = selectedExperiment === 'picking' && modelDataState.processedPickingData && modelDataState.processedPickingData.length > 0;
          // Corrected condition to use fileToFetch.experimentType if available, or fallback to selectedExperiment
          const actualExperimentType = scanResults?.experiments[selectedExperiment]?.models[modelName]?.find(f => f.fileName === modelDataState.fileName)?.experimentType || selectedExperiment;
          const hasScoringData = actualExperimentType.startsWith('scoring') && modelDataState.scoringExperimentData && modelDataState.scoringExperimentData.length > 0;
          const hasPermutedOrderData = actualExperimentType.startsWith('adv_multi_criteria_permuted') && modelDataState.permutedOrderData && modelDataState.permutedOrderData.length > 0;
          const hasIsolatedHolisticData = actualExperimentType.startsWith('adv_multi_criteria_isolated') && modelDataState.isolatedHolisticData && modelDataState.isolatedHolisticData.length > 0;
          const hasPairwiseEloData = actualExperimentType.startsWith('pairwise_elo') && modelDataState.pairwiseEloData && modelDataState.pairwiseEloData.variants_summary && modelDataState.pairwiseEloData.variants_summary.length > 0; // New check
          const hasRawDataForJsonViewer = modelDataState.data;

          if (!hasPickingDataForChart && !hasScoringData && !hasPermutedOrderData && !hasIsolatedHolisticData && !hasPairwiseEloData && !hasRawDataForJsonViewer) {
            return (
              <div key={modelName} className="text-gray-500 p-4 bg-white shadow rounded-lg">
                No data loaded or processed for {modelName} (File: {modelDataState.fileName || 'N/A'}).
              </div>
            );
          }

          return (
            <section key={modelName} className="bg-white p-4 shadow rounded-lg">
              <h2 className="text-xl font-semibold text-gray-700 mb-3">
                Results for Model: <span className="font-bold text-indigo-700">{modelName}</span>
              </h2>
              <p className="text-xs text-gray-500 mb-3">Source file: {modelDataState.fileName}</p>
              
              {/* Logic for displaying PickingExperimentCharts */}
              {hasPickingDataForChart && (
                <PickingExperimentCharts 
                  processedData={modelDataState.processedPickingData!} 
                  modelName={modelName} 
                />
              )}
              
              {/* Placeholder for ScoringExperimentViewer */}
              {hasScoringData && (
                <ScoringExperimentViewer data={modelDataState.scoringExperimentData!} modelName={modelName} />
              )}

              {hasPermutedOrderData && (
                <AdvancedPermutedOrderViewer data={modelDataState.permutedOrderData!} modelName={modelName} />
              )}

              {hasIsolatedHolisticData && (
                <AdvancedIsolatedHolisticViewer data={modelDataState.isolatedHolisticData!} modelName={modelName} />
              )}

              {/* Placeholder for PairwiseEloViewer - to be created */}
              {hasPairwiseEloData && (
                <PairwiseEloViewer data={modelDataState.pairwiseEloData!} modelName={modelName} />
              )}

              {/* Fallback to JsonViewer if no specific component handles the data, but raw data exists */}
              {!hasPickingDataForChart && !hasScoringData && !hasPermutedOrderData && !hasIsolatedHolisticData && !hasPairwiseEloData && hasRawDataForJsonViewer && (
                 <JsonViewer data={modelDataState.data} />
              )}
              
              {/* Message if picking data was expected but empty */}
              {selectedExperiment === 'picking' && modelDataState.processedPickingData && modelDataState.processedPickingData.length === 0 && (
                <div className="text-gray-500 p-4">No processable picking data found for charts for {modelName}. Raw JSON might be shown if available and no other viewers active.</div>
              )}
              {/* Message if scoring data was expected but empty */}
              {selectedExperiment.startsWith('scoring') && modelDataState.scoringExperimentData && modelDataState.scoringExperimentData.length === 0 && (
                 <div className="text-gray-500 p-4">No processable scoring data found for {modelName}. Raw JSON might be shown if available and no other viewers active.</div>
              )}
              {actualExperimentType.startsWith('adv_multi_criteria_permuted') && modelDataState.permutedOrderData && modelDataState.permutedOrderData.length === 0 && (
                 <div className="text-gray-500 p-4">No processable permuted order data found for {modelName}. Raw JSON might be shown if available.</div>
              )}
              {actualExperimentType.startsWith('adv_multi_criteria_isolated') && modelDataState.isolatedHolisticData && modelDataState.isolatedHolisticData.length === 0 && (
                 <div className="text-gray-500 p-4">No processable isolated/holistic data found for {modelName}. Raw JSON might be shown if available.</div>
              )}
              {actualExperimentType.startsWith('pairwise_elo') && modelDataState.pairwiseEloData && (!modelDataState.pairwiseEloData.variants_summary || modelDataState.pairwiseEloData.variants_summary.length === 0) && (
                <div className="text-gray-500 p-4">No processable Pairwise ELO data found for {modelName}. Raw JSON might be shown if available.</div>
              )}
            </section>
          );
        })}
        {!isFetchingModelData && selectedModels.length === 0 && selectedExperiment && (
          <div className={`${getFullSpanGridItemClasses()} text-center text-gray-500 p-4`}>Select one or more models to view their results for the '{selectedExperiment.replace(/_/g, ' ')}' experiment.</div>
        )}
      </div>

    </div> // End container
  );
}

