import os
import re
from dotenv import load_dotenv
import argparse
import json
from tqdm import tqdm
import datetime
import hashlib

# Import experiment runners
from experiment_runners.picking_experiments import run_positional_bias_picking_experiment
from experiment_runners.scoring_experiments import run_scoring_experiment
from experiment_runners.pairwise_elo_experiment import run_pairwise_elo_experiment
from experiment_runners.multi_criteria_scoring_experiment import run_multi_criteria_experiment
from experiment_runners.advanced_multi_criteria_experiment import run_permuted_order_multi_criteria_experiment, run_isolated_criterion_scoring_experiment
from experiment_runners.classification_experiment import run_classification_experiment

# Import shared config and functions
from config_utils import set_api_key, set_llm_model, BIAS_SUITE_LLM_MODEL as config_llm_model, call_openrouter_api

# Import test data for dynamic loading
from test_data import (
    SHORT_ARGUMENTS_FOR_SCORING,
    ARGUMENT_EVALUATION_RUBRIC,
    STORY_OPENINGS_FOR_SCORING,
    STORY_OPENING_EVALUATION_RUBRIC,
    CLASSIFICATION_ITEMS,
    CLASSIFICATION_CATEGORIES,
    PROMPT_VARIANT_STRATEGIES
)

# --- Configuration (now minimal, mostly handled in config_utils) ---
# SAMPLE_POEM and SCORING_CRITERION would move if run_poem_scoring_experiment moves

# call_openrouter_api IS NOW IN config_utils.py

# parse_score, normalize_score, run_poem_scoring_experiment should ideally move to a scoring_experiments.py
# For now, if you want to run poem scoring, you'd need to ensure call_openrouter_api is available to it,
# perhaps by passing it or importing it there from config_utils too.

def generate_data_payload_hash(experiment_args):
    """
    Generates a hash for the data payloads relevant to the current experiment.
    """
    payloads_to_hash = []
    exp_type = experiment_args.experiment
    task_type = experiment_args.task # For multi_criteria and adv_multi_criteria
    scoring_type = experiment_args.scoring_type # For scoring

    # Dynamically import from test_data to avoid loading everything always
    # and to ensure the most current data is used for hashing.
    from test_data import (
        PICKING_PAIRS, POEMS_FOR_SCORING, TEXTS_FOR_SENTIMENT_SCORING,
        TEXTS_FOR_CRITERION_ADHERENCE_SCORING, FEW_SHOT_EXAMPLE_SETS_SCORING,
        RANKING_SETS, SHORT_ARGUMENTS_FOR_SCORING, ARGUMENT_EVALUATION_RUBRIC,
        STORY_OPENINGS_FOR_SCORING, STORY_OPENING_EVALUATION_RUBRIC,
        CLASSIFICATION_ITEMS, CLASSIFICATION_CATEGORIES, PROMPT_VARIANT_STRATEGIES
    )

    if exp_type == "picking":
        payloads_to_hash.append(PICKING_PAIRS)
    elif exp_type == "scoring":
        if scoring_type == "poems" or scoring_type == "all":
            payloads_to_hash.append(POEMS_FOR_SCORING)
        if scoring_type == "sentiment" or scoring_type == "all":
            payloads_to_hash.append(TEXTS_FOR_SENTIMENT_SCORING)
        if scoring_type == "criterion_adherence" or scoring_type == "all":
            payloads_to_hash.append(TEXTS_FOR_CRITERION_ADHERENCE_SCORING)
        payloads_to_hash.append(FEW_SHOT_EXAMPLE_SETS_SCORING) # Hash all few-shot sets
    elif exp_type == "pairwise_elo":
        payloads_to_hash.append(RANKING_SETS)
    elif exp_type == "multi_criteria" or exp_type.startswith("adv_multi_criteria"):
        if task_type == "argument":
            payloads_to_hash.append(SHORT_ARGUMENTS_FOR_SCORING)
            payloads_to_hash.append(ARGUMENT_EVALUATION_RUBRIC)
        elif task_type == "story_opening":
            payloads_to_hash.append(STORY_OPENINGS_FOR_SCORING)
            payloads_to_hash.append(STORY_OPENING_EVALUATION_RUBRIC)
    elif exp_type == "classification":
        payloads_to_hash.append(CLASSIFICATION_ITEMS)
        payloads_to_hash.append(CLASSIFICATION_CATEGORIES)
        payloads_to_hash.append(PROMPT_VARIANT_STRATEGIES)
    elif exp_type == "all": # If 'all', hash all known major data structures
        payloads_to_hash.extend([
            PICKING_PAIRS, POEMS_FOR_SCORING, TEXTS_FOR_SENTIMENT_SCORING,
            TEXTS_FOR_CRITERION_ADHERENCE_SCORING, FEW_SHOT_EXAMPLE_SETS_SCORING,
            RANKING_SETS, SHORT_ARGUMENTS_FOR_SCORING, ARGUMENT_EVALUATION_RUBRIC,
            STORY_OPENINGS_FOR_SCORING, STORY_OPENING_EVALUATION_RUBRIC,
            CLASSIFICATION_ITEMS, CLASSIFICATION_CATEGORIES, PROMPT_VARIANT_STRATEGIES
        ])


    if not payloads_to_hash:
        # This case should ideally not be hit if args.experiment is valid
        # and not 'all' without specific sub-experiment logic in main.
        # If args.experiment is a specific type, and this is hit, it implies a logic error above.
        print(f"Warning: No data payloads identified for hashing for experiment type '{exp_type}'. Defaulting to 'nohash'.")
        return "nohash"

    try:
        # Serialize to a consistent, compact JSON string
        serialized_payloads = json.dumps(payloads_to_hash, sort_keys=True, separators=(',', ':'))
        hasher = hashlib.sha256()
        hasher.update(serialized_payloads.encode('utf-8'))
        return hasher.hexdigest()[:8] # e.g., first 8 characters
    except TypeError as e:
        # This could happen if some data structure isn't JSON serializable,
        # which shouldn't be the case for the current test_data.py contents.
        print(f"Error serializing payload for hashing (experiment: {exp_type}): {e}. Payloads might contain non-serializable objects.")
        return "hash_err"

def main():
    parser = argparse.ArgumentParser(description="Run LLM bias experiments.")
    parser.add_argument(
        "experiment",
        type=str,
        choices=["picking", "scoring", "pairwise_elo", "multi_criteria", "adv_multi_criteria_permuted", "adv_multi_criteria_isolated", "classification", "all"],
        help="Which experiment to run"
    )
    parser.add_argument(
        "--model", 
        type=str, 
        help="The LLM model to use."
    )
    parser.add_argument(
        "--models",
        type=str,
        help="Comma-separated list of LLM models."
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Show (truncated) LLM raw responses."
    )
    parser.add_argument(
        "--scoring_samples",
        type=int,
        default=1,
        help="Number of items for scoring-type experiments."
    )
    parser.add_argument(
        "--scoring_type",
        type=str,
        default="all",
        choices=["poems", "sentiment", "criterion_adherence", "all"],
        help="Type of scoring to run."
    )
    parser.add_argument(
        "--task",
        type=str,
        default="argument",
        choices=["argument", "story_opening"],
        help="Task type for multi-criteria experiments."
    )
    parser.add_argument(
        "--repetitions",
        type=int,
        default=1,
        help="Number of repetitions for each LLM call."
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default=None,
        help="Directory to save experiment results as JSON files." # Changed from CSV/JSON
    )
    parser.add_argument(
        "--num_picking_pairs",
        type=int,
        default=None,
        help="Number of pairs for picking experiment."
    )
    parser.add_argument(
        "--classification_num_samples",
        type=int,
        default=0,
        help="Number of items for classification experiment (0 for all)."
    )
    parser.add_argument(
        "--classification_domain_filter",
        type=str,
        default="all",
        help="Filter classification strategies by domain_target (e.g., 'user_feedback_v1'). 'all' runs all relevant strategies."
    )
    parser.add_argument(
        "--temp",
        type=float,
        default=0.1, # Default temperature
        help="Temperature for LLM calls. Default is 0.1. This will be used for API calls and reflected in the output filename."
    )
    args = parser.parse_args()

    load_dotenv() 
    
    set_api_key(os.getenv('OPENROUTER_API_KEY'))
    
    models_to_run = []
    if args.models:
        models_to_run = [m.strip() for m in args.models.split(",") if m.strip()]
    elif args.model:
        models_to_run = [args.model.strip()]
    else:
        env_model = os.getenv('BIAS_SUITE_LLM_MODEL')
        if env_model:
            models_to_run = [env_model.strip()]
            print(f"Using BIAS_SUITE_LLM_MODEL from .env: {env_model.strip()}")
        else:
            models_to_run = [config_llm_model] # Default from config_utils
            print(f"Using hardcoded default model: {config_llm_model}")

    if not os.getenv('OPENROUTER_API_KEY'):
        print("CRITICAL: OPENROUTER_API_KEY is not set.")
        return

    print(f"Models to run: {models_to_run}")
    quiet = not args.raw

    def write_results_to_json(filepath_with_ext, data_object, model_name_for_context=None): # model_name_for_context is optional
        if not data_object:
            print(f"No data to write for {filepath_with_ext}")
            return
        
        os.makedirs(os.path.dirname(filepath_with_ext), exist_ok=True)

        with open(filepath_with_ext, 'w') as output_file:
            json.dump(data_object, output_file, indent=2, default=str)
        print(f"Results saved to {filepath_with_ext}")

    def run_for_model(model_name_to_run):
        set_llm_model(model_name_to_run)
        print(f"\n================== MODEL: {model_name_to_run} ==================")
        
        model_name_slug = re.sub(r'[^a-zA-Z0-9_.-]', '_', model_name_to_run)
        # Generate temperature suffix, e.g., 0.1 -> _temp01, 0.35 -> _temp035, 1.0 -> _temp10
        temp_str = str(args.temp)
        if '.' in temp_str:
            temp_suffix = f"_temp{temp_str.replace('.', '')}"
        else:
            temp_suffix = f"_temp{temp_str}0" # append 0 if it's a whole number like 1.0 -> 1 -> _temp10
        
        rep_suffix = f"_rep{args.repetitions}"
        timestamp_str = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        data_hash_str = generate_data_payload_hash(args)
        
        results_data = None
        current_experiment_type_for_filename = args.experiment # Default, override below
        # All outputs will be JSON
        output_extension = "json" 

        def load_multi_criteria_task_data(task_arg):
            if task_arg == "argument":
                return SHORT_ARGUMENTS_FOR_SCORING, ARGUMENT_EVALUATION_RUBRIC
            elif task_arg == "story_opening":
                return STORY_OPENINGS_FOR_SCORING, STORY_OPENING_EVALUATION_RUBRIC
            else:
                raise ValueError(f"Invalid task type: {task_arg}")

        if args.experiment == "picking":
            current_experiment_type_for_filename = "picking"
            results_data = run_positional_bias_picking_experiment(
                model_to_run_experiment_with=model_name_to_run, 
                quiet=quiet, 
                repetitions=args.repetitions,
                num_pairs_to_test=args.num_picking_pairs,
                temperature=args.temp # Pass temperature
            )
            # The `results_data` from picking experiment should now be a list of variant dicts,
            # where each dict contains a 'pairs_summary' list of pair dicts.

        elif args.experiment == "scoring":
            current_experiment_type_for_filename = "scoring"
            results_data = run_scoring_experiment(
                show_raw=args.raw, 
                quiet=quiet, 
                num_samples=args.scoring_samples, 
                repetitions=args.repetitions,
                scoring_type=args.scoring_type,
                temperature=args.temp # Pass temperature
            )

        elif args.experiment == "pairwise_elo":
            current_experiment_type_for_filename = "pairwise_elo"
            results_data = run_pairwise_elo_experiment(
                show_raw=args.raw, 
                quiet=quiet, 
                repetitions=args.repetitions,
                temperature=args.temp # Pass temperature
            )

        elif args.experiment == "multi_criteria":
            current_experiment_type_for_filename = f"multi_criteria_{args.task}"
            task_data, task_rubric = load_multi_criteria_task_data(args.task)
            results_data = run_multi_criteria_experiment(
                data_list=task_data,
                rubric_dict=task_rubric,
                task_name=args.task.capitalize(),
                show_raw=args.raw,
                quiet=quiet,
                num_samples=args.scoring_samples,
                repetitions=args.repetitions,
                temperature=args.temp # Pass temperature
            )

        elif args.experiment == "adv_multi_criteria_permuted":
            current_experiment_type_for_filename = f"adv_multi_criteria_permuted_{args.task}"
            task_data, task_rubric = load_multi_criteria_task_data(args.task)
            results_data = run_permuted_order_multi_criteria_experiment(
                data_list=task_data,
                rubric_dict=task_rubric,
                task_name=args.task.capitalize(),
                show_raw=args.raw,
                quiet=quiet,
                num_samples=args.scoring_samples,
                repetitions=args.repetitions,
                temperature=args.temp # Pass temperature
            )

        elif args.experiment == "adv_multi_criteria_isolated":
            current_experiment_type_for_filename = f"adv_multi_criteria_isolated_{args.task}"
            task_data, task_rubric = load_multi_criteria_task_data(args.task)
            permuted_data_for_isolated = None # Logic to load this remains if needed, but now loads JSON
            if args.output_dir:
                 perm_json_path = os.path.join(args.output_dir, f"adv_multi_criteria_permuted_{args.task}_results_{model_name_slug}{temp_suffix}{rep_suffix}.json") # Expect .json, add temp_suffix and rep_suffix
                 if os.path.exists(perm_json_path):
                    try:
                        with open(perm_json_path, 'r') as f_perm:
                            permuted_data_for_isolated = json.load(f_perm)
                        if not quiet: print(f"Loaded permuted data ({args.task}) from {perm_json_path} for holistic comparison.")
                    except Exception as e:
                        if not quiet: print(f"Could not load permuted results ({args.task}) from {perm_json_path}: {e}")
            
            results_data = run_isolated_criterion_scoring_experiment(
                data_list=task_data,
                rubric_dict=task_rubric,
                task_name=args.task.capitalize(),
                show_raw=args.raw,
                quiet=quiet,
                num_samples=args.scoring_samples,
                repetitions=args.repetitions,
                holistic_comparison_data=permuted_data_for_isolated,
                temperature=args.temp # Pass temperature
            )

        elif args.experiment == "classification":
            current_experiment_type_for_filename = "classification"
            
            strategies_to_run = PROMPT_VARIANT_STRATEGIES
            if args.classification_domain_filter != "all":
                strategies_to_run = [
                    s for s in PROMPT_VARIANT_STRATEGIES 
                    if s.get("domain_target") == args.classification_domain_filter
                ]
                if not quiet:
                    print(f"Filtered to {len(strategies_to_run)} strategies for domain: {args.classification_domain_filter}")
            if not strategies_to_run:
                print(f"Warning: No classification strategies found for domain filter '{args.classification_domain_filter}'. Skipping classification experiment.")
                results_data = []
            else:
                results_data = run_classification_experiment(
                    classification_items=CLASSIFICATION_ITEMS,
                    category_sets=CLASSIFICATION_CATEGORIES,
                    prompt_variant_strategies=strategies_to_run,
                    show_raw=args.raw,
                    quiet=quiet,
                    num_samples=args.classification_num_samples,
                    repetitions=args.repetitions,
                    temperature=args.temp # Pass temperature
                )

        elif args.experiment == "all":
            experiments_to_execute = [
                ("PICKING EXPERIMENT", lambda: (
                    run_positional_bias_picking_experiment(model_to_run_experiment_with=model_name_to_run, quiet=quiet, repetitions=args.repetitions, num_pairs_to_test=args.num_picking_pairs, temperature=args.temp), 
                    "picking"
                )),
                ("SCORING EXPERIMENT", lambda: (
                    run_scoring_experiment(show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, scoring_type=args.scoring_type, temperature=args.temp), 
                    "scoring"
                )),
                ("PAIRWISE ELO EXPERIMENT", lambda: (
                    run_pairwise_elo_experiment(show_raw=args.raw, quiet=quiet, repetitions=args.repetitions, temperature=args.temp),
                    "pairwise_elo"
                )),
                ("MULTI_CRITERIA (Argument)", lambda: (
                    run_multi_criteria_experiment(data_list=SHORT_ARGUMENTS_FOR_SCORING, rubric_dict=ARGUMENT_EVALUATION_RUBRIC, task_name="Argument", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, temperature=args.temp), 
                    "multi_criteria_argument"
                )),
                ("MULTI_CRITERIA (Story Opening)", lambda: (
                    run_multi_criteria_experiment(data_list=STORY_OPENINGS_FOR_SCORING, rubric_dict=STORY_OPENING_EVALUATION_RUBRIC, task_name="StoryOpening", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, temperature=args.temp),
                    "multi_criteria_story_opening"
                )),
                ("ADVANCED: PERMUTED ORDER (Argument)", lambda: (
                    run_permuted_order_multi_criteria_experiment(data_list=SHORT_ARGUMENTS_FOR_SCORING, rubric_dict=ARGUMENT_EVALUATION_RUBRIC, task_name="Argument", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, temperature=args.temp), 
                    "adv_multi_criteria_permuted_argument"
                )),
                 ("ADVANCED: PERMUTED ORDER (Story Opening)", lambda: (
                    run_permuted_order_multi_criteria_experiment(data_list=STORY_OPENINGS_FOR_SCORING, rubric_dict=STORY_OPENING_EVALUATION_RUBRIC, task_name="StoryOpening", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, temperature=args.temp),
                    "adv_multi_criteria_permuted_story_opening"
                ))
            ]
            all_permuted_results_temp_store = {}
            for description, experiment_lambda in tqdm(experiments_to_execute, desc=f"Experiments for {model_name_slug}", leave=False):
                if not quiet: print(f"\n========== {description} ==========")
                exp_results, exp_type_slug = experiment_lambda()
                
                if exp_type_slug.startswith("adv_multi_criteria_permuted_"):
                    task_name_from_type = exp_type_slug.replace("adv_multi_criteria_permuted_", "")
                    all_permuted_results_temp_store[task_name_from_type] = exp_results
                
                if args.output_dir and exp_results:
                    filename = f"{exp_type_slug}_results_{model_name_slug}{temp_suffix}{rep_suffix}.json" # Always .json, add temp_suffix and rep_suffix
                    filepath = os.path.join(args.output_dir, filename)
                    write_results_to_json(filepath, exp_results)

            isolated_experiments_to_run = [
                ("ADVANCED: ISOLATED CRITERION (Argument)", "argument", SHORT_ARGUMENTS_FOR_SCORING, ARGUMENT_EVALUATION_RUBRIC),
                ("ADVANCED: ISOLATED CRITERION (Story Opening)", "story_opening", STORY_OPENINGS_FOR_SCORING, STORY_OPENING_EVALUATION_RUBRIC)
            ]
            for iso_desc, iso_task_name, iso_data, iso_rubric in isolated_experiments_to_run:
                if not quiet: print(f"\n========== {iso_desc} ==========")
                exp_type_isolated = f"adv_multi_criteria_isolated_{iso_task_name}"
                adv_permuted_results_for_isolated = all_permuted_results_temp_store.get(iso_task_name) 
                if not adv_permuted_results_for_isolated and args.output_dir:
                    perm_json_path = os.path.join(args.output_dir, f"adv_multi_criteria_permuted_{iso_task_name}_results_{model_name_slug}{temp_suffix}{rep_suffix}.json") # add temp_suffix and rep_suffix
                    if os.path.exists(perm_json_path):
                        try:
                            with open(perm_json_path, 'r') as f_perm: loaded_data = json.load(f_perm)
                            adv_permuted_results_for_isolated = loaded_data
                        except Exception as e:
                            if not quiet: print(f"Could not load permuted results for {iso_task_name} isolated exp: {e}")

                adv_isolated_results = run_isolated_criterion_scoring_experiment(
                    data_list=iso_data, rubric_dict=iso_rubric, task_name=iso_task_name.capitalize(),
                    show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, 
                    holistic_comparison_data=adv_permuted_results_for_isolated,
                    temperature=args.temp # Pass temperature
                )
                if args.output_dir and adv_isolated_results:
                    filepath = os.path.join(args.output_dir, f"{exp_type_isolated}_results_{model_name_slug}{temp_suffix}{rep_suffix}.json") # add temp_suffix and rep_suffix
                    write_results_to_json(filepath, adv_isolated_results)
            
            classification_strategies_for_all = PROMPT_VARIANT_STRATEGIES
            classification_results_all = run_classification_experiment(
                classification_items=CLASSIFICATION_ITEMS,
                category_sets=CLASSIFICATION_CATEGORIES,
                prompt_variant_strategies=classification_strategies_for_all,
                show_raw=args.raw,
                quiet=quiet,
                num_samples=args.classification_num_samples,
                repetitions=args.repetitions,
                temperature=args.temp # Pass temperature
            )
            if args.output_dir and classification_results_all:
                filename_class_all = f"classification_results_{model_name_slug}{temp_suffix}{rep_suffix}.json" # add temp_suffix and rep_suffix
                filepath_class_all = os.path.join(args.output_dir, filename_class_all)
                write_results_to_json(filepath_class_all, classification_results_all)
            return 
        else: 
            print(f"Unknown experiment: {args.experiment}")
            parser.print_help()
            exit(1)
        
        if args.output_dir and results_data is not None:
            # Construct filename with timestamp and data hash
            filename = f"{current_experiment_type_for_filename}_{timestamp_str}_{data_hash_str}_{model_name_slug}{temp_suffix}{rep_suffix}.{output_extension}"
            filepath = os.path.join(args.output_dir, filename)
            write_results_to_json(filepath, results_data)

    for model_name in tqdm(models_to_run, desc="Running experiments", unit="model"):
        model_specific_results = run_for_model(model_name) # Renamed model_name var

if __name__ == "__main__":
    main() 