import json
import concurrent.futures
import numpy as np
import collections
import os
import sys
import random
import re
from tqdm import tqdm

from config_utils import call_openrouter_api, BIAS_SUITE_LLM_MODEL
from .multi_criteria_scoring_experiment import (
    format_rubric_for_prompt, 
    parse_multi_criteria_json
)

CONCURRENT_API_CALLS_ADVANCED = 8

# --- Helper: _run_single_item_evaluation_task (adapted from previous _run_single_argument_evaluation_task) ---
def _run_single_item_evaluation_task_advanced(
    prompt_variant_config: dict,
    item_to_evaluate: dict, 
    full_rubric_text: str, 
    current_criteria_order_for_prompt: list,
    repetitions: int, 
    quiet: bool,
    temperature: float
) -> dict:
    """
    Runs LLM evaluation for a single item against a specific prompt variant (which defines criteria order).
    Expects multi-criteria JSON output. Handles repetitions. For advanced experiments.
    """
    item_id = item_to_evaluate['id']
    item_title = item_to_evaluate.get('title', item_id)
    item_text_to_score = item_to_evaluate['text']
    
    system_prompt_text = prompt_variant_config.get("system_prompt")
    user_prompt_template_text = prompt_variant_config["user_prompt_template"]

    criteria_names_list_str = ", ".join(current_criteria_order_for_prompt)

    user_prompt = user_prompt_template_text.format(
        text=item_text_to_score,
        rubric_text=full_rubric_text,
        criteria_names_json_string=json.dumps(current_criteria_order_for_prompt),
        criteria_names_list_str=criteria_names_list_str
    )

    prompt_to_send = str(system_prompt_text) + "\\n\\n" + user_prompt if system_prompt_text else user_prompt

    all_repetition_scores = []
    llm_raw_responses_list = []
    errors_in_repetitions_count = 0
    actual_prompt_sent_to_llm = prompt_to_send

    if repetitions > 1 and not quiet:
        print(f"    Evaluating Item: '{item_title}' with Variant: '{prompt_variant_config.get('name', 'N/A')}' (Order: {prompt_variant_config.get('order_permutation_name', 'N/A')}), {repetitions} reps...")

    for rep_idx in range(repetitions):
        if repetitions > 1 and not quiet:
            print(f"      Rep {rep_idx + 1}/{repetitions}...")
        
        llm_response_raw = call_openrouter_api(prompt_to_send, quiet=True, temperature=temperature)
        llm_raw_responses_list.append(llm_response_raw)

        parsed_scores_single_rep = None
        is_api_error = isinstance(llm_response_raw, str) and llm_response_raw.startswith("Error:")

        if not is_api_error:
            parsed_scores_single_rep = parse_multi_criteria_json(llm_response_raw, current_criteria_order_for_prompt)
        
        if parsed_scores_single_rep:
            all_repetition_scores.append(parsed_scores_single_rep)
        else:
            errors_in_repetitions_count += 1
            if not quiet:
                error_type = "API Error" if is_api_error else "Parsing Error"
                print(f"        {error_type} in Rep {rep_idx + 1}. LLM Raw: {llm_response_raw[:150]}...")
                
    return {
        "item_id": item_id,
        "item_title": item_title,
        "prompt_variant_name": prompt_variant_config.get("name", "N/A"),
        "order_permutation_name": prompt_variant_config.get("order_permutation_name", "N/A"),
        "criteria_order_used": current_criteria_order_for_prompt,
        "scores_per_repetition": all_repetition_scores,
        "llm_raw_responses": llm_raw_responses_list,
        "errors_in_repetitions": errors_in_repetitions_count,
        "total_repetitions_attempted": repetitions,
        "actual_prompt_sent_to_llm": actual_prompt_sent_to_llm,
        "sampled_llm_raw_responses": llm_raw_responses_list[:min(repetitions, 3)]
    }

# --- Experiment 1: Permuted Order Multi-Criteria Scoring ---

def run_permuted_order_multi_criteria_experiment(
    data_list: list,
    rubric_dict: dict,
    task_name: str,
    show_raw: bool = False, 
    quiet: bool = False, 
    num_samples: int = 0, 
    repetitions: int = 1,
    temperature: float = 0.1
) -> list:
    """
    Scores items against multiple criteria, varying criteria presentation order.
    """
    criteria_order_original = rubric_dict.get("criteria_order", list(rubric_dict.get("criteria", {}).keys()))
    if not criteria_order_original:
        print(f"Warning: Could not determine original criteria order for task '{task_name}'. Skipping permuted experiment.")
        return []

    if not quiet:
        print(f"\\n--- Permuted Order Multi-Criteria Scoring Experiment ({task_name}) ---")
        print(f"LLM Model: {BIAS_SUITE_LLM_MODEL}")
        print(f"Repetitions per item-variant-order: {repetitions}")
        print(f"Temperature for API calls: {temperature}")

    if not data_list or not isinstance(data_list, list):
        print(f"Warning: Provided data_list for task '{task_name}' is empty/invalid. Skipping permuted experiment.")
        return []
        
    items_to_process = data_list
    if num_samples > 0 and len(items_to_process) > num_samples:
        items_to_process = items_to_process[:num_samples]
    
    if not items_to_process:
        print(f"No items to process for task '{task_name}' after sampling. Skipping permuted experiment.")
        return []

    criteria_order_reversed = criteria_order_original[::-1]
    prompt_configurations_permuted = [
        {
            "order_permutation_name": f"OrderOriginal_{task_name[:3]}",
            "criteria_order_for_this_run": criteria_order_original
        },
        {
            "order_permutation_name": f"OrderReversed_{task_name[:3]}",
            "criteria_order_for_this_run": criteria_order_reversed
        }
    ]

    if not quiet:
        print(f"Processing {len(items_to_process)} item(s) with {len(prompt_configurations_permuted)} orderings each.")

    formatted_full_rubric_text = format_rubric_for_prompt(rubric_dict)

    base_prompt_config = {
        "name": f"MultiCriteria_{task_name[:3]}_Holistic_OrderOriginal",
        "system_prompt": f"You are an evaluation assistant. Your task is to objectively evaluate the provided text based on the criteria: {', '.join(criteria_order_original)}, using the detailed scoring rubric. Respond ONLY with a single JSON object containing your scores.",
        "user_prompt_template": f"Please evaluate the following text based on the comprehensive rubric provided below. For each of the criteria ({{criteria_names_list_str}}), assign a score from 1 to 5. Your response MUST be a single JSON object. The keys of the JSON object must be exactly these strings: {{criteria_names_json_string}}. The value for each key should be the integer score (1-5).\\n\\n**TEXT ({task_name.upper()}):**\\n```\\n{{text}}\\n```\\n\\n**SCORING RUBRIC:**\\n```\\n{{rubric_text}}\\n```\\n\\n**Your JSON Response:",
        "order_permutation_name": f"OrderOriginal_{task_name[:3]}"
    }

    all_results_data = [] 
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_API_CALLS_ADVANCED) as executor:
        future_to_task_details = {}
        for item_to_eval in tqdm(items_to_process, desc=f"Permuted Order: {task_name} Items"):
            if not isinstance(item_to_eval, dict) or 'text' not in item_to_eval or 'id' not in item_to_eval:
                if not quiet: print(f"Skipping invalid item: {item_to_eval}")
                continue
            
            item_title_display = item_to_eval.get('title', item_to_eval['id'])

            for order_perm_config in tqdm(prompt_configurations_permuted, desc=f"Permutations for {item_title_display[:20]}..", leave=False):
                current_full_prompt_variant_config = {
                    **base_prompt_config, 
                    **order_perm_config 
                }

                future = executor.submit(
                    _run_single_item_evaluation_task_advanced,
                    current_full_prompt_variant_config,
                    item_to_eval, 
                    formatted_full_rubric_text, 
                    order_perm_config["criteria_order_for_this_run"],
                    repetitions,
                    quiet,
                    temperature
                )
                future_to_task_details[future] = (item_to_eval['id'], current_full_prompt_variant_config['order_permutation_name'])

        for future in tqdm(concurrent.futures.as_completed(future_to_task_details), total=len(future_to_task_details), desc=f"Permuted Order {task_name}: Processing results"):
            item_id, order_name = future_to_task_details[future]
            try:
                result = future.result() 
                all_results_data.append(result)
            except Exception as exc:
                print(f"!! Exception for Item ID: {item_id}, Order: {order_name}, Task: {task_name}: {exc}")
                error_item_title = "N/A"
                for item_lookup in items_to_process:
                    if item_lookup['id'] == item_id:
                        error_item_title = item_lookup.get('title', item_id)
                        break
                all_results_data.append({
                    "item_id": item_id, "order_permutation_name": order_name, "error_message": str(exc),
                    "scores_per_repetition": [], "llm_raw_responses": [], 
                    "errors_in_repetitions": repetitions, "total_repetitions_attempted": repetitions,
                    "item_title": error_item_title
                })
    
    if not quiet:
        print(f"\\n\\n--- Permuted Order Multi-Criteria {task_name} Scoring Summary ---")

    aggregated_by_item = collections.defaultdict(lambda: {"criteria_comparison": collections.defaultdict(dict)}) 

    for task_result in all_results_data:
        item_id = task_result.get("item_id") 
        item_title = task_result.get("item_title", "N/A")
        order_name_for_this_task = task_result.get("order_permutation_name", "UnknownOrder")
        
        if "error_message" in task_result:
            for crit_orig in criteria_order_original:
                 aggregated_by_item[item_id]["criteria_comparison"][crit_orig][order_name_for_this_task] = {"avg": "ERROR", "std": "N/A"}
            aggregated_by_item[item_id]["item_title"] = item_title 
            continue

        scores_all_reps_this_task = task_result.get("scores_per_repetition", []) 

        for original_criterion_name in criteria_order_original:
            scores_for_this_orig_criterion_this_task = []
            for rep_scores_dict in scores_all_reps_this_task: 
                if rep_scores_dict and original_criterion_name in rep_scores_dict: 
                    score_val = rep_scores_dict[original_criterion_name]
                    if isinstance(score_val, int):
                        scores_for_this_orig_criterion_this_task.append(score_val)
            
            avg_score = np.mean(scores_for_this_orig_criterion_this_task) if scores_for_this_orig_criterion_this_task else None
            std_dev = np.std(scores_for_this_orig_criterion_this_task) if len(scores_for_this_orig_criterion_this_task) > 1 else (0.0 if len(scores_for_this_orig_criterion_this_task) == 1 else None)
            
            aggregated_by_item[item_id]["criteria_comparison"][original_criterion_name][order_name_for_this_task] = {
                "avg": avg_score, 
                "std": std_dev,
                "num_valid_scores": len(scores_for_this_orig_criterion_this_task),
                "total_reps_for_task": task_result.get("total_repetitions_attempted", 0)
            }
            aggregated_by_item[item_id]["item_title"] = item_title 

    final_summary_for_return_permuted = [] 
    order_names_in_table = [op["order_permutation_name"] for op in prompt_configurations_permuted]
    
    header_parts = [f"{task_name} Item Title", "Criterion"]
    for oname in order_names_in_table:
        header_parts.extend([f"Avg ({oname[:10]})", f"Std ({oname[:10]})"])

    col_widths = [max(15, len(p)) for p in header_parts]
    col_widths[0] = max(30, col_widths[0]) 
    col_widths[1] = max(18, col_widths[1]) 
    
    print(" | ".join([h.ljust(col_widths[i]) for i, h in enumerate(header_parts)]))
    print("-" * (sum(col_widths) + len(col_widths) * 3 -1))

    for item_id, data in aggregated_by_item.items(): 
        item_title_display = data.get("item_title", item_id)[:col_widths[0]-3] + "..." if len(data.get("item_title", item_id)) > col_widths[0] else data.get("item_title", item_id)
        item_summary_entry = {
            "item_id": item_id, 
            "item_title": data.get("item_title", "N/A"),
            "order_comparison_results": []
        }

        for i_crit, original_criterion_name in enumerate(criteria_order_original):
            row_values = []
            if i_crit == 0: 
                row_values.append(item_title_display.ljust(col_widths[0]))
            else:
                row_values.append("".ljust(col_widths[0])) 
            
            row_values.append(original_criterion_name.ljust(col_widths[1]))
            
            criterion_comparison_data = { "criterion_name": original_criterion_name, "scores_by_order": {}}

            for idx_order, order_name_key in enumerate(order_names_in_table):
                stats = data["criteria_comparison"].get(original_criterion_name, {}).get(order_name_key, {})
                avg_s = stats.get("avg", "N/A")
                std_s = stats.get("std", "N/A")
                
                avg_str = f"{avg_s:.2f}" if isinstance(avg_s, float) else str(avg_s)
                std_str = f"{std_s:.2f}" if isinstance(std_s, float) else str(std_s)
                
                row_values.append(avg_str.ljust(col_widths[2 + idx_order * 2]))
                row_values.append(std_str.ljust(col_widths[2 + idx_order * 2 + 1]))
                criterion_comparison_data["scores_by_order"][order_name_key] = {"avg": avg_s, "std": std_s, "n_scores": stats.get("num_valid_scores"), "total_reps": stats.get("total_reps_for_task")}

            print(" | ".join(row_values))
            item_summary_entry["order_comparison_results"].append(criterion_comparison_data)
        
        final_summary_for_return_permuted.append(item_summary_entry)
        print("-" * (sum(col_widths) + len(col_widths) * 3 -1)) 

    if show_raw and not quiet:
        print(f"\\n\\n--- Raw LLM Responses for Permuted Order {task_name} Scoring (Sample) ---")
        if all_results_data:
            first_item_first_order_res = all_results_data[0]
            print(f"Item ID: {first_item_first_order_res.get('item_id')}, Order: {first_item_first_order_res.get('order_permutation_name')}")
            for i, raw_resp in enumerate(first_item_first_order_res.get('sampled_llm_raw_responses', first_item_first_order_res.get('llm_raw_responses', []))):
                print(f"  Rep {i+1}: {raw_resp[:200]}...")

    return final_summary_for_return_permuted


# --- Experiment 2: Isolated Criterion Scoring ---
def run_isolated_criterion_scoring_experiment(
    data_list: list,
    rubric_dict: dict,
    task_name: str,
    show_raw: bool = False, 
    quiet: bool = False, 
    num_samples: int = 0, 
    repetitions: int = 1,
    holistic_comparison_data: list | None = None,
    temperature: float = 0.1
) -> list:
    criteria_order_original = rubric_dict.get("criteria_order", list(rubric_dict.get("criteria", {}).keys()))
    if not criteria_order_original:
        print(f"Warning: Could not determine original criteria order for task '{task_name}'. Skipping isolated experiment.")
        return []

    if not quiet:
        print(f"\\n--- Isolated Criterion {task_name} Scoring Experiment ---")
        print(f"LLM Model: {BIAS_SUITE_LLM_MODEL}")
        print(f"Repetitions per item-criterion (isolated): {repetitions}")
        print(f"Temperature for API calls: {temperature}")

    if not data_list or not isinstance(data_list, list):
        print(f"Warning: Provided data_list for '{task_name}' is empty/invalid. Skipping isolated experiment.")
        return []
        
    items_to_process = data_list
    if num_samples > 0 and len(items_to_process) > num_samples:
        items_to_process = items_to_process[:num_samples]
    
    if not items_to_process:
        print(f"No items to process for '{task_name}' after sampling. Skipping isolated experiment.")
        return []

    if not quiet:
        print(f"Processing {len(items_to_process)} item(s) for isolated criterion scoring ({task_name}).")

    def _format_rubric_for_single_criterion(full_rubric_dict: dict, criterion_name: str) -> str:
        lines = []
        criterion_details = full_rubric_dict.get('criteria', {}).get(criterion_name)
        if not criterion_details:
            return f"Error: Criterion '{criterion_name}' not found in rubric dictionary."

        lines.append(f"**Criterion: {criterion_name}**")
        lines.append(f"Description: {criterion_details.get('description', 'N/A')}")
        lines.append("Scoring Levels:")
        for score, level_desc in sorted(criterion_details.get('scoring_levels', {}).items(), reverse=True):
            lines.append(f"  {score}: {level_desc}")
        
        lines.append(f"\\nOverall Scoring Scale Reminder: {full_rubric_dict.get('scoring_scale_description', '1-5 scale')}")
        return "\\n".join(lines)

    def _parse_single_numeric_score(response_text: str, quiet: bool = True) -> int | None:
        response_text = response_text.strip()
        if not quiet: print(f"        Attempting to parse: {repr(response_text)}")
        match = re.search(r'<score>\s*([1-5])\s*</score>', response_text, re.IGNORECASE)
        if not quiet: print(f"        Match result: {match}")
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                if not quiet: print(f"Warning (_parse_single_numeric_score): Matched <score> but failed to convert '{match.group(1)}'.")
                return None
        if not quiet: print(f"Warning (_parse_single_numeric_score): Could not parse valid 1-5 score from <score> tags. Raw response (stripped): {repr(response_text)}")
        return None

    def _run_single_criterion_isolated_task(
        item_to_evaluate: dict, 
        criterion_name_to_score: str, 
        specific_rubric_text_for_criterion: str,
        repetitions: int, 
        quiet: bool,
        current_task_name: str,
        temperature: float
    ) -> dict:
        item_id = item_to_evaluate['id']
        item_title = item_to_evaluate.get('title', item_id)
        item_text_to_score = item_to_evaluate['text']

        system_prompt = f"You are an expert critical thinking assistant for {current_task_name} evaluation. Your task is to objectively evaluate the provided text *only* on the single, specific criterion of '{criterion_name_to_score}', based on its detailed rubric description. Your response MUST be only the numerical score from 1 to 5, enclosed in <score> tags. For example: <score>3</score>."
        user_prompt = (
            f"Please evaluate the following text ({current_task_name}) *only* on the criterion of: **{criterion_name_to_score}**.\\n\\n"
            f"Refer to the detailed rubric description for '{criterion_name_to_score}' provided below to assign your score.\\n"
            f"Respond with ONLY a single integer score from 1 to 5, enclosed in <score> tags. Example: <score>4</score>.\\n\\n"
            f"**TEXT ({current_task_name.upper()}):**\\n```\\n{item_text_to_score}\\n```\\n\\n"
            f"**DETAILED RUBRIC FOR '{criterion_name_to_score}':**\\n```\\n{specific_rubric_text_for_criterion}\\n```\\n\\n"
            f"Your response (e.g., <score>1</score>, <score>2</score>, <score>3</score>, <score>4</score>, or <score>5</score>):"
        )
        prompt_to_send = system_prompt + "\\n\\n" + user_prompt

        single_criterion_scores_reps = []
        llm_raw_responses_reps = []
        errors_in_reps = 0
        actual_prompt_sent_to_llm_isolated = prompt_to_send

        if repetitions > 1 and not quiet:
            print(f"    Isolated Eval: Item '{item_title[:30]}...' ({current_task_name}), Criterion '{criterion_name_to_score}' ({repetitions} reps)...")

        for rep_idx in range(repetitions):
            if repetitions > 1 and not quiet:
                print(f"      Rep {rep_idx + 1}/{repetitions} for {criterion_name_to_score}...")
            
            llm_response_raw = call_openrouter_api(prompt_to_send, quiet=quiet, temperature=temperature)
            llm_raw_responses_reps.append(llm_response_raw)
            parsed_score_single_rep = None
            is_api_error = isinstance(llm_response_raw, str) and llm_response_raw.startswith("Error:")

            if not is_api_error:
                parsed_score_single_rep = _parse_single_numeric_score(llm_response_raw, quiet=quiet)
            
            if parsed_score_single_rep is not None:
                single_criterion_scores_reps.append(parsed_score_single_rep)
            else:
                errors_in_reps += 1
                if not quiet:
                    err_type = "API Error" if is_api_error else "Parsing Error"
                    print(f"        {err_type} in Rep {rep_idx + 1} for {criterion_name_to_score}. LLM Raw: {llm_response_raw[:100]}...")
        
        return {
            "item_id": item_id,
            "item_title": item_title,
            "criterion_scored_in_isolation": criterion_name_to_score,
            "isolated_scores_per_repetition": single_criterion_scores_reps,
            "llm_raw_responses": llm_raw_responses_reps,
            "errors_in_repetitions": errors_in_reps,
            "total_repetitions_attempted": repetitions,
            "actual_prompt_sent_to_llm": actual_prompt_sent_to_llm_isolated,
            "sampled_llm_raw_responses": llm_raw_responses_reps[:min(repetitions, 3)]
        }

    if not quiet: print(f"\\n  Running baseline holistic evaluations ({task_name}, original order) for comparison...")
    
    holistic_scores_by_item_criterion = collections.defaultdict(
        lambda: collections.defaultdict(lambda: {"avg": None, "std": None, "n_scores": 0, "total_reps": 0})
    )
    
    formatted_full_rubric_text_holistic = format_rubric_for_prompt(rubric_dict)

    if holistic_comparison_data:
        if not quiet: print(f"  Using provided holistic_comparison_data for {task_name}.")
        for item_summary in tqdm(holistic_comparison_data, desc=f"Processing provided holistic data ({task_name})", leave=False):
            item_id = item_summary.get("item_id")
            if not item_id: continue
            for crit_comp_res in item_summary.get("order_comparison_results", []):
                crit_name = crit_comp_res.get("criterion_name")
                if not crit_name: continue
                original_order_key = f"OrderOriginal_{task_name[:3]}"
                original_order_stats = crit_comp_res.get("scores_by_order", {}).get(original_order_key)
                if original_order_stats:
                    holistic_scores_by_item_criterion[item_id][crit_name] = {
                        "avg": original_order_stats.get("avg"),
                        "std": original_order_stats.get("std"),
                        "n_scores": original_order_stats.get("n_scores"),
                        "total_reps": original_order_stats.get("total_reps")
                    }
    else:
        if not quiet: print(f"  No holistic_comparison_data provided for {task_name}, running fresh baseline holistic evaluations...")
        base_holistic_prompt_config = {
            "name": f"MultiCriteria_{task_name[:3]}_Holistic_ForIsolatedCompare",
            "system_prompt": f"You are an evaluation assistant. Your task is to objectively evaluate the provided text ({task_name}) based on the criteria: {', '.join(criteria_order_original)}, using the detailed scoring rubric. Respond ONLY with a single JSON object containing your scores.",
            "user_prompt_template": f"Please evaluate the following text ({task_name}) based on the comprehensive rubric provided below. For each of the criteria ({{criteria_names_list_str}}), assign a score from 1 to 5. Your response MUST be a single JSON object. The keys of the JSON object must be exactly these strings: {{criteria_names_json_string}}. The value for each key should be the integer score (1-5).\\n\\n**TEXT ({task_name.upper()}):**\\n```\\n{{text}}\\n```\\n\\n**SCORING RUBRIC:**\\n```\\n{{rubric_text}}\\n```\\n\\n**Your JSON Response:",
            "order_permutation_name": f"OrderOriginal_{task_name[:3]}"
        }
        holistic_run_tasks = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_API_CALLS_ADVANCED) as executor:
            for item_holistic in tqdm(items_to_process, desc=f"Isolated Exp: Holistic {task_name} Items", leave=False):
                future_holistic = executor.submit(
                    _run_single_item_evaluation_task_advanced, 
                    base_holistic_prompt_config,
                    item_holistic, 
                    formatted_full_rubric_text_holistic, 
                    criteria_order_original,
                    repetitions, 
                    quiet,
                    temperature
                )
                holistic_run_tasks.append(future_holistic)
            
            for future_h_res in tqdm(concurrent.futures.as_completed(holistic_run_tasks), total=len(holistic_run_tasks), desc=f"Isolated Exp: Holistic {task_name} Results", leave=False):
                h_res = future_h_res.result()
                item_id_h = h_res.get("item_id")
                scores_per_rep_h = h_res.get("scores_per_repetition", [])
                for crit_orig_h in criteria_order_original:
                    scores_for_crit_h = [rep_s.get(crit_orig_h) for rep_s in scores_per_rep_h if rep_s and isinstance(rep_s.get(crit_orig_h), int)]
                    avg_h = np.mean(scores_for_crit_h) if scores_for_crit_h else None
                    std_h = np.std(scores_for_crit_h) if len(scores_for_crit_h) > 1 else (0.0 if len(scores_for_crit_h) == 1 else None)
                    holistic_scores_by_item_criterion[item_id_h][crit_orig_h] = {"avg": avg_h, "std": std_h, "n_scores": len(scores_for_crit_h), "total_reps": h_res.get("total_repetitions_attempted",0)}

    if not quiet: print(f"\\n  Running isolated criterion evaluations for {task_name}...")
    all_isolated_task_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_API_CALLS_ADVANCED) as executor:
        future_to_isolated_task_details = {}
        tasks_to_submit_isolated = []
        for item_iso in tqdm(items_to_process, desc=f"Isolated Exp: {task_name} Items for Isolation", leave=True):
            for criterion_name_iso in tqdm(criteria_order_original, desc=f"Criteria for {item_iso.get('title', item_iso['id'])[:15]}.. ({task_name})", leave=False):
                specific_rubric = _format_rubric_for_single_criterion(rubric_dict, criterion_name_iso)
                if "Error:" in specific_rubric: 
                    if not quiet: print(f"    Skipping {criterion_name_iso} for item {item_iso['id']} ({task_name}) due to rubric formatting error: {specific_rubric}")
                    all_isolated_task_results.append({
                        "item_id": item_iso['id'], "item_title": item_iso.get('title', item_iso['id']),
                        "criterion_scored_in_isolation": criterion_name_iso, "error_message": specific_rubric,
                        "isolated_scores_per_repetition": [], "llm_raw_responses": [],
                        "errors_in_repetitions": repetitions, "total_repetitions_attempted": repetitions
                    })
                    continue
                
                tasks_to_submit_isolated.append({
                    'func': _run_single_criterion_isolated_task,
                    'args': [item_iso, criterion_name_iso, specific_rubric, repetitions, quiet, task_name, temperature],
                    'item_id': item_iso['id'],
                    'criterion_name': criterion_name_iso,
                    'item_title': item_iso.get('title', item_iso['id'])
                })
        
        for task_def in tasks_to_submit_isolated:            
            future_iso = executor.submit(task_def['func'], *task_def['args'])
            future_to_isolated_task_details[future_iso] = (task_def['item_id'], task_def['criterion_name'])
        
        for future_iso_res in tqdm(concurrent.futures.as_completed(future_to_isolated_task_details), total=len(future_to_isolated_task_details), desc=f"Isolated Exp {task_name}: Processing results", leave=False):
            item_id_iso, c_name_iso = future_to_isolated_task_details[future_iso_res]
            try:
                iso_res = future_iso_res.result()
                all_isolated_task_results.append(iso_res)
            except Exception as exc_iso:
                print(f"!! Exception for Isolated Task: Item ID {item_id_iso}, Criterion {c_name_iso} ({task_name}): {exc_iso}")
                error_item_title = "Unknown Item"
                for d_item in items_to_process:
                    if d_item['id'] == item_id_iso:
                        error_item_title = d_item.get('title', item_id_iso)
                        break
                all_isolated_task_results.append({
                    "item_id": item_id_iso, "criterion_scored_in_isolation": c_name_iso, "error_message": str(exc_iso),
                    "isolated_scores_per_repetition": [], "llm_raw_responses": [],
                    "errors_in_repetitions": repetitions, "total_repetitions_attempted": repetitions,
                    "item_title": error_item_title 
                })

    if not quiet:
        print(f"\\n\\n--- Isolated vs. Holistic {task_name} Scoring Comparison ---")    
    
    final_summary_for_return_isolated = []
    header_iso_parts = [f"{task_name} Item Title", "Criterion", "Avg Iso", "Std Iso", "Avg Hol", "Std Hol", "Delta"]
    col_widths_iso = [max(15, len(p)) for p in header_iso_parts]
    col_widths_iso[0] = max(30, col_widths_iso[0]) 
    col_widths_iso[1] = max(18, col_widths_iso[1]) 

    print(" | ".join([h.ljust(col_widths_iso[i]) for i, h in enumerate(header_iso_parts)]))
    print("-" * (sum(col_widths_iso) + len(col_widths_iso) * 3 -1))

    isolated_scores_by_item_criterion = collections.defaultdict(
        lambda: collections.defaultdict(lambda: {"avg": None, "std": None, "n_scores":0, "total_reps":0, "error": None})
    )
    for iso_task_res in all_isolated_task_results:
        item_id_iso = iso_task_res.get("item_id")
        c_name_iso = iso_task_res.get("criterion_scored_in_isolation")
        item_title_iso = iso_task_res.get("item_title", "N/A")
        isolated_scores_by_item_criterion[item_id_iso]["item_title"] = item_title_iso
        
        if "error_message" in iso_task_res:
            isolated_scores_by_item_criterion[item_id_iso][c_name_iso]["error"] = iso_task_res["error_message"]
            continue
        
        scores_reps_iso = [s for s in iso_task_res.get("isolated_scores_per_repetition", []) if isinstance(s, int)]
        avg_iso = np.mean(scores_reps_iso) if scores_reps_iso else None
        std_iso = np.std(scores_reps_iso) if len(scores_reps_iso) > 1 else (0.0 if len(scores_reps_iso) == 1 else None)
        isolated_scores_by_item_criterion[item_id_iso][c_name_iso] = {
            "avg": avg_iso, "std": std_iso, 
            "n_scores": len(scores_reps_iso), 
            "total_reps": iso_task_res.get("total_repetitions_attempted",0)
        }

    for item_id_key_item in items_to_process:
        current_item_id = item_id_key_item['id']
        current_item_title = isolated_scores_by_item_criterion[current_item_id].get("item_title", current_item_id)
        
        item_summary_output = {
            "item_id": current_item_id,
            "item_title": current_item_title,
            "comparison_details": []
        }
        
        title_printed_for_item = False
        for crit_name_key in criteria_order_original:
            iso_stats = isolated_scores_by_item_criterion[current_item_id].get(crit_name_key, {})
            hol_stats = holistic_scores_by_item_criterion[current_item_id].get(crit_name_key, {})

            avg_i = iso_stats.get("avg")
            std_i = iso_stats.get("std")
            avg_h = hol_stats.get("avg")
            std_h = hol_stats.get("std")
            delta = (avg_i - avg_h) if isinstance(avg_i, (float, int)) and isinstance(avg_h, (float, int)) else None
            
            row_vals = []
            if not title_printed_for_item:
                item_title_display = current_item_title[:col_widths_iso[0]-3] + "..." if len(current_item_title) > col_widths_iso[0] else current_item_title
                row_vals.append(item_title_display.ljust(col_widths_iso[0]))
                title_printed_for_item = True
            else:
                row_vals.append("".ljust(col_widths_iso[0]))
            
            row_vals.extend([
                crit_name_key.ljust(col_widths_iso[1]),
                (f"{avg_i:.2f}" if avg_i is not None else ("ERR" if iso_stats.get("error") else "N/A")).ljust(col_widths_iso[2]),
                (f"{std_i:.2f}" if std_i is not None else ("N/A" if not iso_stats.get("error") else "")).ljust(col_widths_iso[3]),
                (f"{avg_h:.2f}" if avg_h is not None else "N/A").ljust(col_widths_iso[4]),
                (f"{std_h:.2f}" if std_h is not None else "N/A").ljust(col_widths_iso[5]),
                (f"{delta:+.2f}" if delta is not None else "N/A").ljust(col_widths_iso[6])
            ])
            print(" | ".join(row_vals))
            
            item_summary_output["comparison_details"].append({
                "criterion": crit_name_key,
                "isolated_avg": avg_i, "isolated_std": std_i, "isolated_n": iso_stats.get("n_scores"), "isolated_reps": iso_stats.get("total_reps"), "isolated_error": iso_stats.get("error"),
                "holistic_avg": avg_h, "holistic_std": std_h, "holistic_n": hol_stats.get("n_scores"), "holistic_reps": hol_stats.get("total_reps"),
                "delta_avg": delta
            })
        final_summary_for_return_isolated.append(item_summary_output)
        if items_to_process:
             print("-" * (sum(col_widths_iso) + len(col_widths_iso) * 3 -1))

    if show_raw and not quiet:
        print(f"\\n\\n--- Raw LLM Responses for Isolated Criterion {task_name} Scoring (Sample) ---")
        if all_isolated_task_results:
            first_item_first_crit_res = next((r for r in all_isolated_task_results if r.get("item_id") == items_to_process[0]['id'] and r.get("criterion_scored_in_isolation") == criteria_order_original[0]), None)
            if first_item_first_crit_res:
                print(f"Item ID: {first_item_first_crit_res.get('item_id')}, Criterion (Isolated): {first_item_first_crit_res.get('criterion_scored_in_isolation')}")
                if first_item_first_crit_res.get("actual_prompt_sent_to_llm"):
                    print(f"  Prompt Sent: {str(first_item_first_crit_res.get('actual_prompt_sent_to_llm'))[:300]}...")
                
                responses_to_show_iso = first_item_first_crit_res.get("sampled_llm_raw_responses", first_item_first_crit_res.get('llm_raw_responses', []))
                for i, raw_resp in enumerate(responses_to_show_iso):
                    print(f"  Rep {i+1}: {raw_resp[:200]}...")
            else:
                print(" (No suitable sample found for raw response display)")


    return final_summary_for_return_isolated


# --- Main Execution (Example Usage) ---
if __name__ == '__main__':
    try:
        from test_data import SHORT_ARGUMENTS_FOR_SCORING, ARGUMENT_EVALUATION_RUBRIC, STORY_OPENING_EVALUATION_RUBRIC, STORY_OPENINGS_FOR_SCORING
    except ImportError:
        print("Please ensure test_data.py is accessible and contains the necessary data structures.")
        sys.exit(1)

    print("Running ADVANCED Multi-Criteria Experiments (Direct Script Run)...")
    
    # --- Test Permuted Order ---
    print("\\nTesting Permuted Order (Arguments)...")
    permuted_results_args = run_permuted_order_multi_criteria_experiment(
        data_list=SHORT_ARGUMENTS_FOR_SCORING,
        rubric_dict=ARGUMENT_EVALUATION_RUBRIC,
        task_name="Argument",
        num_samples=2,
        repetitions=2,
        quiet=False,
        temperature=0.5
    )

    print("\\nTesting Permuted Order (Story Openings)...")
    permuted_results_story = run_permuted_order_multi_criteria_experiment(
        data_list=STORY_OPENINGS_FOR_SCORING,
        rubric_dict=STORY_OPENING_EVALUATION_RUBRIC,
        task_name="StoryOpening",
        num_samples=2, 
        repetitions=2,
        quiet=False,
        temperature=0.5
    )

    # --- Test Isolated Criterion ---
    
    def extract_holistic_for_isolated_test(perm_results, task_name_short):
        if not perm_results: return None
        return perm_results

    print("\\nTesting Isolated vs. Holistic (Arguments)...")
    holistic_arg_data_for_iso = extract_holistic_for_isolated_test(permuted_results_args, "Arg")

    isolated_results_args = run_isolated_criterion_scoring_experiment(
        data_list=SHORT_ARGUMENTS_FOR_SCORING,
        rubric_dict=ARGUMENT_EVALUATION_RUBRIC,
        task_name="Argument",
        num_samples=2, 
        repetitions=2,
        quiet=False,
        holistic_comparison_data=holistic_arg_data_for_iso,
        temperature=0.5
    )

    print("\\nTesting Isolated vs. Holistic (Story Openings)...")
    holistic_story_data_for_iso = extract_holistic_for_isolated_test(permuted_results_story, "Sto")
    
    isolated_results_story = run_isolated_criterion_scoring_experiment(
        data_list=STORY_OPENINGS_FOR_SCORING,
        rubric_dict=STORY_OPENING_EVALUATION_RUBRIC,
        task_name="StoryOpening",
        num_samples=2,
        repetitions=2,
        quiet=False,
        holistic_comparison_data=holistic_story_data_for_iso,
        temperature=0.5
    )

    print("\\nAdvanced Multi-Criteria Experiments (Direct Script Run) COMPLETE.") 