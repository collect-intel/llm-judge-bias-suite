import React from 'react';
import {
    ClassificationExperimentData, // Now ClassificationItemStrategyPairResult[]
    ClassificationItemResult,    
    ClassificationItemDetails,
    ClassificationStrategyDetails,
    ClassificationItemStrategyPairResult // Explicitly import for clarity
} from '@/types/classificationExperiment';

interface ClassificationExperimentViewerProps {
  data: ClassificationExperimentData; // This is ClassificationItemStrategyPairResult[]
  modelName: string;
}

// Helper to render the aggregated classifications object as a string
const renderAggregatedClassificationsToString = (aggClassifications: { [key: string]: number }): string => {
    return Object.entries(aggClassifications)
        .map(([category, count]) => `${category}: ${count}`)
        .join(', ');
};

// Helper to get the primary (most voted) classification from aggregated results
const getPrimaryClassification = (aggClassifications: { [key: string]: number }): string | null => {
    if (!aggClassifications || Object.keys(aggClassifications).length === 0) return null;
    let primaryCategory: string | null = null;
    let maxCount = -1;
    let tie = false; 
    for (const [category, count] of Object.entries(aggClassifications)) {
        if (count > maxCount) {
            maxCount = count;
            primaryCategory = category;
            tie = false;
        } else if (count === maxCount) { 
            tie = true;
        }
    }
    return tie ? "Tie/Multiple" : primaryCategory;
};

const ClassificationExperimentViewer: React.FC<ClassificationExperimentViewerProps> = ({ data, modelName }) => {
    if (!data || data.length === 0) {
        return <p className="text-gray-500">No classification data available for this model.</p>;
    }

    const resultsByItem: { 
        [itemId: string]: { 
            itemDetails: ClassificationItemDetails | null, 
            strategies: Array<{ 
                strategyDetails: ClassificationStrategyDetails, 
                // itemRun will now be built from ClassificationItemStrategyPairResult
                // to fit the structure expected by the rendering part, if necessary,
                // or we directly use fields from ClassificationItemStrategyPairResult for rendering.
                // For now, let's keep itemRun as ClassificationItemResult for the rendering loop.
                itemRun: ClassificationItemResult 
            }> 
        } 
    } = {};

    // Data is now ClassificationItemStrategyPairResult[]
    data.forEach((itemStrategyPair: ClassificationItemStrategyPairResult) => {
        const itemId = itemStrategyPair.item_details.item_id;
        const currentStrategyDetails = itemStrategyPair.prompt_variant_details;

        // Construct an itemRun object that fits the ClassificationItemResult structure 
        // expected by the rendering part of the component. This makes fewer changes to the render loop.
        const anItemRun: ClassificationItemResult = {
            item_details: itemStrategyPair.item_details, // This is a bit redundant here but matches old structure
            prompt_variant_id: itemStrategyPair.prompt_variant_id,
            runs: itemStrategyPair.runs,
            aggregated_classifications: itemStrategyPair.aggregated_classifications,
            llm_chosen_category_id: itemStrategyPair.llm_chosen_category_id || null,
            error_type: itemStrategyPair.error_type || null,
        };

        if (!resultsByItem[itemId]) {
            resultsByItem[itemId] = {
                itemDetails: itemStrategyPair.item_details,
                strategies: []
            };
        } else if (!resultsByItem[itemId].itemDetails) {
            resultsByItem[itemId].itemDetails = itemStrategyPair.item_details;
        }
        
        resultsByItem[itemId].strategies.push({
            strategyDetails: currentStrategyDetails,
            itemRun: anItemRun 
        });
    });

    return (
        <div className="space-y-8">
            {Object.entries(resultsByItem).map(([itemId, itemGroupData]) => {
                if (!itemGroupData.itemDetails) return null; 

                const primaryClassificationsForItemGroup = itemGroupData.strategies.map(s => 
                    getPrimaryClassification(s.itemRun.aggregated_classifications)
                );
                const uniquePrimaryClassifications = new Set(primaryClassificationsForItemGroup.filter(c => c !== null && c !== "Tie/Multiple"));
                const isItemInconsistent = uniquePrimaryClassifications.size > 1;

                return (
                    <div key={itemId} className={`p-4 rounded-lg shadow-md ${isItemInconsistent ? 'bg-red-50 border-2 border-red-200' : 'bg-gray-50'}`}>
                        <h3 className="text-lg font-semibold text-indigo-700 mb-2">Item: {itemGroupData.itemDetails.item_id}</h3>
                        {isItemInconsistent && (
                            <p className="text-sm font-bold text-red-600 mb-2">▲ This item showed inconsistent classifications across different prompt strategies!</p>
                        )}
                        <p className="text-sm text-gray-800 mb-1">
                            <span className="font-medium">Text:</span> <span className="italic">"{itemGroupData.itemDetails.item_text}"</span>
                        </p>
                        {itemGroupData.itemDetails.expected_true_categories && itemGroupData.itemDetails.expected_true_categories.length > 0 && (
                            <p className="text-sm text-gray-600 mb-3">
                                <span className="font-medium">Expected:</span> {itemGroupData.itemDetails.expected_true_categories.join(', ')}
                            </p>
                        )}
                        
                        <div className="space-y-4 mt-3">
                            <h4 className="text-md font-semibold text-gray-700 mb-1">Strategy Breakdowns:</h4>
                            {itemGroupData.strategies.sort((a,b) => a.strategyDetails.strategy_id.localeCompare(b.strategyDetails.strategy_id)).map((strategyEntry, index) => {
                                const strategy = strategyEntry.strategyDetails;
                                const itemRunForStrategy = strategyEntry.itemRun; // This is now the constructed ClassificationItemResult
                                const primaryClassificationForThisVariant = getPrimaryClassification(itemRunForStrategy.aggregated_classifications);
                                
                                // We need to find the original ClassificationItemStrategyPairResult to get these counts
                                // This is a bit inefficient but necessary if we keep the itemRun slimmed down.
                                // Alternatively, pass these counts into the constructed 'anItemRun' if added to ClassificationItemResult type.
                                // For now, let's assume they came from the original itemStrategyPair. 
                                // We need to find the original `itemStrategyPair` that corresponds to this `strategyEntry`.
                                // This is tricky because `itemRunForStrategy` is a *new* object.
                                // Simplest: Get counts from itemRunForStrategy.runs which is correct.
                                const totalRepetitions = itemRunForStrategy.runs.length;
                                const errorsInRepetitions = itemRunForStrategy.runs.filter(r => r.error_in_repetition).length;

                                return (
                                    <div key={`${itemId}-${strategy.strategy_id}-${index}`} className="p-3 bg-white rounded-md shadow border border-gray-200">
                                        <p className="text-sm font-semibold text-blue-600">Strategy: {strategy.strategy_id}</p>
                                        <p className="text-xs text-gray-500 mb-1 italic">{strategy.description}</p>
                                        {strategy.experimental_focus && (
                                            <p className="text-xs text-purple-700 font-medium mb-1">🎯 Focus: {strategy.experimental_focus}</p>
                                        )}
                                        
                                        <div className="text-xs text-gray-600 space-y-0.5 mb-2">
                                            <p><strong>Order:</strong> [{strategy.category_order.join(', ')}]</p>
                                            <p><strong>Definitions:</strong> {strategy.include_definitions ? 
                                                (strategy.definition_nuance_domain_id ? `ON (Nuanced: ${strategy.definition_nuance_domain_id})` : 'ON (Standard)') 
                                                : 'OFF'}
                                            </p>
                                            {strategy.escape_hatch_config && (
                                                <p><strong>Escape Hatch:</strong> {strategy.escape_hatch_config.name} (<em>{strategy.escape_hatch_config.description}</em>)</p>
                                            )}
                                        </div>

                                        <p className={`text-sm font-medium ${uniquePrimaryClassifications.has(primaryClassificationForThisVariant || "") && uniquePrimaryClassifications.size > 1 && primaryClassificationForThisVariant !== primaryClassificationsForItemGroup[0] ? "text-red-500 font-bold" : "text-gray-800"}`}>
                                            <span className="font-semibold">LLM Classification(s):</span> {
                                                renderAggregatedClassificationsToString(itemRunForStrategy.aggregated_classifications)
                                            }
                                            {totalRepetitions >= 1 && 
                                                <span className="text-xs text-gray-500 ml-1">
                                                    (Reps: {totalRepetitions}, Errors: {errorsInRepetitions})
                                                </span>
                                            }
                                        </p>
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

export default ClassificationExperimentViewer; 