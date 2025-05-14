import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Types from scan-results/route.ts (or simplified versions)
interface ExperimentFile {
  fileName: string;
  modelName: string;
  experimentType: string;
  filePath: string; // Relative path from the 'tmp_report_output' directory
}

// Regex from scan-results/route.ts
const comprehensiveRegex = /^(adv_multi_criteria_permuted_[a-zA-Z0-9_]+|adv_multi_criteria_isolated_[a-zA-Z0-9_]+|multi_criteria_[a-zA-Z0-9_]+|picking|scoring|pairwise_elo)_results_([a-zA-Z0-9\/._-]+)\.json$/i;
const simpleFallbackRegex = /^(.*?)_results_([a-zA-Z0-9\/._-]+)\.json$/i;

// Helper to generate descriptions based on experiment type
function getExperimentDescription(experimentType: string, modelName: string): string {
  const baseDescriptions: Record<string, string> = {
    picking: "This experiment tests for positional bias in pairwise choice tasks, where an LLM chooses between two responses. It investigates how different labeling schemes (e.g., 'Response 1/2', '(A)/(B)', random IDs) and prompt variants affect the LLM's preference for an option based on its presentation order and consistency of choice.",
    scoring: "This experiment evaluates LLM scoring accuracy and consistency across various scales (numeric, letter grades, custom labels), rubrics, and text types (poems, sentiment analysis, criterion adherence). It examines if LLMs can reliably apply scales, especially for nuanced or negatively-valenced criteria.",
    pairwise_elo: "This experiment ranks a set of items (e.g., haikus, short arguments) based on LLM pairwise preferences using an Elo rating system. It tests various prompt styles to see how they influence the LLM's comparative judgments.",
    multi_criteria: "This experiment assesses an LLM's ability to score complex items (e.g., arguments, story openings) against detailed, multi-point rubrics, expecting structured JSON output. The specific task (e.g., Argument, StoryOpening, indicated in the full experimentType) defines the item type and rubric used.",
    adv_multi_criteria_permuted: "This experiment investigates sensitivity in multi-criteria scoring by permuting the order of criteria presentation to the LLM. The specific task (e.g., Argument, StoryOpening, indicated in the full experimentType) defines the item type and rubric.",
    adv_multi_criteria_isolated: "This experiment compares LLM scores for individual criteria when evaluated in isolation versus as part of a holistic, multi-criteria assessment. The specific task (e.g., Argument, StoryOpening, indicated in the full experimentType) defines the item type and rubric."
  };

  let baseKey = experimentType.split('_')[0]; // e.g., "multi_criteria_argument" -> "multi_criteria"
  if (experimentType.startsWith('adv_multi_criteria')) {
    baseKey = experimentType.startsWith('adv_multi_criteria_permuted') ? 'adv_multi_criteria_permuted' : 'adv_multi_criteria_isolated';
  } else if (baseDescriptions[experimentType]) { // Exact match like "picking", "scoring"
    baseKey = experimentType;
  }


  const description = baseDescriptions[baseKey] || "Generic experiment results.";
  return `Results for the '${experimentType}' experiment using model '${modelName}'. ${description}`;
}


export async function GET() {
  const resultsDirName = 'tmp_report_output';
  const baseDir = path.join(process.cwd(), '..', resultsDirName);

  const outputData = [];
  let files: string[];

  if (!fs.existsSync(baseDir)) {
    return NextResponse.json({
      description: "Error: Results directory not found.",
      data: [],
      error: `Results directory '${resultsDirName}' not found at ${baseDir}. Please ensure it exists and contains experiment JSON files.`
    }, { status: 404 });
  }

  try {
    files = fs.readdirSync(baseDir);
  } catch (readDirError: any) {
    return NextResponse.json({
      description: "Error: Failed to read results directory.",
      data: [],
      error: `Error reading results directory ${baseDir}: ${readDirError.message}`
    }, { status: 500 });
  }

  if (files.length === 0) {
    return NextResponse.json({
      description: `Results directory '${resultsDirName}' is empty. No experiment files to dump.`,
      data: []
    });
  }

  const experimentFiles: ExperimentFile[] = [];

  files.forEach(file => {
    if (file.endsWith('.json')) {
      let match = file.match(comprehensiveRegex);
      let experimentTypeFromMatch: string | undefined;
      let modelNameFromMatch: string | undefined;

      if (match) {
        experimentTypeFromMatch = match[1];
        modelNameFromMatch = match[2];
      } else {
        match = file.match(simpleFallbackRegex);
        if (match) {
          experimentTypeFromMatch = match[1];
          modelNameFromMatch = match[2];
        }
      }
      
      if (experimentTypeFromMatch) {
        experimentTypeFromMatch = experimentTypeFromMatch.replace(/_results$/, '');
      }

      if (experimentTypeFromMatch && modelNameFromMatch) {
        experimentFiles.push({
          fileName: file,
          modelName: modelNameFromMatch,
          experimentType: experimentTypeFromMatch,
          filePath: file, // Relative path from tmp_report_output
        });
      }
    }
  });

  // Sort files for consistent output order
  experimentFiles.sort((a, b) => {
    if (a.experimentType.toLowerCase() < b.experimentType.toLowerCase()) return -1;
    if (a.experimentType.toLowerCase() > b.experimentType.toLowerCase()) return 1;
    if (a.modelName.toLowerCase() < b.modelName.toLowerCase()) return -1;
    if (a.modelName.toLowerCase() > b.modelName.toLowerCase()) return 1;
    return a.fileName.localeCompare(b.fileName);
  });

  for (const expFile of experimentFiles) {
    const fullFilePath = path.join(baseDir, expFile.filePath);
    try {
      const fileContents = fs.readFileSync(fullFilePath, 'utf-8');
      const jsonData = JSON.parse(fileContents);
      outputData.push({
        filePath: expFile.filePath, // Store relative path for reference
        experimentType: expFile.experimentType,
        modelName: expFile.modelName,
        description: getExperimentDescription(expFile.experimentType, expFile.modelName),
        data: jsonData,
      });
    } catch (error: any) {
      console.error(`Error reading or parsing file ${fullFilePath}:`, error);
      outputData.push({
        filePath: expFile.filePath,
        experimentType: expFile.experimentType,
        modelName: expFile.modelName,
        description: `Error processing file for experiment '${expFile.experimentType}' with model '${expFile.modelName}'.`,
        error: error.message,
        fileContentPreview: (error.code !== 'ENOENT' && fs.existsSync(fullFilePath)) ? fs.readFileSync(fullFilePath, 'utf-8').substring(0, 200) + '...' : 'File not found or not accessible for preview.'
      });
    }
  }

  return NextResponse.json({
    dumpDescription: "This is a comprehensive dump of all available LLM bias experiment results. Each entry in the 'results' array corresponds to a single experiment run (typically one JSON file), including metadata and the raw experiment data. This format is intended for large-scale analysis or ingestion into systems like large context-window LLMs.",
    resultsGeneratedAt: new Date().toISOString(),
    totalFilesProcessed: experimentFiles.length,
    results: outputData
  });
} 