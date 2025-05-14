import os
# import csv # No longer needed for primary output
import re
from dotenv import load_dotenv
import argparse
import json
from tqdm import tqdm

# Import experiment runners
from experiment_runners.picking_experiments import run_positional_bias_picking_experiment
from experiment_runners.scoring_experiments import run_scoring_experiment
from experiment_runners.pairwise_elo_experiment import run_pairwise_elo_experiment
from experiment_runners.multi_criteria_scoring_experiment import run_multi_criteria_experiment
from experiment_runners.advanced_multi_criteria_experiment import run_permuted_order_multi_criteria_experiment, run_isolated_criterion_scoring_experiment
# from bias_suite.experiment_runners.scoring_experiments import run_poem_scoring_experiment # Assuming you'll move it

# Import shared config and functions
from config_utils import set_api_key, set_llm_model, BIAS_SUITE_LLM_MODEL as config_llm_model, call_openrouter_api

# Import the new HTML report generator
from html_report_generator import generate_html_report

# Import test data for dynamic loading
from test_data import (
    SHORT_ARGUMENTS_FOR_SCORING,
    ARGUMENT_EVALUATION_RUBRIC,
    STORY_OPENINGS_FOR_SCORING,
    STORY_OPENING_EVALUATION_RUBRIC
)

# --- Configuration (now minimal, mostly handled in config_utils) ---
# SAMPLE_POEM and SCORING_CRITERION would move if run_poem_scoring_experiment moves

# call_openrouter_api IS NOW IN config_utils.py

# parse_score, normalize_score, run_poem_scoring_experiment should ideally move to a scoring_experiments.py
# For now, if you want to run poem scoring, you'd need to ensure call_openrouter_api is available to it,
# perhaps by passing it or importing it there from config_utils too.

def main():
    parser = argparse.ArgumentParser(description="Run LLM bias experiments.")
    parser.add_argument(
        "experiment",
        type=str,
        choices=["picking", "scoring", "pairwise_elo", "multi_criteria", "adv_multi_criteria_permuted", "adv_multi_criteria_isolated", "all"],
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
        "--html_report", # Keep for now, can be removed later if fully superseded by viewer
        type=str,
        default=None,
        help="File path to save a consolidated HTML report."
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
    all_models_results_for_html_report = {}

    def write_results_to_json(filepath_with_ext, data_object, model_name_for_context=None): # model_name_for_context is optional
        if not data_object:
            print(f"No data to write for {filepath_with_ext}")
            return
        
        os.makedirs(os.path.dirname(filepath_with_ext), exist_ok=True)

        # The main data_object should be structured correctly by the experiment runners.
        # Adding model_name into the JSON file itself can be redundant if filename contains it,
        # but might be useful if the file is ever separated from its context.
        # For viewer app, filename parsing will provide model context.
        # Let's ensure data_object is the primary content.
        
        # If data_object is a list and model_name_for_context is provided,
        # we could add model_name to each item, but this should ideally be handled
        # by the experiment runner if desired in the output structure.
        # For now, write data_object as is.

        with open(filepath_with_ext, 'w') as output_file:
            json.dump(data_object, output_file, indent=2)
        print(f"Results saved to {filepath_with_ext}")

    def run_for_model(model_name_to_run):
        set_llm_model(model_name_to_run)
        print(f"\n================== MODEL: {model_name_to_run} ==================")
        
        model_name_slug = re.sub(r'[^a-zA-Z0-9_.-]', '_', model_name_to_run)
        model_results_for_html = {} # For collecting results for this model if HTML report needed
        
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
                quiet=quiet, 
                repetitions=args.repetitions,
                num_pairs_to_test=args.num_picking_pairs
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
                scoring_type=args.scoring_type
            )

        elif args.experiment == "pairwise_elo":
            current_experiment_type_for_filename = "pairwise_elo"
            results_data = run_pairwise_elo_experiment(show_raw=args.raw, quiet=quiet, repetitions=args.repetitions)

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
                repetitions=args.repetitions
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
                repetitions=args.repetitions
            )

        elif args.experiment == "adv_multi_criteria_isolated":
            current_experiment_type_for_filename = f"adv_multi_criteria_isolated_{args.task}"
            task_data, task_rubric = load_multi_criteria_task_data(args.task)
            permuted_data_for_isolated = None # Logic to load this remains if needed, but now loads JSON
            if args.output_dir:
                 perm_json_path = os.path.join(args.output_dir, f"adv_multi_criteria_permuted_{args.task}_results_{model_name_slug}.json") # Expect .json
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
                holistic_comparison_data=permuted_data_for_isolated
            )

        elif args.experiment == "all":
            experiments_to_execute = [
                ("PICKING EXPERIMENT", lambda: (
                    run_positional_bias_picking_experiment(quiet=quiet, repetitions=args.repetitions, num_pairs_to_test=args.num_picking_pairs), 
                    "picking"
                )),
                ("SCORING EXPERIMENT", lambda: (
                    run_scoring_experiment(show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, scoring_type=args.scoring_type), 
                    "scoring"
                )),
                ("PAIRWISE ELO EXPERIMENT", lambda: (
                    run_pairwise_elo_experiment(show_raw=args.raw, quiet=quiet, repetitions=args.repetitions),
                    "pairwise_elo"
                )),
                ("MULTI_CRITERIA (Argument)", lambda: (
                    run_multi_criteria_experiment(data_list=SHORT_ARGUMENTS_FOR_SCORING, rubric_dict=ARGUMENT_EVALUATION_RUBRIC, task_name="Argument", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions), 
                    "multi_criteria_argument"
                )),
                ("MULTI_CRITERIA (Story Opening)", lambda: (
                    run_multi_criteria_experiment(data_list=STORY_OPENINGS_FOR_SCORING, rubric_dict=STORY_OPENING_EVALUATION_RUBRIC, task_name="StoryOpening", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions),
                    "multi_criteria_story_opening"
                )),
                ("ADVANCED: PERMUTED ORDER (Argument)", lambda: (
                    run_permuted_order_multi_criteria_experiment(data_list=SHORT_ARGUMENTS_FOR_SCORING, rubric_dict=ARGUMENT_EVALUATION_RUBRIC, task_name="Argument", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions), 
                    "adv_multi_criteria_permuted_argument"
                )),
                 ("ADVANCED: PERMUTED ORDER (Story Opening)", lambda: (
                    run_permuted_order_multi_criteria_experiment(data_list=STORY_OPENINGS_FOR_SCORING, rubric_dict=STORY_OPENING_EVALUATION_RUBRIC, task_name="StoryOpening", show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions),
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
                
                if args.html_report: model_results_for_html[exp_type_slug] = exp_results
                if args.output_dir and exp_results:
                    filename = f"{exp_type_slug}_results_{model_name_slug}.json" # Always .json
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
                    perm_json_path = os.path.join(args.output_dir, f"adv_multi_criteria_permuted_{iso_task_name}_results_{model_name_slug}.json")
                    if os.path.exists(perm_json_path):
                        try:
                            with open(perm_json_path, 'r') as f_perm: loaded_data = json.load(f_perm)
                            adv_permuted_results_for_isolated = loaded_data
                        except Exception as e:
                            if not quiet: print(f"Could not load permuted results for {iso_task_name} isolated exp: {e}")

                adv_isolated_results = run_isolated_criterion_scoring_experiment(
                    data_list=iso_data, rubric_dict=iso_rubric, task_name=iso_task_name.capitalize(),
                    show_raw=args.raw, quiet=quiet, num_samples=args.scoring_samples, repetitions=args.repetitions, 
                    holistic_comparison_data=adv_permuted_results_for_isolated
                )
                if args.html_report: model_results_for_html[exp_type_isolated] = adv_isolated_results
                if args.output_dir and adv_isolated_results:
                    filepath = os.path.join(args.output_dir, f"{exp_type_isolated}_results_{model_name_slug}.json")
                    write_results_to_json(filepath, adv_isolated_results)
            
            if args.html_report: return model_results_for_html 
            return 
        else: # Should not be reached if choices are enforced
            print(f"Unknown experiment: {args.experiment}")
            parser.print_help()
            exit(1)
        
        # After a specific (non-'all') experiment is run
        if args.html_report and results_data is not None:
             model_results_for_html[current_experiment_type_for_filename] = results_data
        
        if args.output_dir and results_data is not None:
            filename = f"{current_experiment_type_for_filename}_results_{model_name_slug}.{output_extension}" # .json
            filepath = os.path.join(args.output_dir, filename)
            write_results_to_json(filepath, results_data)

        if args.html_report:
            return model_results_for_html

    for model_name in tqdm(models_to_run, desc="Running experiments", unit="model"):
        model_specific_results = run_for_model(model_name) # Renamed model_name var
        if args.html_report and model_specific_results:
            all_models_results_for_html_report[model_name] = model_specific_results

    if args.html_report and all_models_results_for_html_report:
        output_html_path = args.html_report
        if args.output_dir and not os.path.isabs(output_html_path):
            os.makedirs(args.output_dir, exist_ok=True)
            output_html_path = os.path.join(args.output_dir, output_html_path)
        
        print(f"\nGenerating HTML report at: {output_html_path}")
        report_dir = os.path.dirname(output_html_path)
        if report_dir: os.makedirs(report_dir, exist_ok=True)
        generate_html_report(all_models_results_for_html_report, output_html_path, args)
        print("HTML report generation complete.")

if __name__ == "__main__":
    main() 