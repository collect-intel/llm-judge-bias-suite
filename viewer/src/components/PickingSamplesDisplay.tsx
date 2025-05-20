// File: viewer/src/components/PickingSamplesDisplay.tsx
import React from 'react';

// Assuming PickingExperimentSchemeResult and PickingPairDetail are defined elsewhere
// and imported if this were a real multi-file setup.
// For now, let's redefine simplified versions here for clarity if needed,
// or assume they are globally available/passed correctly in page.tsx context.

interface SampledInteraction {
  prompt_sent_to_llm: string | null;
  sampled_llm_raw_responses: string[];
}

interface PickingPairDetail {
  pair_id: string;
  question: string;
  run1_sampled_interactions?: SampledInteraction | null;
  run2_sampled_interactions?: SampledInteraction | null;
  // ... other fields from PickingPairDetail if needed for context, but focusing on samples
}

interface PickingExperimentSchemeResult {
  variant_name: string;
  labeling_scheme_name: string;
  pairs_summary_for_scheme: PickingPairDetail[];
  // ... other fields
}

type PickingExperimentApiResponse = PickingExperimentSchemeResult[];

interface PickingSamplesDisplayProps {
  rawData: PickingExperimentApiResponse; // This is PickingExperimentSchemeResult[]
  modelName: string; // To provide context
}

const PickingSamplesDisplay: React.FC<PickingSamplesDisplayProps> = ({ rawData, modelName }) => {
  if (!rawData || rawData.length === 0) {
    return <p className="text-sm text-gray-500">No picking experiment data available to display samples for {modelName}.</p>;
  }

  const MAX_SCHEMES_TO_SAMPLE = 2;
  const MAX_PAIRS_PER_SCHEME_TO_SAMPLE = 2;

  return (
    <div className="mt-4 space-y-6">
      {rawData.slice(0, MAX_SCHEMES_TO_SAMPLE).map((schemeResult, schemeIndex) => (
        <div key={`${modelName}-scheme-${schemeIndex}`} className="p-3 border border-gray-200 rounded-md bg-gray-50">
          <h4 className="text-md font-semibold text-gray-700 mb-2">
            Variant: <span className="font-normal text-indigo-600">{schemeResult.variant_name}</span> / 
            Scheme: <span className="font-normal text-indigo-600">{schemeResult.labeling_scheme_name}</span>
          </h4>
          
          {schemeResult.pairs_summary_for_scheme.length === 0 && (
            <p className="text-xs text-gray-400">No pair summaries in this scheme to sample.</p>
          )}

          {schemeResult.pairs_summary_for_scheme.slice(0, MAX_PAIRS_PER_SCHEME_TO_SAMPLE).map((pair, pairIndex) => (
            <div key={`${modelName}-scheme-${schemeIndex}-pair-${pair.pair_id}-${pairIndex}`} className="mt-2 p-2 border-t border-gray-200">
              <p className="text-sm font-medium text-gray-600">
                Sample Pair ID: {pair.pair_id} (Question: <span className="font-normal italic">&quot;{pair.question}&quot;</span>)
              </p>

              {/* Run 1 Samples */}
              {pair.run1_sampled_interactions && (
                <div className="mt-1 pl-2">
                  <p className="text-xs font-semibold text-gray-500 underline">Run 1 Interactions:</p>
                  {pair.run1_sampled_interactions.prompt_sent_to_llm ? (
                    <details className="text-xs mt-1">
                      <summary className="cursor-pointer hover:text-indigo-500">View Prompt (Run 1)</summary>
                      <pre className="mt-1 p-2 bg-white border border-gray-300 rounded text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-40">
                        {pair.run1_sampled_interactions.prompt_sent_to_llm}
                      </pre>
                    </details>
                  ) : <p className="text-xs text-gray-400 italic">No prompt available for Run 1.</p>}
                  
                  {pair.run1_sampled_interactions.sampled_llm_raw_responses && pair.run1_sampled_interactions.sampled_llm_raw_responses.length > 0 && (
                    <details className="text-xs mt-1">
                      <summary className="cursor-pointer hover:text-indigo-500">View Sampled Responses (Run 1 - up to {pair.run1_sampled_interactions.sampled_llm_raw_responses.length})</summary>
                      {pair.run1_sampled_interactions.sampled_llm_raw_responses.map((resp, respIndex) => (
                        <pre key={`r1-resp-${respIndex}`} className="mt-1 p-1 bg-white border border-gray-300 rounded text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-28">
                          {resp || "[Empty Response]"}
                        </pre>
                      ))}
                    </details>
                  )}
                </div>
              )}

              {/* Run 2 Samples */}
              {pair.run2_sampled_interactions && (
                <div className="mt-2 pl-2">
                  <p className="text-xs font-semibold text-gray-500 underline">Run 2 Interactions:</p>
                   {pair.run2_sampled_interactions.prompt_sent_to_llm ? (
                    <details className="text-xs mt-1">
                      <summary className="cursor-pointer hover:text-indigo-500">View Prompt (Run 2)</summary>
                      <pre className="mt-1 p-2 bg-white border border-gray-300 rounded text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-40">
                        {pair.run2_sampled_interactions.prompt_sent_to_llm}
                      </pre>
                    </details>
                  ) : <p className="text-xs text-gray-400 italic">No prompt available for Run 2.</p>}

                  {pair.run2_sampled_interactions.sampled_llm_raw_responses && pair.run2_sampled_interactions.sampled_llm_raw_responses.length > 0 && (
                     <details className="text-xs mt-1">
                      <summary className="cursor-pointer hover:text-indigo-500">View Sampled Responses (Run 2 - up to {pair.run2_sampled_interactions.sampled_llm_raw_responses.length})</summary>
                      {pair.run2_sampled_interactions.sampled_llm_raw_responses.map((resp, respIndex) => (
                        <pre key={`r2-resp-${respIndex}`} className="mt-1 p-1 bg-white border border-gray-300 rounded text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-28">
                          {resp || "[Empty Response]"}
                        </pre>
                      ))}
                    </details>
                  )}
                </div>
              )}
              {!pair.run1_sampled_interactions && !pair.run2_sampled_interactions && (
                <p className="text-xs text-gray-400 italic mt-1 pl-2">No sampled interactions available for this pair.</p>
              )}
            </div>
          ))}
        </div>
      ))}
      {rawData.length > MAX_SCHEMES_TO_SAMPLE && (
        <p className="text-xs text-center text-gray-500 mt-2">
          Showing samples from the first {MAX_SCHEMES_TO_SAMPLE} schemes. Full data in JSON.
        </p>
      )}
    </div>
  );
};

export default PickingSamplesDisplay;
