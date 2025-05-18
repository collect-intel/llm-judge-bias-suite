# LLM Judge Bias Research Suite

This is a research project where we're attempting to understand how small nuances and different approaches in how we pose evaluation tasks to LLM 'judges' can lead to vastly different outcomes.

**Investigating the Nuances of LLM Behavior in Evaluative Tasks**

## Overview

Large Language Models (LLMs) are increasingly used for tasks requiring evaluation, ranking, scoring, and classification. However, the reliability and consistency of their outputs can be significantly affected by subtle aspects of how questions are posed, how criteria are defined, and how scoring systems are presented. This project provides python scripts to systematically probe, compare, and understand these interaction-driven biases and behavioral patterns in LLMs, namely:

*   **Positional Cues**: Does the order of options influence choice? How do different *labeling schemes* (e.g., "Response 1/Response 2", "(A)/(B)", "TEXT_A/TEXT_B", "Response A/Response B", "Option X/Option Y", "❖/⊕", or even randomly generated IDs like "ID_x7y2/ID_z3k9") affect this?
*   **Scoring Scales**: Do LLMs correctly map concepts to numerical or categorical scales, especially when evaluating negative or undesirable traits (e.g., assigning a *high* score for *high presence* of a negative attribute)?
*   **Prompt Phrasing**: How do minor changes in instructions or the LLM's persona affect outcomes?
*   **Rubric Complexity**: Can LLMs reliably follow detailed, multi-point rubrics?
*   **Criteria Presentation**: Does the order or isolation of evaluation criteria impact scores in multi-criteria assessments?

Understanding these interaction-driven factors is crucial for anyone relying on LLMs for analytical or evaluative outputs, ensuring more robust and predictable results.

## Architecture

*   **`bias_analyzer.py`**: The main Command Line Interface (CLI) entry point. Manages experiment selection, LLM model configuration, and overall execution flow.
*   **`experiment_runners/`**: Contains modular Python scripts for different types of experiments:
    *   **`picking_experiments.py`**: Tests for positional bias in pairwise choice tasks (e.g., is "Response 1" chosen more often regardless of content?).
    *   **`scoring_experiments.py`**: Evaluates LLM scoring using various scales (numeric, letter grades, custom labels) and rubrics on diverse texts (poems, sentiment analysis, criterion adherence). Critically examines if LLMs can consistently apply scales, especially for nuanced or negatively-valenced criteria.
    *   **`pairwise_elo_experiment.py`**: Ranks items (e.g., haikus) based on LLM pairwise preferences using an Elo rating system, testing different prompt styles for comparison.
    *   **`multi_criteria_scoring_experiment.py`**: Assesses LLM ability to score complex documents (e.g., consultation drafts) against detailed, multi-point rubrics, expecting structured JSON output and comparing to human benchmarks.
    *   **`advanced_multi_criteria_experiment.py`**: Investigates sensitivity in multi-criteria scoring by permuting the order of criteria presentation (to see if the order of evaluation affects outcomes) and evaluating criteria in isolation (to compare scores when a criterion is assessed alone versus as part of a full rubric). This helps understand contextual effects in multi-criteria judgments.
    *   **`classification_experiment.py`**: Probes biases in LLM classification tasks by varying how categories are presented, how their definitions are nuanced, and whether escape hatches (e.g., "Other/Unclear") are provided. Useful for understanding how prompting methodology affects categorization of ambiguous items.
*   **`test_data.py`**: Stores all test datasets (poems, story openings, consultation drafts, texts for sentiment/criterion analysis, etc.) in structured Python formats. Includes human baseline scores and rubrics where applicable.
*   **`config_utils.py`**: Manages LLM API interactions (currently configured for OpenRouter), model selection, and API key handling.
*   **`.env` (template)**: For storing API keys (e.g., `OPENROUTER_API_KEY`) and the default model (e.g., `BIAS_SUITE_LLM_MODEL`).

## Key Experiments & Behaviors Investigated

*   **Positional Bias**:
    *   Does the LLM favor options based on their presentation order (e.g., the first option presented)?
    *   The experiment now supports various **Labeling Schemes** to test how different ways of presenting choices impact positional bias. These schemes include:
        *   `Response12`: The original "Response 1" vs "Response 2".
        *   `ParentheticalABC`: Labels like "(A)" vs "(B)".
        *   `TextAB`: Labels like "TEXT_A" vs "TEXT_B".
        *   `ResponseAB`: Labels like "Response A" vs "Response B".
        *   `OptionXY`: Labels like "Option X" vs "Option Y".
        *   `ExoticSymbolLabels`: Labels like "❖" vs "⊕".
        *   `RandomAlphanumericIDs`: Randomly generated IDs like "ID_x7y2" vs "ID_z3k9" for each pair, to test positional bias with abstract, non-semantic labels.
    *   This allows for a more nuanced understanding of whether the bias is tied to specific keywords (like "Response 1") or the general position/labeling format.
    *   **Role of Repetitions in Bias Detection**: To increase the reliability of bias detection, each specific presentation order within a pair (e.g., Text A as option 1, Text B as option 2) can be evaluated multiple times by the LLM (using the general `--repetitions` flag, see "Common Flags" below). A majority vote across these repetitions determines the LLM's most stable choice for that particular order. The final analysis for positional bias then compares these majority-voted outcomes from the two counterbalanced presentation orders (e.g., Order 1: A vs. B; Order 2: B vs. A). This methodology helps distinguish systematic positional preferences from single instances of random LLM variability, providing a more robust signal of true bias.
*   **Scale Adherence & Interpretation**:
    *   Can the LLM consistently use different scoring scales (1-5, A-E, custom labels)?
    *   Does it correctly understand that a high score can mean "high presence of X," even if X is undesirable (e.g., high sexism score)? This addresses the "scale flipping" issue based on learned associations.
*   **Prompt Sensitivity**: How do instructions, system prompts, or requests for justification alter LLM responses?
*   **Rubric Following**: How accurately can LLMs apply complex, multi-faceted rubrics?
*   **Order Effects in Criteria**: Does changing the order of evaluation criteria in a multi-criteria task affect individual scores?
*   **Isolated vs. Holistic Evaluation**: Do scores for a criterion change if evaluated alone versus as part of a larger set?
*   **Classification & Categorization Biases**:
    *   Does the order in which potential categories are listed in a prompt influence the LLM's choice for ambiguous items?
    *   How sensitive is classification to subtle changes in category definitions provided in the prompt?
    *   Does the availability (or specific wording) of an "Other/Unclear" escape hatch category alter how items are classified, especially for borderline cases?

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/collect-intel/llm-judge-bias-suite
    cd llm-judge-bias-suite
    ```

2.  **Set up a virtual environment (recommended):**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```
3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configure API Key & Default Model:**
    *   Create a file named `.env` in the project root.
    *   Add your OpenRouter API key and optionally a default model to the `.env` file:
        ```
        OPENROUTER_API_KEY="your_openrouter_key_here"
        BIAS_SUITE_LLM_MODEL="your_default_model_identifier_here" # e.g., mistralai/mistral-7b-instruct
        ```
        (If `BIAS_SUITE_LLM_MODEL` is not set, a hardcoded default from `config_utils.py` will be used if no model is specified via command line.)

5.  **Run experiments:**
    *   Navigate to the directory containing `bias_analyzer.py` (likely the project root or a subdirectory).
    *   **To see all available commands and arguments, run:**
        ```bash
        python bias_analyzer.py --help
        ```
    *   **Run a specific experiment type (examples):**
        ```bash
        python bias_analyzer.py scoring --scoring_type poems --scoring_samples 1 --repetitions 2 --temp 0.5
        python bias_analyzer.py picking --num_picking_pairs 2 --repetitions 3 --temp 0.1
        python bias_analyzer.py multi_criteria --task argument --scoring_samples 1 --repetitions 1
        python bias_analyzer.py adv_multi_criteria_permuted --task story_opening --scoring_samples 1 --repetitions 2
        python bias_analyzer.py classification --classification_num_samples 5 --classification_domain_filter user_feedback_v1 --repetitions 2 --temp 0.2
        ```
    *   **Run all experiments for the default model:**
        ```bash
        python bias_analyzer.py all
        ```
    *   **Run all experiments for multiple specified models and save output:**
        ```bash
        python bias_analyzer.py all --models "mistralai/mistral-small,anthropic/claude-3-haiku-20240307" --output_dir ./experiment_outputs --temp 0.3
        ```

    *   **Common Flags (use `python bias_analyzer.py --help` for a full and up-to-date list):**
        *   `--model <model_identifier>`: Specify a single LLM model (e.g., `mistralai/mistral-medium`).
        *   `--models <comma_separated_models>`: Specify a comma-separated list of LLM models to run experiments for each.
        *   `--repetitions <N>`: Run each LLM evaluation N times (useful for assessing consistency or for majority voting in bias detection).
        *   `--temp <float>`: Temperature for LLM calls (e.g., 0.1, 0.7). Default is 0.1. This is used for API calls and reflected in the output filename.
        *   `--output_dir <directory_path>`: Directory to save detailed experiment results as structured **JSON files**. Each experiment type, model, temperature, and repetition count will typically generate its own file (e.g., `picking_results_mistralai_mistral-small_temp01_rep3.json`).
        *   `--show_raw`: Display (potentially truncated) raw LLM responses in the console.
    *   **Experiment-Specific Flags (examples):**
        *   `picking`:
            *   `--num_picking_pairs <N>`: Limit the number of pairs to test in the picking experiment.
        *   `scoring`:
            *   `--scoring_samples <N>`: Limit the number of items to score.
            *   `--scoring_type <type>`: Choose from `poems`, `sentiment`, `criterion_adherence`, or `all`.
        *   `multi_criteria`, `adv_multi_criteria_permuted`, `adv_multi_criteria_isolated`:
            *   `--task <task_type>`: Choose the dataset/rubric, e.g., `argument` or `story_opening`.
            *   `--scoring_samples <N>` (for `multi_criteria` and `adv_multi_criteria`): Limit the number of items to score.
        *   `classification`:
            *   `--classification_num_samples <N>`: Limit the number of items to classify (0 for all).
            *   `--classification_domain_filter <domain_id>`: Filter prompt strategies to only run for a specific item domain (e.g., `user_feedback_v1`). Defaults to "all" relevant strategies.

## Extending the Suite

The `bias_suite` is designed for extensibility:

*   **Adding New Variants (Prompts/Scales):**
    *   Modify `PROMPT_VARIANTS` (or similar lists/dictionaries, e.g., `ORIGINAL_PROMPT_VARIANTS`, `PROMPT_VARIANT_STRATEGIES`) in the relevant `experiment_runners/*.py` files.
*   **Adding New Test Data:**
    *   Add to `test_data.py`.
*   **Adding New Experiment Types:**
    *   Create a new script in `experiment_runners/`.
    *   Integrate into `bias_analyzer.py`.
*   **Testing Your Own Prompts:**
    1.  **Identify the Experiment Type:** Determine which kind of task your prompt is designed for (e.g., pairwise choice, scoring, classification). This will tell you which file in the `experiment_runners/` directory to modify.
        *   Pairwise choice: `picking_experiments.py`
        *   Scoring based on a scale/rubric: `scoring_experiments.py` (for simpler scoring) or `multi_criteria_scoring_experiment.py` / `advanced_multi_criteria_experiment.py` (for complex, multi-faceted rubrics).
        *   Ranking items: `pairwise_elo_experiment.py`
        *   Classification: `classification_experiment.py`
    2.  **Locate Prompt Definitions:** Open the relevant Python file. Look for list or dictionary structures that hold the prompt variants. These are often named `PROMPT_VARIANTS`, `PROMPT_CONFIGURATIONS`, `VARIANTS_DEFINITIONS`, or similar (e.g., in `picking_experiments.py`, you'll find `ORIGINAL_PROMPT_VARIANTS` which then get augmented with system prompt versions).
    3.  **Add Your Prompt:**
        *   Carefully examine the structure of the existing prompt definitions in that file (e.g., dictionaries with keys like "name", "prompt_template", "system_prompt", "strategy_id", "description", "category_order", "include_definitions", etc.).
        *   Add your new prompt variant, following the same structure. Give it a unique name or ID.
        *   Ensure your `prompt_template` uses the correct placeholder variables (e.g., `{question}`, `{response_a_content}`, `{label1}`, `{text}`, `{rubric_text}`, `{criterion}`, `{{A}}`, `{{B}}`, `{category_list_comma_separated}`) as used by that experiment type. These are usually documented within the experiment file or can be inferred from existing prompts.
    4.  **Run the Experiment:**
        *   Use `bias_analyzer.py` to run the specific experiment type you modified.
        *   You can use flags like `--models <your_test_model>` to specify a particular model.
        *   Use `--repetitions <N>` to run your prompt multiple times for consistency checks.
        *   Use the `--temp <float>` flag to control the LLM's temperature.
        *   Consider using `--output_dir ./my_prompt_tests` to save the results to a specific directory.
        *   For experiments like `scoring` or `multi_criteria`, use `--scoring_samples 1` (or a small number) to test your prompt on a limited set of items initially. For `picking`, use `--num_picking_pairs 1`. For `classification`, use `--classification_num_samples 1`.
        *   Example for testing a new picking prompt:
            ```bash
            python bias_analyzer.py picking --models "mistralai/mistral-small" --num_picking_pairs 1 --repetitions 3 --temp 0.7 --output_dir ./my_picking_tests
            ```
    5.  **Check Results:** Examine the JSON output in your specified directory and any console output (especially if not using `--quiet` or if using `--show_raw`) to see how your prompt performed.

## License

MIT License
