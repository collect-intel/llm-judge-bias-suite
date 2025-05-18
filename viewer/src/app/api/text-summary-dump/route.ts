import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { formatPickingExperimentDataToMarkdown } from '../../../lib/text-dump-formatters/pickingFormatter'; // Adjusted import path
import { formatScoringExperimentDataToMarkdown } from '../../../lib/text-dump-formatters/scoringFormatter'; // Import the new formatter
import { formatPairwiseEloExperimentDataToMarkdown } from '../../../lib/text-dump-formatters/pairwiseEloFormatter'; // Import the new ELO formatter
import { formatClassificationExperimentDataToMarkdown } from '../../../lib/text-dump-formatters/classificationFormatter'; // Import the new classification formatter
import { formatMultiCriteriaExperimentDataToMarkdown } from '../../../lib/text-dump-formatters/multiCriteriaFormatter'; // Import the new multi-criteria formatter
import { formatAdvMultiCriteriaIsolatedDataToMarkdown } from '../../../lib/text-dump-formatters/advMultiCriteriaIsolatedFormatter'; // Import the new formatter

// --- START: Types for Picking Experiment Data (Ideally imported from a shared types file) ---
interface PickingPairDetail {
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
    run1_pick_consistency: string;
    run1_pick_distribution: { [key: string]: number };
    run1_errors: string;
    run2_order: string;
    run2_majority_pick_id?: string | null;
    run2_pick_consistency: string;
    run2_pick_distribution: { [key: string]: number };
    run2_errors: string;
}

interface PickingExperimentSchemeResult {
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
// --- END: Types for Picking Experiment Data ---

// Minimal types for scan results - these should be shared from a central types file
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

interface ApiError {
  error: string;
  details?: string;
}

export async function GET(request: NextRequest) {
    try {
        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = request.headers.get('x-forwarded-proto') || 'http';
        const scanApiUrl = `${protocol}://${host}/api/scan-results`;

        const scanResponse = await fetch(scanApiUrl);

        if (!scanResponse.ok) {
            const errorData: ApiError = await scanResponse.json();
            console.error("Error fetching scan results:", errorData);
            return NextResponse.json({ error: "Failed to fetch scan results", details: errorData.error || `HTTP error! status: ${scanResponse.status}` }, { status: 500 });
        }
        const scanData: ScanResults = await scanResponse.json();

        if (!scanData.experiments || Object.keys(scanData.experiments).length === 0) {
            return new NextResponse("No experiments found in scan results to summarize.", {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
            });
        }

        let markdownOutput = `# Comprehensive LLM Experiment Data Dump\n\n`;
        markdownOutput += `This document provides a comprehensive dump of results from various LLM evaluation experiments. `;
        markdownOutput += `It is designed for detailed analysis and can be used as input for further summarization by other language models. `;
        markdownOutput += `The dump includes aggregated summaries across models and experiments, as well as model-specific performance details for each experiment type. `;
        markdownOutput += `Key metrics related to biases, scoring accuracy, ranking stability, classification performance, and multi-criteria evaluation are presented in a structured Markdown format.\n\n`;

        markdownOutput += `Report Generated: ${new Date().toLocaleString()}\n`;
        markdownOutput += `Data sourced from: ${scanData.resultsDir}\n\n`;

        const experimentTypesFound = Object.keys(scanData.experiments).sort();
        markdownOutput += `## Found Experiment Types:\n`;
        experimentTypesFound.forEach(expType => {
            markdownOutput += `- ${expType}\n`;
        });
        markdownOutput += `\n`;

        markdownOutput += `## Detailed Summaries by Experiment Type:\n`;

        for (const experimentType of experimentTypesFound) {
            const titleCasedExperimentType = experimentType
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            markdownOutput += `\n### Experiment Type: ${titleCasedExperimentType}\n`;
            
            const experimentMeta = scanData.experiments[experimentType];
            if (!experimentMeta) {
                markdownOutput += `(No metadata found for experiment type '${experimentType}')\n`;
                continue;
            }

            if (experimentType === 'picking') {
                try {
                    const pickingMarkdown = await formatPickingExperimentDataToMarkdown(experimentMeta, protocol, host);
                    markdownOutput += pickingMarkdown;
                } catch (e: any) {
                    markdownOutput += `Error generating picking experiment summary: ${e.message}\n`;
                    console.error(`Error calling formatPickingExperimentDataToMarkdown for ${experimentType}:`, e);
                }
            } else if (experimentType.startsWith('scoring')) {
                try {
                    const scoringMarkdown = await formatScoringExperimentDataToMarkdown(experimentMeta, protocol, host);
                    markdownOutput += scoringMarkdown;
                } catch (e: any) {
                    markdownOutput += `Error generating scoring experiment summary for ${experimentType}: ${e.message}\n`;
                    console.error(`Error calling formatScoringExperimentDataToMarkdown for ${experimentType}:`, e);
                }
            } else if (experimentType.startsWith('pairwise_elo')) {
                try {
                    const eloMarkdown = await formatPairwiseEloExperimentDataToMarkdown(experimentMeta, protocol, host);
                    markdownOutput += eloMarkdown;
                } catch (e: any) {
                    markdownOutput += `Error generating pairwise ELO experiment summary for ${experimentType}: ${e.message}\n`;
                    console.error(`Error calling formatPairwiseEloExperimentDataToMarkdown for ${experimentType}:`, e);
                }
            } else if (experimentType === 'classification') {
                try {
                    const classificationMarkdown = await formatClassificationExperimentDataToMarkdown(experimentMeta, protocol, host);
                    markdownOutput += classificationMarkdown;
                } catch (e: any) {
                    markdownOutput += `Error generating classification experiment summary for ${experimentType}: ${e.message}\n`;
                    console.error(`Error calling formatClassificationExperimentDataToMarkdown for ${experimentType}:`, e);
                }
            } else if (experimentType.startsWith('multi_criteria') || experimentType.startsWith('adv_multi_criteria_permuted')) {
                try {
                    const mcMarkdown = await formatMultiCriteriaExperimentDataToMarkdown(experimentType, experimentMeta, protocol, host);
                    markdownOutput += mcMarkdown;
                } catch (e: any) {
                    markdownOutput += `Error generating multi-criteria summary for ${experimentType}: ${e.message}\n`;
                    console.error(`Error calling formatMultiCriteriaExperimentDataToMarkdown for ${experimentType}:`, e);
                }
            } else if (experimentType.startsWith('adv_multi_criteria_isolated')) {
                try {
                    const isoMarkdown = await formatAdvMultiCriteriaIsolatedDataToMarkdown(experimentMeta, protocol, host);
                    markdownOutput += isoMarkdown;
                } catch (e: any) {
                    markdownOutput += `Error generating isolated multi-criteria summary for ${experimentType}: ${e.message}\n`;
                    console.error(`Error calling formatAdvMultiCriteriaIsolatedDataToMarkdown for ${experimentType}:`, e);
                }
            } else {
                markdownOutput += `(Processing for experiment type '${experimentType}' not yet implemented for text dump)\n`;
            }
            markdownOutput += `\n---\n`;
        }

        return new NextResponse(markdownOutput, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });

    } catch (error: any) {
        console.error("Error in text-summary-dump endpoint:", error);
        return NextResponse.json({ error: "Internal server error generating text dump", details: error.message }, { status: 500 });
    }
} 