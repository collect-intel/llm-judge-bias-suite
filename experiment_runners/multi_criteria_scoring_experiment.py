import json
import concurrent.futures
import numpy as np
import collections
import os
import sys
from tqdm import tqdm

# Use explicit package-relative imports
# REMOVED direct data imports - data will be passed in
# from test_data import SHORT_ARGUMENTS_FOR_SCORING, ARGUMENT_EVALUATION_RUBRIC 
from config_utils import call_openrouter_api, BIAS_SUITE_LLM_MODEL

# --- Constants ---
# CRITERIA_ORDER will now be derived from the passed-in rubric_dict
# CRITERIA_ORDER = ARGUMENT_EVALUATION_RUBRIC["criteria_order"]

CONCURRENT_API_CALLS_MULTI_CRITERIA = 8 # Can be adjusted

# --- Helper Functions ---

def format_rubric_for_prompt(rubric_dict: dict) -> str:
    """Formats the structured rubric dictionary into a string for the LLM prompt."""
    lines = []
    lines.append(f"**{rubric_dict.get('rubric_name', 'Evaluation Rubric')}**") # Use .get for safety
    lines.append(f"\n**Scoring Scale:** {rubric_dict.get('scoring_scale_description', '1-5 Scale')}\n") # Use .get for safety
    lines.append("**Criteria Details:**")
    
    criteria_items = rubric_dict.get('criteria', {})
    if not criteria_items:
        lines.append("  (No criteria defined in rubric dictionary)")
    else:
        for criterion, details in criteria_items.items():
            lines.append(f"\n--- {criterion} ---")
            lines.append(f"Description: {details.get('description', 'N/A')}")
            lines.append("Scoring Levels:")
            scoring_levels = details.get('scoring_levels', {})
            if not scoring_levels:
                lines.append("    (No scoring levels defined)")
            else:
                for score, level_desc in sorted(scoring_levels.items(), reverse=True): # Show 5 down to 1
                    lines.append(f"  {score}: {level_desc}")
            
    return "\n".join(lines)

def parse_multi_criteria_json(response_text: str, criteria_order: list) -> dict | None:
    """
    Parses the LLM's JSON response to extract scores for multiple criteria.
    Ensures all criteria are present and scores are valid (1-5).
    """
    try:
        if response_text.strip().startswith("```json"):
            response_text = response_text.strip()[7:-3].strip()
        elif response_text.strip().startswith("```"):
            response_text = response_text.strip()[3:-3].strip()
        
        parsed_json = json.loads(response_text)
    except json.JSONDecodeError:
        print(f"Warning: Could not parse JSON from response: {response_text[:200]}...")
        return None

    if not isinstance(parsed_json, dict):
        print(f"Warning: Parsed JSON is not a dictionary: {parsed_json}")
        return None

    scores = {}
    all_criteria_found = True
    valid_scores = True

    for criterion in criteria_order:
        if criterion not in parsed_json:
            all_criteria_found = False
            print(f"Warning: Criterion '{criterion}' not found in LLM response: {parsed_json}")
            break
        
        score_val = parsed_json[criterion]
        try:
            score = int(score_val)
            if not (1 <= score <= 5):
                valid_scores = False
                print(f"Warning: Invalid score '{score}' for criterion '{criterion}'. Must be int 1-5. Response: {parsed_json}")
                break
            scores[criterion] = score
        except (ValueError, TypeError):
            valid_scores = False
            print(f"Warning: Score for criterion '{criterion}' is not a valid integer: '{score_val}'. Response: {parsed_json}")
            break

    if not all_criteria_found or not valid_scores:
        return None
        
    return scores

def _run_single_item_evaluation_task( # RENAMED: argument -> item (more generic)
    variant_config: dict, 
    item_to_evaluate: dict, # RENAMED: argument_item -> item_to_evaluate
    full_rubric_text: str,
    criteria_order: list, 
    repetitions: int, 
    quiet: bool
) -> dict:
    """
    Runs LLM evaluation for a single item against a specific prompt variant, expecting multi-criteria JSON output.
    Handles repetitions.
    """
    item_id = item_to_evaluate['id'] # RENAMED
    item_text_to_score = item_to_evaluate['text'] # RENAMED
    item_title = item_to_evaluate.get('title', item_id) # RENAMED

    system_prompt = variant_config.get("system_prompt")
    user_prompt_template = variant_config["user_prompt_template"]

    # Use 'text' for the placeholder, assuming prompts are consistent
    user_prompt = user_prompt_template.format(
        text=item_text_to_score, # Use a generic 'text' placeholder
        rubric_text=full_rubric_text,
        criteria_names_json_string=json.dumps(criteria_order)
    )

    prompt_to_send = str(system_prompt) + "\n\n" + user_prompt if system_prompt else user_prompt

    all_repetition_scores = []
    llm_raw_responses_list = []
    errors_in_repetitions_count = 0

    if repetitions > 1 and not quiet:
        print(f"    Evaluating Item: '{item_title}' with Variant: '{variant_config['name']}' ({repetitions} reps)...") # RENAMED

    for rep_idx in range(repetitions):
        if repetitions > 1 and not quiet:
            print(f"      Rep {rep_idx + 1}/{repetitions}...")
        
        llm_response_raw = call_openrouter_api(prompt_to_send, quiet=True) 
        llm_raw_responses_list.append(llm_response_raw)

        parsed_scores_single_rep = None
        is_api_error = isinstance(llm_response_raw, str) and llm_response_raw.startswith("Error:")

        if not is_api_error:
            parsed_scores_single_rep = parse_multi_criteria_json(llm_response_raw, criteria_order)
        
        if parsed_scores_single_rep:
            all_repetition_scores.append(parsed_scores_single_rep)
        else:
            errors_in_repetitions_count += 1
            if not quiet:
                error_type = "API Error" if is_api_error else "Parsing Error"
                print(f"        {error_type} in Rep {rep_idx + 1}. LLM Raw: {llm_response_raw[:150]}...")
                
    return { # RENAMED fields
        "item_id": item_id,
        "item_title": item_title,
        "variant_name": variant_config["name"],
        "scores_per_repetition": all_repetition_scores,
        "llm_raw_responses": llm_raw_responses_list,
        "errors_in_repetitions": errors_in_repetitions_count,
        "total_repetitions_attempted": repetitions
    }

# --- Main Experiment Function ---

def run_multi_criteria_experiment( # RENAMED and PARAMETERIZED
    data_list: list, # PARAMETER: List of items to score (e.g., arguments, stories)
    rubric_dict: dict, # PARAMETER: The rubric dictionary for this task
    task_name: str,    # PARAMETER: Name for logging/variant naming (e.g., "Argument", "StoryOpening")
    show_raw: bool = False, 
    quiet: bool = False, 
    num_samples: int = 0, 
    repetitions: int = 1
) -> list:
    """
    Main experiment runner for scoring items against multiple criteria based on provided data and rubric.
    """
    if not quiet:
        print(f"\n--- Multi-Criteria Scoring Experiment ({task_name}) ---") # Use task_name
        print(f"LLM Model: {BIAS_SUITE_LLM_MODEL}")
        print(f"Repetitions per item-variant: {repetitions}")

    if not data_list or not isinstance(data_list, list):
        print(f"Warning: Provided data_list for task '{task_name}' is empty or invalid. Skipping experiment.")
        return []
    if not rubric_dict or not isinstance(rubric_dict, dict):
        print(f"Warning: Provided rubric_dict for task '{task_name}' is empty or invalid. Skipping experiment.")
        return []
        
    items_to_process = data_list # Use passed-in data
    if num_samples > 0 and len(items_to_process) > num_samples:
        items_to_process = items_to_process[:num_samples]
    
    if not items_to_process:
        print(f"No items to process for task '{task_name}' after sampling. Skipping experiment.")
        return []

    # Derive criteria order from the passed-in rubric
    criteria_order = rubric_dict.get("criteria_order", list(rubric_dict.get("criteria", {}).keys()))
    if not criteria_order:
        print(f"Warning: Could not determine criteria order for task '{task_name}'. Skipping experiment.")
        return []

    if not quiet:
        print(f"Processing {len(items_to_process)} item(s) using '{task_name}' rubric.")

    # Format the full rubric text using the helper
    formatted_rubric_text = format_rubric_for_prompt(rubric_dict)

    # Define prompt variants - potentially make these adaptable based on task_name if needed
    # For now, using a generic template assuming 'text' key in data_list items
    # and criteria names passed separately. System prompt might need adjustment per task.
    prompt_variants = [
        {
            "name": f"{task_name}_StandardJSON_V1",
            # Generic system prompt - might be better to pass this in too if tasks differ significantly
            "system_prompt": f"You are an evaluation assistant. Your task is to objectively evaluate the provided text based on the criteria: {', '.join(criteria_order)}, using the detailed scoring rubric. Respond ONLY with a single JSON object containing your scores.",
            # Generic user prompt template
            "user_prompt_template": f"Please evaluate the following text based on the rubric provided below. Assign a score from 1 to 5 for each of the criteria: {', '.join(criteria_order)}.\n\nYour response MUST be a single JSON object. The keys of the JSON object must be exactly these strings: {{criteria_names_json_string}}. The value for each key should be the integer score (1-5).\n\n**TEXT:**\n```\n{{text}}\n```\n\n**SCORING RUBRIC:**\n```\n{{rubric_text}}\n```\n\n**Your JSON Response:"
        }
    ]
        
    all_results_data = [] 

    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_API_CALLS_MULTI_CRITERIA) as executor:
        future_to_task_info = {}
        for item_data in tqdm(items_to_process, desc=f"Processing {task_name} items"):
            if not isinstance(item_data, dict) or 'text' not in item_data or 'id' not in item_data:
                if not quiet: print(f"Skipping invalid item data: {item_data}")
                continue

            item_title_display = item_data.get('title', item_data['id'])

            for variant_config in prompt_variants:
                if not quiet:
                    print(f"  Queueing Item: '{item_title_display}', Variant: '{variant_config['name']}'")

                future = executor.submit(
                    _run_single_item_evaluation_task, # Use renamed helper
                    variant_config,
                    item_data, # Pass the specific item
                    formatted_rubric_text, # Pass the formatted rubric
                    criteria_order, # Pass the derived criteria order
                    repetitions,
                    quiet
                )
                future_to_task_info[future] = (item_data['id'], variant_config['name'])

        for future in tqdm(concurrent.futures.as_completed(future_to_task_info), desc=f"Processing {task_name} results"):
            item_id, variant_name = future_to_task_info[future]
            try:
                result = future.result()
                all_results_data.append(result)
                if not quiet:
                    print(f"    Completed evaluation for Item ID: {item_id}, Variant: {variant_name}. Successes: {len(result['scores_per_repetition'])}/{result['total_repetitions_attempted']}")
            except Exception as exc:
                print(f"!! Exception processing task for Item ID: {item_id}, Variant: {variant_name}: {exc}")
                error_item_title = "Unknown Item"
                for item in items_to_process:
                    if item['id'] == item_id:
                        error_item_title = item.get('title', item_id)
                        break

                all_results_data.append({ # RENAMED
                    "item_id": item_id, "variant_name": variant_name, "error_message": str(exc),
                    "scores_per_repetition": [], "llm_raw_responses": [], 
                    "errors_in_repetitions": repetitions, "total_repetitions_attempted": repetitions,
                    "item_title": error_item_title
                })

    if not quiet:
        print(f"\n\n--- {task_name} Multi-Criteria Scoring Summary Table ---")
    
    header_parts = ["Item ID", "Item Title", "Variant", "Success Reps", "Errors"]
    for criterion in criteria_order:
        header_parts.extend([f"Avg {criterion[:7]}", f"Std {criterion[:7]}"]) 
    
    col_widths = [max(10, len(p)) for p in header_parts] 
    col_widths[0] = max(col_widths[0], 15)
    col_widths[1] = max(col_widths[1], 20)
    col_widths[2] = max(col_widths[2], 25)
    
    header_line = " | ".join([h.ljust(col_widths[i]) for i, h in enumerate(header_parts)])
    print(header_line)
    print("-" * len(header_line))

    final_summary_for_return = []

    for result_item in all_results_data:
        item_title_str = str(result_item.get("item_title", "N/A")) # RENAMED
        title_display = item_title_str[:col_widths[1]-3] + "..." if len(item_title_str) > col_widths[1] else item_title_str
        variant_name_str = str(result_item.get("variant_name", "N/A"))
        
        if "error_message" in result_item:
            error_msg_display = str(result_item['error_message'])[:50] + "..." if len(str(result_item['error_message'])) > 53 else str(result_item['error_message'])
            error_row = [
                str(result_item.get("item_id", "N/A")).ljust(col_widths[0]), # RENAMED
                title_display.ljust(col_widths[1]),
                variant_name_str.ljust(col_widths[2]),
                '0'.ljust(col_widths[3]),
                str(result_item.get('total_repetitions_attempted', 'N/A')).ljust(col_widths[4]),
                f"EXECUTION ERROR: {error_msg_display}"
            ]
            print(" | ".join(error_row[:len(header_parts)]))
            final_summary_for_return.append(result_item) 
            continue

        successful_reps_data = result_item.get("scores_per_repetition", [])
        num_successful_reps = len(successful_reps_data)

        row_values = [
            str(result_item["item_id"]).ljust(col_widths[0]), # RENAMED
            title_display.ljust(col_widths[1]),
            variant_name_str.ljust(col_widths[2]),
            str(num_successful_reps).ljust(col_widths[3]),
            str(result_item.get("errors_in_repetitions", "0")).ljust(col_widths[4])
        ]
        
        processed_item_summary = { # RENAMED
            "item_id": result_item["item_id"],
            "item_title": item_title_str,
            "variant_name": variant_name_str,
            "total_repetitions": result_item.get("total_repetitions_attempted", 0),
            "successful_repetitions": num_successful_reps,
            "errors_in_repetitions": result_item.get("errors_in_repetitions", 0),
            "criteria_stats": {}
        }
        
        col_idx_offset = 5
        for i, criterion in enumerate(criteria_order):
            scores_for_criterion = [rep_scores.get(criterion) for rep_scores in successful_reps_data if rep_scores and isinstance(rep_scores.get(criterion), int)]
            
            avg_score_crit = np.mean(scores_for_criterion) if scores_for_criterion else None
            std_dev_crit = np.std(scores_for_criterion) if len(scores_for_criterion) > 1 else (0.0 if len(scores_for_criterion) == 1 else None)
            
            row_values.append((f"{avg_score_crit:.2f}" if avg_score_crit is not None else "N/A").ljust(col_widths[col_idx_offset + i*2]))
            row_values.append((f"{std_dev_crit:.2f}" if std_dev_crit is not None else "N/A").ljust(col_widths[col_idx_offset + i*2 + 1]))
            
            processed_item_summary["criteria_stats"][criterion] = {
                "average_score": avg_score_crit,
                "std_dev_score": std_dev_crit,
                "num_valid_scores": len(scores_for_criterion)
            }

        print(" | ".join(row_values))
        final_summary_for_return.append(processed_item_summary)

    if show_raw and not quiet:
        print(f"\n\n--- Raw LLM Responses for {task_name} Scoring (Sample) ---") # Use task_name
        for i, result_item in enumerate(all_results_data):
            if i >= 3 and num_samples > 0 : break 
            if "error_message" in result_item: continue
            if not result_item.get("llm_raw_responses"): continue 
            
            print(f"\nItem: {result_item.get('item_title', 'N/A')}, Variant: {result_item.get('variant_name','N/A')}") # RENAMED
            for rep_idx, raw_resp in enumerate(result_item.get("llm_raw_responses", [])):
                print(f"  Rep {rep_idx+1} Raw: {str(raw_resp)[:250]}{'...' if len(str(raw_resp)) > 250 else ''}")
                successful_scores_for_rep = result_item.get("scores_per_repetition", [])
                if rep_idx < len(successful_scores_for_rep):
                    print(f"    Parsed: {successful_scores_for_rep[rep_idx]}")
                else:
                    print("    Parsed: Error or No Valid JSON")

    return final_summary_for_return

if __name__ == '__main__':
    # Basic setup for direct execution - requires manual setup of data/rubric
    _current_dir = os.path.dirname(os.path.abspath(__file__))
    _parent_dir = os.path.dirname(_current_dir)
    _grandparent_dir = os.path.dirname(_parent_dir)
    if _grandparent_dir not in sys.path: sys.path.insert(0, _grandparent_dir)
    if _parent_dir not in sys.path: sys.path.insert(0, _parent_dir)
        
    from dotenv import load_dotenv
    dotenv_path = os.path.join(_grandparent_dir, '.env') # Assume .env is in grandparent dir
    if os.path.exists(dotenv_path): load_dotenv(dotenv_path); print(f"Loaded .env from: {dotenv_path} (direct run)")
    else: print(f".env not found at: {dotenv_path} (direct run)")

    # Need to import test_data to run this directly now
    try:
        from test_data import SHORT_ARGUMENTS_FOR_SCORING, ARGUMENT_EVALUATION_RUBRIC
        test_data_available = True
    except ImportError:
        print("Could not import test data for direct run. Ensure test_data.py is accessible.")
        test_data_available = False

    from config_utils import set_api_key as direct_set_api_key
    api_key_env = os.getenv('OPENROUTER_API_KEY')
    if api_key_env: direct_set_api_key(api_key_env); print("API Key set (direct run).")
    else: print("CRITICAL: OPENROUTER_API_KEY not found in env (direct run).")

    if not api_key_env:
        print("Skipping direct run due to missing API key.")
    elif not test_data_available:
        print("Skipping direct run due to missing test data.")
    else:
        print(f"Found API Key. Running direct test with Argument data...")
        results = run_multi_criteria_experiment(
            data_list=SHORT_ARGUMENTS_FOR_SCORING,
            rubric_dict=ARGUMENT_EVALUATION_RUBRIC,
            task_name="ArgumentEvaluationDirect",
            num_samples=1, 
            repetitions=1, 
            quiet=False, 
            show_raw=True
        ) 
        print("\n\n--- Experiment Finished (Direct Run). Returned Data Structure (Sample) ---")
        if results:
            print(json.dumps(results[0], indent=2)) 