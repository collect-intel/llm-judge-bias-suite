import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Define a more specific type for the experiment data structure
interface ExperimentFile {
  fileName: string;
  modelName: string;
  experimentType: string; // e.g., "picking", "scoring", "multi_criteria_argument"
  filePath: string; // Relative path from the 'tmp_report_output' directory
  // Removed fileType as all will be JSON
}

// Define a type for the API response
interface ScanResultsResponse {
  resultsDir: string;
  experiments: Record<string, { models: Record<string, ExperimentFile[]>; modelNames: string[] }>;
  availableModels: string[]; // All unique model names found
  message?: string; // Optional message for client, e.g., directory not found
  error?: string; // Optional error message for server-side logging or specific client handling
}

// Regex to parse filenames like:
// experiment_type_results_model_name.extension
// or adv_multi_criteria_permuted_task_results_model_name.extension
// const fileNameRegex = /^([a-zA-Z0-9_]+(?:_[a-zA-Z0-9_]+)*)_results_([a-zA-Z0-9\/._-]+)\.(csv|json)$/;
// Simpler regex if the above is too greedy or complex for some names:
// E.g. picking_results_model_name.csv
// E.g. multi_criteria_argument_results_model_name.csv
// const simpleFileNameRegex = /^([a-zA-Z0-9_]+)_results_([a-zA-Z0-9\/._-]+)\.(csv|json)$/;
// Advanced regex to capture task for multi_criteria and advanced types
// adv_multi_criteria_permuted_argument_results_model.json -> type: adv_multi_criteria_permuted_argument
// multi_criteria_story_opening_results_model.csv -> type: multi_criteria_story_opening
// picking_results_model.csv -> type: picking

// --- Regexes for NEW filename structure: {experiment_type}_{YYYYMMDD-HHMMSS}_{data_hash}_{model_name_with_suffixes}.json ---
const newComprehensiveRegex = /^(adv_multi_criteria_permuted_[a-zA-Z0-9_]+|adv_multi_criteria_isolated_[a-zA-Z0-9_]+|multi_criteria_[a-zA-Z0-9_]+|classification|picking|scoring|pairwise_elo)_\d{8}-\d{6}_[a-f0-9]{8}_(.+?)\.json$/i;
const newSimpleFallbackRegex = /^(.*?)_\d{8}-\d{6}_[a-f0-9]{8}_(.+?)\.json$/i;

// --- Regexes for OLD filename structure: {experiment_type}_results_{model_name_with_suffixes}.json ---
const oldComprehensiveRegex = /^(adv_multi_criteria_permuted_[a-zA-Z0-9_]+|adv_multi_criteria_isolated_[a-zA-Z0-9_]+|multi_criteria_[a-zA-Z0-9_]+|classification|picking|scoring|pairwise_elo)_results_([a-zA-Z0-9\/._-]+?)\.json$/i;
const oldSimpleFallbackRegex = /^(.*?)_results_([a-zA-Z0-9\/._-]+?)\.json$/i;

export async function GET() {
  // Path to the results directory relative to the project root
  const resultsDirName = 'tmp_report_output'; 
  // Correctly go up one level from viewer (process.cwd()) to the project root
  const baseDir = path.join(process.cwd(), '..', resultsDirName);

  const responseData: ScanResultsResponse = {
    resultsDir: resultsDirName,
    experiments: {},
    availableModels: [],
  };

  if (!fs.existsSync(baseDir)) {
    console.warn(`Results directory not found: ${baseDir}`);
    responseData.message = `Results directory '${resultsDirName}' not found. Please ensure it exists and contains experiment JSON files.`;
    return NextResponse.json(responseData); // Return 200 with a message
  }

  let files: string[];
  try {
    files = fs.readdirSync(baseDir);
  } catch (readDirError: any) {
    console.error(`Error reading results directory ${baseDir}:`, readDirError);
    responseData.message = `Error reading results directory '${resultsDirName}'. Check permissions.`;
    responseData.error = readDirError.message || "Failed to read directory contents."; // Add error details for server log, not necessarily for client
    // Still return a 200 with the responseData structure for the UI to handle gracefully, but include a message.
    // If we wanted to signal a server-side issue more strongly, a 500 might be used here, but for resilience for UI, let's send structured empty data.
    return NextResponse.json(responseData); 
  }

  if (files.length === 0) {
    console.warn(`Results directory is empty: ${baseDir}`);
    responseData.message = `Results directory '${resultsDirName}' is empty. No experiment files to display.`;
    return NextResponse.json(responseData); // Return 200 with a message
  }

  try {
    const experimentFiles: ExperimentFile[] = [];
    const allModelNames = new Set<string>();

    files.forEach(file => {
      if (file.endsWith('.json')) { 
        let match = file.match(newComprehensiveRegex);
        let experimentTypeFromMatch: string | undefined;
        let modelNameFromMatch: string | undefined;

        if (match) {
          experimentTypeFromMatch = match[1];
          modelNameFromMatch = match[2];
        } else {
          match = file.match(newSimpleFallbackRegex);
          if (match) {
            experimentTypeFromMatch = match[1];
            modelNameFromMatch = match[2];
          } else {
            // If new formats don't match, try old formats
            match = file.match(oldComprehensiveRegex);
            if (match) {
              experimentTypeFromMatch = match[1];
              modelNameFromMatch = match[2];
            } else {
              match = file.match(oldSimpleFallbackRegex);
              if (match) {
                experimentTypeFromMatch = match[1];
                modelNameFromMatch = match[2];
              }
            }
          }
        }
        
        // Ensure _results suffix is cleanly removed if it exists, even if regex captures it partially
        if (experimentTypeFromMatch) {
          experimentTypeFromMatch = experimentTypeFromMatch.replace(/_results$/, '');
        }

        if (experimentTypeFromMatch && modelNameFromMatch) {
          experimentFiles.push({
            fileName: file,
            modelName: modelNameFromMatch,
            experimentType: experimentTypeFromMatch,
            filePath: file, 
          });
          allModelNames.add(modelNameFromMatch);
        } else {
          console.warn(`File ${file} is JSON but does not match any expected experiment naming pattern. Skipping.`);
        }
      }
    });

    experimentFiles.sort((a, b) => {
      if (a.experimentType.toLowerCase() < b.experimentType.toLowerCase()) return -1;
      if (a.experimentType.toLowerCase() > b.experimentType.toLowerCase()) return 1;
      if (a.modelName.toLowerCase() < b.modelName.toLowerCase()) return -1;
      if (a.modelName.toLowerCase() > b.modelName.toLowerCase()) return 1;
      return a.fileName.localeCompare(b.fileName);
    });

    responseData.availableModels = Array.from(allModelNames).sort();

    for (const pf of experimentFiles) {
      if (!responseData.experiments[pf.experimentType]) {
        responseData.experiments[pf.experimentType] = { models: {}, modelNames: [] };
      }
      if (!responseData.experiments[pf.experimentType].models[pf.modelName]) {
        responseData.experiments[pf.experimentType].models[pf.modelName] = [];
      }
      responseData.experiments[pf.experimentType].models[pf.modelName].push(pf);
    }
    
    for (const expType in responseData.experiments) {
        responseData.experiments[expType].modelNames = Object.keys(responseData.experiments[expType].models).sort();
    }

    if (experimentFiles.length === 0 && files.length > 0) {
        // This case means there were JSON files, but none matched the naming patterns.
        responseData.message = `Found JSON files in '${resultsDirName}', but none matched the expected naming patterns for experiments.`;
    }

    return NextResponse.json(responseData);

  } catch (processingError: any) {
    console.error('Error processing files in results directory:', processingError);
    // For unexpected errors during file processing, return a 500
    return NextResponse.json({ 
        error: 'Failed to process experiment results', 
        details: processingError.message 
    }, { status: 500 });
  }
} 