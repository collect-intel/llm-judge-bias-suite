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
import { PairwiseEloExperimentDataWrapper, EloItemVariantSummary } from '@/types/pairwiseEloExperiment'; // Added EloItemVariantSummary
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

// Import the new ClassificationExperimentViewer component
import ClassificationExperimentViewer from '@/components/ClassificationExperimentViewer';

// Import for Classification Aggregation
import { AggregatedClassificationOverallSummary } from '@/types/aggregatedClassification';

// Import the new display component for aggregated classification data
import AggregatedClassificationDisplay from '@/components/AggregatedClassificationDisplay';

// Import aggregation calculators
import {
  calculateAggregatedPickingData,
  calculateAggregatedScoringData,
  calculateAggregatedEloData,
  calculateAggregatedPermutedData,
  calculateAggregatedIsolatedData,
  calculateAggregatedClassificationData,
  ModelDataStatesForAggregation
} from '@/utils/aggregationCalculators';

// Import the new crossover score calculator
import { calculateCrossoverScoreForEloSet } from '@/utils/eloCrossoverCalculator';

// Import classification types
import { ClassificationExperimentData } from '@/types/classificationExperiment';

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
  pairwiseEloData?: PairwiseEloExperimentDataWrapper[] | null; 
  classificationExperimentData?: ClassificationExperimentData | null; // Added for classification
  crossoverScore?: number; // ADDED: For Pairwise ELO model stability ranking
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
  // Use a unique ID for a details element if needed for direct manipulation, but usually not required.
  return (
    <details className='mt-6 bg-white shadow-md rounded-lg overflow-hidden group' open={defaultOpen}>
      <summary className='px-4 py-3 bg-gray-100 hover:bg-gray-200 cursor-pointer font-semibold text-gray-700 text-lg flex justify-between items-center'>
        {title}
        <span className='text-sm text-gray-500 group-open:rotate-90 transition-transform duration-150'>▼</span>
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
  scheme_display_label1: string; // The text of the first label option, e.g. "(A)" or "ID_alpha"
  scheme_display_label2: string; // The text of the second label option, e.g. "(B)" or "ID_beta"
  total_pairs_tested_in_scheme: number;
  repetitions_per_order_run: number; // Used by calculator, and now by transform function
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
    // Calculate avgFirstSlotPreferenceForScheme from raw pair data
    let totalFirstSlotPicksAcrossPairs = 0;
    let totalDecisionsAcrossPairs = 0;
    // let validPairsForAvgCalc = 0; // Not strictly needed for the calculation if we sum all decisions

    schemeResult.pairs_summary_for_scheme.forEach(pair => {
      // In Run 1, the content identified by "text_A" from the original PICKING_PAIRS is in the first slot.
      const picksForContentInSlot1Run1 = pair.run1_pick_distribution["text_A"] || 0;
      const totalPicksRun1 = Object.values(pair.run1_pick_distribution).reduce((s, c) => s + c, 0);

      // In Run 2, the content identified by "text_B" from the original PICKING_PAIRS is in the first slot.
      const picksForContentInSlot1Run2 = pair.run2_pick_distribution["text_B"] || 0;
      const totalPicksRun2 = Object.values(pair.run2_pick_distribution).reduce((s, c) => s + c, 0);

      if (totalPicksRun1 > 0 || totalPicksRun2 > 0) { // Only include pairs with actual decisions
        totalFirstSlotPicksAcrossPairs += (picksForContentInSlot1Run1 + picksForContentInSlot1Run2);
        totalDecisionsAcrossPairs += (totalPicksRun1 + totalPicksRun2);
        // validPairsForAvgCalc++; // Not strictly needed for the calculation
      }
    });

    const avgFirstSlotPreference = totalDecisionsAcrossPairs > 0 
      ? (totalFirstSlotPicksAcrossPairs / totalDecisionsAcrossPairs) * 100 
      : 0; 

    return {
      variantName: schemeResult.variant_name,
      labelingSchemeName: schemeResult.labeling_scheme_name,
      schemeDescription: schemeResult.scheme_description,
      schemeDisplayLabel1: schemeResult.scheme_display_label1,
      schemeDisplayLabel2: schemeResult.scheme_display_label2,
      
      avgFirstSlotPreferenceForScheme: avgFirstSlotPreference,
      repetitionsPerOrderRun: schemeResult.repetitions_per_order_run,
      // All consensus-based metrics previously passed through are now removed
    };
  });
};

// --- Helper types for Python ELO output ---
interface PythonEloFinalRankingItem {
  id: string;
  text_snippet: string;
  elo: number;
  W: number;
  L: number;
  T: number;
}

interface PythonEloVariantSummary {
  variant_name: string;
  system_prompt_used: string;
  user_prompt_template_used: string;
  allow_tie_enabled: boolean;
  parse_function_used: string;
  temperature_setting: number;
  final_rankings: PythonEloFinalRankingItem[];
  detailed_pair_results: any[]; // Can be more specific if needed
}

interface PythonEloRankingSetSummary {
  ranking_set_id: string;
  criterion: string;
  item_count: number;
  variants_summary: PythonEloVariantSummary[];
}
// --- End Helper types for Python ELO output ---

// --- Transformation function for Pairwise ELO data ---
const transformEloJsonToViewerData = (
  pythonOutput: PythonEloRankingSetSummary[] | null
): PairwiseEloExperimentDataWrapper[] => {
  if (!pythonOutput || !Array.isArray(pythonOutput)) {
    return [];
  }

  const transformedViewerData: PairwiseEloExperimentDataWrapper[] = [];

  for (const rankingSet of pythonOutput) {
    if (!rankingSet || typeof rankingSet !== 'object' || !Array.isArray(rankingSet.variants_summary)) {
      console.warn("Skipping invalid ranking set in ELO data:", rankingSet);
      continue;
    }

    const flattenedItems: EloItemVariantSummary[] = [];
    rankingSet.variants_summary.forEach((variant: PythonEloVariantSummary) => {
      if (variant && typeof variant === 'object' && Array.isArray(variant.final_rankings)) {
        variant.final_rankings.forEach((item: PythonEloFinalRankingItem, index: number) => {
          flattenedItems.push({
            variant_name: variant.variant_name,
            rank: index + 1, // Rank is 1-based from order in array
            item_id: item.id,
            elo_rating: item.elo,
            wins: item.W,
            losses: item.L,
            ties: item.T,
            item_text_snippet: item.text_snippet,
          });
        });
      }
    });

    transformedViewerData.push({
      criterion: rankingSet.criterion,
      ranking_set_id: rankingSet.ranking_set_id,
      variants_summary: flattenedItems,
    });
  }
  return transformedViewerData;
};
// --- End Transformation function for Pairwise ELO data ---


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
  const [aggregatedClassificationSummary, setAggregatedClassificationSummary] = useState<AggregatedClassificationOverallSummary | null>(null);

  // --- Helper functions for dynamic grid classes ---
  const numSelectedModels = selectedModels.length;

  const getDataDisplayGridClasses = () => {
    if (numSelectedModels <= 1) { // 0 or 1 model
      return "grid grid-cols-1 gap-8";
    } else if (numSelectedModels === 2) { // 2 models
      return "grid grid-cols-1 sm:grid-cols-2 gap-8"; // 1 col default, 2 on sm+
    } else if (numSelectedModels === 3) { // 3 models
      return "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8"; // 1 default, 2 on sm, 3 on md+
    } else { // numSelectedModels >= 4
      return "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8"; // 1 default, 2 on sm, 3 on md, 4 on lg+
    }
  };

  const getFullSpanGridItemClasses = () => {
    // For items that should span all columns within the dynamic grid
    if (numSelectedModels <= 1) {
      return "col-span-1";
    } else if (numSelectedModels === 2) {
      // Grid is: grid-cols-1 sm:grid-cols-2
      return "col-span-1 sm:col-span-2";
    } else if (numSelectedModels === 3) {
      // Grid is: grid-cols-1 sm:grid-cols-2 md:grid-cols-3
      return "col-span-1 sm:col-span-2 md:col-span-3";
    } else { // numSelectedModels >= 4
      // Grid is: grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4
      return "col-span-1 sm:col-span-2 md:col-span-3 lg:col-span-4";
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
      setAggregatedClassificationSummary(null);
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
            pairwiseEloData: null, // Initial state is null
            classificationExperimentData: null, // Initialize classification data
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
          if (!fileToFetch && selectedExperiment === 'classification') {
            fileToFetch = modelFiles.find(f => f.experimentType.startsWith('classification'));
          } else if (!fileToFetch && selectedExperiment.startsWith('scoring')) {
            fileToFetch = modelFiles.find(f => f.experimentType.startsWith('scoring'));
          }
          if (!fileToFetch && selectedExperiment !== 'picking' && selectedExperiment !== 'all' && !selectedExperiment.startsWith('scoring') && selectedExperiment !== 'classification') { 
            const baseExperimentType = selectedExperiment.split('_')[0];
            if (baseExperimentType) {
                fileToFetch = modelFiles.find(f => f.experimentType.startsWith(baseExperimentType));
            }
          }
          if (!fileToFetch) { // Fallback if specific type like 'pairwise_elo_set_1_haikus' not found
            const baseExperimentType = selectedExperiment.split('_')[0]; // e.g., 'pairwise_elo'
            fileToFetch = modelFiles.find(f => f.experimentType.startsWith(baseExperimentType));
          }

          if (!fileToFetch) { // If still no file after broader search
            fileToFetch = modelFiles[0]; // Last resort: take the first file for that model
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
            let pairwiseEloDataForViewer: PairwiseEloExperimentDataWrapper[] | undefined = undefined;
            let classificationDataForViewer: ClassificationExperimentData | undefined = undefined;
            let modelCrossoverScore: number | undefined = undefined; // ADDED: Variable to hold calculated score

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
              pairwiseEloDataForViewer = transformEloJsonToViewerData(rawData as PythonEloRankingSetSummary[]);
              // Calculate crossover score for the first ELO set, if available
              if (pairwiseEloDataForViewer && pairwiseEloDataForViewer.length > 0) {
                modelCrossoverScore = calculateCrossoverScoreForEloSet(pairwiseEloDataForViewer[0]);
              }
            } else if (actualExperimentTypeFromFile.startsWith('classification')) { 
              classificationDataForViewer = rawData as ClassificationExperimentData;
            }
            
            currentModelDataUpdates[modelName] = { 
                data: rawData, 
                processedPickingData: processedPickingDataForChart,
                scoringExperimentData: processedScoringData, 
                permutedOrderData: permutedOrderDataForViewer, 
                isolatedHolisticData: isolatedHolisticDataForViewer, 
                pairwiseEloData: pairwiseEloDataForViewer, 
                classificationExperimentData: classificationDataForViewer, 
                crossoverScore: modelCrossoverScore, // ADDED: Store the calculated score
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
          finalModelStatesForAgg[modelName] = { ...initialModelStates[modelName] };
        }
      });

      const modelDataForAgg: ModelDataStatesForAggregation = {};
      selectedModels.forEach(modelName => {
        const state = finalModelStatesForAgg[modelName]; 
        if (state && !state.isLoading && !state.error && state.data) {
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
                // Aggregation expects single PairwiseEloExperimentDataWrapper, pass first set if array exists
                pairwiseEloData: (state.pairwiseEloData && state.pairwiseEloData.length > 0) ? state.pairwiseEloData[0] : null
             };
          } else if (selectedExperiment.startsWith('adv_multi_criteria_permuted')) {
             modelDataForAgg[modelName] = {
                permutedOrderData: state.permutedOrderData
             };
          } else if (selectedExperiment.startsWith('adv_multi_criteria_isolated')) {
             modelDataForAgg[modelName] = {
                isolatedHolisticData: state.isolatedHolisticData
             };
          } else if (selectedExperiment === 'classification') {
             modelDataForAgg[modelName] = {
                classificationExperimentData: state.classificationExperimentData
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
        setAggregatedClassificationSummary(null);
      } else if (selectedExperiment.startsWith('scoring')) { 
        const aggData = calculateAggregatedScoringData(modelDataForAgg, selectedModels);
        setAggregatedScoringSummary(aggData);
        setAggregatedPickingSummary(null); 
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
        setAggregatedClassificationSummary(null);
      } else if (selectedExperiment.startsWith('pairwise_elo')) {
        const aggData = calculateAggregatedEloData(modelDataForAgg, selectedModels);
        setAggregatedEloSummary(aggData);
        setAggregatedPickingSummary(null);
        setAggregatedScoringSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
        setAggregatedClassificationSummary(null);
      } else if (selectedExperiment.startsWith('adv_multi_criteria_permuted')) {
        const aggData = calculateAggregatedPermutedData(modelDataForAgg, selectedModels);
        setAggregatedPermutedSummary(aggData);
        setAggregatedPickingSummary(null); 
        setAggregatedScoringSummary(null);
        setAggregatedEloSummary(null);
        setAggregatedIsolatedSummary(null);
        setAggregatedClassificationSummary(null);
      } else if (selectedExperiment.startsWith('adv_multi_criteria_isolated')) {
        const aggData = calculateAggregatedIsolatedData(modelDataForAgg, selectedModels);
        setAggregatedIsolatedSummary(aggData);
        setAggregatedPickingSummary(null); 
        setAggregatedScoringSummary(null);
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedClassificationSummary(null);
      } else if (selectedExperiment === 'classification') {
        const aggData = calculateAggregatedClassificationData(modelDataForAgg, selectedModels);
        setAggregatedClassificationSummary(aggData);
        setAggregatedPickingSummary(null);
        setAggregatedScoringSummary(null);
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
      } else {
        setAggregatedPickingSummary(null);
        setAggregatedScoringSummary(null);
        setAggregatedEloSummary(null);
        setAggregatedPermutedSummary(null);
        setAggregatedIsolatedSummary(null);
        setAggregatedClassificationSummary(null);
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
    setAggregatedClassificationSummary(null);
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

  // Prepare data for Model Crossover Ranking in AggregatedEloDisplay
  const modelCrossoverRankingsData = selectedModels.reduce((acc, modelName) => {
    const modelState = experimentDataByModel[modelName];
    if (modelState && modelState.crossoverScore !== undefined && selectedExperiment.startsWith('pairwise_elo')) {
       // Ensure we only pass this for ELO experiments. 
       // `selectedExperiment` might not be the best here, selectedExperiment is better.
       // Let's refine this logic when rendering AggregatedEloDisplay instead of here.
      acc.push({
        modelName: modelName,
        crossoverScore: modelState.crossoverScore,
      });
    }
    return acc;
  }, [] as Array<{ modelName: string; crossoverScore: number }>);

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
        <h1 className="text-3xl font-bold text-gray-800">LLM-Judge Bias Results</h1>
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
                  {/* sorted by any containing OLD go last, and otherwise alphabetically */}
                  {availableModelsForSelectedExperiment.sort((a, b) => {
                    if (a.includes('_old') && !b.includes('_old')) return 1;
                    if (!a.includes('_old') && b.includes('_old')) return -1;
                    return a.localeCompare(b);
                  }).map(modelName => (
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
            <AggregatedEloDisplay 
              data={aggregatedEloSummary} 
              modelCrossoverScores={selectedModels.map(modelName => ({
                modelName,
                crossoverScore: experimentDataByModel[modelName]?.crossoverScore
              })).filter(item => item.crossoverScore !== undefined) as Array<{ modelName: string; crossoverScore: number }>} 
            />
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

        {/* Added Aggregated Classification Display */}
        {!isFetchingModelData && aggregatedClassificationSummary && selectedExperiment === 'classification' && selectedModels.length > 0 && (
          <CollapsibleSection title={`Aggregated Classification Summary (${aggregatedClassificationSummary.overallModelCount} Models)`} defaultOpen={true}>
            <AggregatedClassificationDisplay data={aggregatedClassificationSummary} />
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
              Loading data for {modelName}... (File: {modelDataState.fileName || 'Fetching...'}) (CS: {modelDataState.crossoverScore})
            </div>
          );
          if (modelDataState.error) return (
            <div key={modelName} className="text-red-500 p-4 bg-white shadow rounded-lg">
              Error for {modelName}: {modelDataState.error} (File: {modelDataState.fileName || 'N/A'})
            </div>
          );
          
          const actualExperimentType = scanResults?.experiments[selectedExperiment]?.models[modelName]?.find(f => f.fileName === modelDataState.fileName)?.experimentType || selectedExperiment;
          
          const hasPickingDataForChart = actualExperimentType === 'picking' && modelDataState.processedPickingData && modelDataState.processedPickingData.length > 0;
          const hasScoringData = actualExperimentType.startsWith('scoring') && modelDataState.scoringExperimentData && modelDataState.scoringExperimentData.length > 0;
          const hasPermutedOrderData = actualExperimentType.startsWith('adv_multi_criteria_permuted') && modelDataState.permutedOrderData && modelDataState.permutedOrderData.length > 0;
          const hasIsolatedHolisticData = actualExperimentType.startsWith('adv_multi_criteria_isolated') && modelDataState.isolatedHolisticData && modelDataState.isolatedHolisticData.length > 0;
          const hasPairwiseEloData = actualExperimentType.startsWith('pairwise_elo') && 
                               modelDataState.pairwiseEloData && 
                               Array.isArray(modelDataState.pairwiseEloData) && 
                               modelDataState.pairwiseEloData.length > 0 &&
                               modelDataState.pairwiseEloData.some(set => set.variants_summary.length > 0);
          const hasClassificationData = actualExperimentType.startsWith('classification') && modelDataState.classificationExperimentData && modelDataState.classificationExperimentData.length > 0;
          const hasRawDataForJsonViewer = modelDataState.data;

          if (!hasPickingDataForChart && !hasScoringData && !hasPermutedOrderData && !hasIsolatedHolisticData && !hasPairwiseEloData && !hasClassificationData && !hasRawDataForJsonViewer) {
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
              
              {hasPickingDataForChart && (
                <PickingExperimentCharts 
                  processedData={modelDataState.processedPickingData!} 
                  modelName={modelName} 
                />
              )}
              
              {hasScoringData && (
                <ScoringExperimentViewer data={modelDataState.scoringExperimentData!} modelName={modelName} />
              )}

              {hasPermutedOrderData && (
                <AdvancedPermutedOrderViewer data={modelDataState.permutedOrderData!} modelName={modelName} />
              )}

              {hasIsolatedHolisticData && (
                <AdvancedIsolatedHolisticViewer data={modelDataState.isolatedHolisticData!} modelName={modelName} />
              )}

              {hasPairwiseEloData && modelDataState.pairwiseEloData!.map((eloSetData, index) => (
                <CollapsibleSection 
                  key={`${modelName}-elo-set-${index}-${eloSetData.ranking_set_id}`} 
                  title={`Pairwise ELO: ${eloSetData.ranking_set_id} (Criterion: ${eloSetData.criterion})`}
                  defaultOpen={index === 0} // Open the first ELO set by default
                >
                  <PairwiseEloViewer data={eloSetData} modelName={modelName} />
                </CollapsibleSection>
              ))}

              {/* Render Classification Viewer */}
              {hasClassificationData && (
                <ClassificationExperimentViewer 
                  data={modelDataState.classificationExperimentData!} 
                  modelName={modelName} 
                />
              )}
              
              {/* Fallback to JsonViewer if no specific component handles the data, but raw data exists */}
              {!hasPickingDataForChart && 
               !hasScoringData && 
               !hasPermutedOrderData && 
               !hasIsolatedHolisticData && 
               !hasPairwiseEloData &&
               !hasClassificationData &&
               hasRawDataForJsonViewer && (
                 <JsonViewer data={modelDataState.data} />
              )}
              
              {actualExperimentType === 'picking' && (!modelDataState.processedPickingData || modelDataState.processedPickingData.length === 0) && modelDataState.data && (
                <div className="text-gray-500 p-4">No processable picking data found for charts for {modelName}. Raw JSON might be shown if available and no other viewers active.</div>
              )}
              {actualExperimentType.startsWith('scoring') && (!modelDataState.scoringExperimentData || modelDataState.scoringExperimentData.length === 0) && modelDataState.data && (
                 <div className="text-gray-500 p-4">No processable scoring data found for {modelName}. Raw JSON might be shown if available and no other viewers active.</div>
              )}
              {actualExperimentType.startsWith('adv_multi_criteria_permuted') && (!modelDataState.permutedOrderData || modelDataState.permutedOrderData.length === 0) && modelDataState.data && (
                 <div className="text-gray-500 p-4">No processable permuted order data found for {modelName}. Raw JSON might be shown if available.</div>
              )}
              {actualExperimentType.startsWith('adv_multi_criteria_isolated') && (!modelDataState.isolatedHolisticData || modelDataState.isolatedHolisticData.length === 0) && modelDataState.data && (
                 <div className="text-gray-500 p-4">No processable isolated/holistic data found for {modelName}. Raw JSON might be shown if available.</div>
              )}
              {/* Updated Warning for ELO */}
              {actualExperimentType.startsWith('pairwise_elo') && 
               !hasPairwiseEloData && 
               modelDataState.data && (
                <div className="text-gray-500 p-4">No processable Pairwise ELO data found for {modelName}. Raw JSON might be shown if available.</div>
              )}
              {/* Added Warning for Classification */}
              {actualExperimentType.startsWith('classification') && 
               !hasClassificationData && 
               modelDataState.data && (
                <div className="text-gray-500 p-4">No processable Classification data found for {modelName}. Raw JSON might be shown if available.</div>
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

