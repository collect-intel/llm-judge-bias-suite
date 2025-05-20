// File: viewer/src/components/ScoringSamplesDisplay.tsx
import React from 'react';
import { ScoringExperimentData, ScoringVariantResult, ScoringItemResult } from '@/types/scoringExperiment'; // Adjust path if necessary

interface ScoringSamplesDisplayProps {
  // rawData is an array of ScoringVariantResult
  rawData: ScoringExperimentData; 
  modelName: string;
}

const ScoringSamplesDisplay: React.FC<ScoringSamplesDisplayProps> = ({ rawData, modelName }) => {
  if (!rawData || rawData.length === 0) {
    return <p className="text-sm text-gray-500">No scoring experiment data available to display samples for {modelName}.</p>;
  }

  const MAX_VARIANTS_TO_SAMPLE = 3; // Max variants to show samples from
  const MAX_ITEMS_PER_VARIANT_TO_SAMPLE = 2; // Max items per variant to show samples from

  return (
    <div className="mt-4 space-y-6">
      {rawData.slice(0, MAX_VARIANTS_TO_SAMPLE).map((variantResult, variantIndex) => (
        <div key={`${modelName}-variant-${variantIndex}-${variantResult.variant_config.name}`} className="p-3 border border-gray-200 rounded-md bg-gray-50">
          <h4 className="text-md font-semibold text-gray-700 mb-2">
            Variant: <span className="font-normal text-indigo-600">{variantResult.variant_config.name}</span>
          </h4>
          
          {(!variantResult.detailed_item_results || variantResult.detailed_item_results.length === 0) && (
            <p className="text-xs text-gray-400">No detailed items in this variant to sample.</p>
          )}

          {variantResult.detailed_item_results && variantResult.detailed_item_results.slice(0, MAX_ITEMS_PER_VARIANT_TO_SAMPLE).map((itemResult, itemIndex) => (
            <div key={`${modelName}-variant-${variantIndex}-item-${itemResult.item_id}-${itemIndex}`} className="mt-2 p-2 border-t border-gray-200">
              <p className="text-sm font-medium text-gray-600">
                Sample Item ID: {itemResult.item_id} 
                {itemResult.item_title && ` (${itemResult.item_title})`}
                {itemResult.dataset_name && <span className="text-xs text-gray-500"> from {itemResult.dataset_name}</span>}
              </p>
              <p className="text-xs text-gray-500 truncate mb-1">
                Text Snippet: <span className="italic">&quot;{itemResult.item_text_snippet}...&quot;</span>
              </p>

              {itemResult.actual_prompt_sent_to_llm ? (
                <details className="text-xs mt-1">
                  <summary className="cursor-pointer hover:text-indigo-500">View Prompt</summary>
                  <pre className="mt-1 p-2 bg-white border border-gray-300 rounded text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-60">
                    {itemResult.actual_prompt_sent_to_llm}
                  </pre>
                </details>
              ) : <p className="text-xs text-gray-400 italic">No prompt available for this item.</p>}
              
              {itemResult.sampled_llm_raw_responses && itemResult.sampled_llm_raw_responses.length > 0 ? (
                <details className="text-xs mt-1">
                  <summary className="cursor-pointer hover:text-indigo-500">
                    View Sampled Responses (up to {itemResult.sampled_llm_raw_responses.length})
                  </summary>
                  {itemResult.sampled_llm_raw_responses.map((resp, respIndex) => (
                    <div key={`item-${itemIndex}-resp-${respIndex}`} className="mt-1">
                       <span className="text-xs font-medium text-gray-500">Rep {respIndex + 1}:</span>
                      <pre className="p-1 bg-white border border-gray-300 rounded text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-28">
                        {resp || "[Empty Response]"}
                      </pre>
                    </div>
                  ))}
                </details>
              ) : (
                <p className="text-xs text-gray-400 italic mt-1">No sampled responses available for this item.</p>
              )}
            </div>
          ))}
          {variantResult.detailed_item_results && variantResult.detailed_item_results.length > MAX_ITEMS_PER_VARIANT_TO_SAMPLE && (
             <p className="text-xs text-center text-gray-500 mt-2">
                Showing samples from the first {MAX_ITEMS_PER_VARIANT_TO_SAMPLE} items in this variant.
             </p>
          )}
        </div>
      ))}
      {rawData.length > MAX_VARIANTS_TO_SAMPLE && (
        <p className="text-xs text-center text-gray-500 mt-2">
          Showing samples from the first {MAX_VARIANTS_TO_SAMPLE} variants. Full data in JSON.
        </p>
      )}
    </div>
  );
};

export default ScoringSamplesDisplay;