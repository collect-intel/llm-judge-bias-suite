import re
import concurrent.futures
import numpy as np
from tqdm import tqdm
from test_data import POEMS_FOR_SCORING, TEXTS_FOR_SENTIMENT_SCORING, TEXTS_FOR_CRITERION_ADHERENCE_SCORING, FEW_SHOT_EXAMPLE_SETS_SCORING
from config_utils import call_openrouter_api, BIAS_SUITE_LLM_MODEL

# --- Parsing/normalization helpers ---
def parse_numeric(response_text, scale_type, **kwargs):
    response_text = response_text.strip()
    tag_match = re.search(r'<score>\s*(\d+)\s*</score>', response_text, re.IGNORECASE)
    if tag_match:
        try:
            return int(tag_match.group(1))
        except ValueError:
            print(f"Warning: Matched <score> but failed to convert '{tag_match.group(1)}' for type '{scale_type}'. Raw: '{response_text}'")
    
    print(f"Warning: Could not parse numeric score from <score> tag for type '{scale_type}' from response: '{response_text}'")
    return None

def normalize_numeric(score, scale_type, invert_scale=False, **kwargs):
    if score is None:
        return None
    
    val = float(score)
    normalized_val = None

    if scale_type == "1-5":
        normalized_val = val
    elif scale_type == "1-10":
        normalized_val = ((val - 1) / 9.0) * 4.0 + 1
    elif scale_type == "1-100":
        normalized_val = ((val - 1) / 99.0) * 4.0 + 1
    else:
        return None

    if normalized_val is None:
        return None

    if invert_scale:
        return (5 - normalized_val) + 1 
    return normalized_val

def parse_letter(response_text, scale_type, **kwargs):
    response_text = response_text.strip()
    tag_match = re.search(r'<grade>\s*([A-Ea-e])\s*</grade>', response_text, re.IGNORECASE)
    if tag_match:
        return tag_match.group(1).upper()

    print(f"Warning: Could not parse letter grade from <grade> tag for type '{scale_type}' from response: '{response_text}'")
    return None

def normalize_letter(score, scale_type, invert_scale=False, **kwargs):
    if score is None:
        return None
    grade_map = {'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1}
    normalized_score = float(grade_map.get(score.upper(), 0))

    if normalized_score == 0: # Parse error essentially
        return None

    if invert_scale:
        return (5 - normalized_score) + 1
    return normalized_score

def parse_creative_label(response_text, scale_type, labels=None, **kwargs):
    response_text = response_text.strip()
    import re
    tag_match = re.search(r'<label>\s*(.+?)\s*</label>', response_text, re.IGNORECASE | re.DOTALL)
    
    if tag_match:
        extracted_label_name = tag_match.group(1).strip()
        if labels:
            for valid_label_text, _ in labels:
                if valid_label_text == extracted_label_name:
                    return extracted_label_name
        print(f"Warning: Extracted label '{extracted_label_name}' from <label> tag is not in the provided valid labels list for type '{scale_type}'. Raw: '{response_text}'")
        return None

    print(f"Warning: Could not parse creative label from <label> tag for type '{scale_type}' from response: '{response_text}'")
    return None

def normalize_creative_label(score, scale_type, labels=None, invert_scale=False, **kwargs):
    if score is None or not labels:
        return None
    # labels are expected to be ordered from "best" (value 5) to "worst" (value 1)
    label_map = {label: 5-i for i, (label, _) in enumerate(labels)}
    normalized_score = float(label_map.get(score, 0))

    if normalized_score == 0: # Parse error
        return None

    return normalized_score

def parse_justification_score(response_text):
    """Extracts the score (as float) from <score> tags and the explanation from the rest of the response."""
    import re
    score_match = re.search(r'<score>\s*([0-9]+(?:\.[0-9]+)?)\s*</score>', response_text, re.IGNORECASE)
    score = float(score_match.group(1)) if score_match else None
    explanation = re.sub(r'<score>\s*[0-9]+(?:\.[0-9]+)?\s*</score>', '', response_text, flags=re.IGNORECASE).strip()
    return score, explanation

def normalize_justification_score(score, scale_type, **kwargs):
    if score is None:
        return None
    return float(score) # Assumes 1-5 scale already

CONCURRENT_SCORING_CALLS = 8

def build_rubric(labels):
    return "\n".join([f"{label}: {desc}" for label, desc in labels])

def _score_variant_task(variant, item_data, scoring_criterion, quiet, repetitions: int = 1, item_title: str = "Item", temperature: float = 0.1):
    text_to_score = item_data['text']
    current_item_title = item_data.get('title', item_data.get('id', 'Untitled Item'))

    # --- Prepare few-shot examples if specified ---
    few_shot_examples_string = ""
    if "few_shot_example_set_id" in variant and variant["few_shot_example_set_id"]:
        example_set_id = variant["few_shot_example_set_id"]
        if example_set_id in FEW_SHOT_EXAMPLE_SETS_SCORING:
            examples = FEW_SHOT_EXAMPLE_SETS_SCORING[example_set_id]
            formatted_examples = []
            for i, ex in enumerate(examples):
                example_entry = f"Example {i+1}:\\n"
                if "example_text_input" in ex:
                    example_entry += f"Text: \"{ex['example_text_input']}\"\\n"
                current_example_criterion = ex.get('example_criterion', scoring_criterion)
                example_entry += f"Criterion: \\\"{current_example_criterion}\\\"\\\\n"
                if "example_llm_output" in ex:
                    example_entry += f"Correct Output: {ex['example_llm_output']}\\\n"
                if "example_rationale_for_prompt" in ex and ex["example_rationale_for_prompt"]:
                    example_entry += f"(Reasoning for this example: {ex['example_rationale_for_prompt']})\\n"
                formatted_examples.append(example_entry)
            if formatted_examples:
                few_shot_examples_string = "Here are some examples to guide you:\\n---\\n" + "---\\n".join(formatted_examples) + "---\\n"
        else:
            if not quiet:
                print(f"Warning: Few-shot example set ID '{example_set_id}' not found in FEW_SHOT_EXAMPLE_SETS_SCORING.")
    # --- End of few-shot example preparation ---

    rubric = build_rubric(variant["labels"]) if variant.get("labels") else ""
    
    prompt_template_to_use = variant["user_prompt_template"]
    if "{few_shot_examples_section}" in prompt_template_to_use:
        user_prompt = prompt_template_to_use.format(
            text_input=text_to_score,
            criterion=scoring_criterion,
            rubric=rubric,
            few_shot_examples_section=few_shot_examples_string
        )
    else:
        user_prompt = prompt_template_to_use.format(
            text_input=text_to_score,
            criterion=scoring_criterion,
            rubric=rubric
        )
        if few_shot_examples_string and not quiet:
            print(f"Warning: Few-shot examples were prepared for variant '{variant['name']}' but no '{{few_shot_examples_section}}' placeholder was found in its template.")


    if variant.get("system_prompt"):
        messages = [
            {"role": "system", "content": variant["system_prompt"]},
            {"role": "user", "content": user_prompt}
        ]
        prompt_to_send = "\n".join([m["content"] for m in messages])
    else:
        prompt_to_send = user_prompt

    repetition_details_list = []
    errors_in_repetitions_count = 0
    MAX_PARSE_ATTEMPTS_PER_REPETITION = 3

    for rep_idx in range(repetitions):
        if repetitions > 1 and not quiet:
            variant_name_for_print = variant["name"]
            short_item_title = current_item_title[:30] + '...' if len(current_item_title) > 33 else current_item_title
            print(f"      Rep {rep_idx + 1}/{repetitions} for variant '{variant_name_for_print}' (Item: '{short_item_title}')...")
        
        raw_score_single = None
        norm_score_single = None
        llm_response_raw_for_this_rep = None
        api_error_for_this_rep_final = False

        for attempt_num in range(MAX_PARSE_ATTEMPTS_PER_REPETITION):
            llm_response_raw_for_this_rep = call_openrouter_api(prompt_to_send, quiet=quiet, temperature=temperature)
            
            is_api_error = isinstance(llm_response_raw_for_this_rep, str) and llm_response_raw_for_this_rep.startswith("Error:")

            if is_api_error:
                api_error_for_this_rep_final = True
                if not quiet and repetitions > 1:
                    print(f"        API Error in Rep {rep_idx+1}, API Call Attempt {attempt_num+1}. LLM Raw: {llm_response_raw_for_this_rep}")
                if attempt_num < MAX_PARSE_ATTEMPTS_PER_REPETITION - 1:
                    print(f"          API call failed for Rep {rep_idx+1}, Attempt {attempt_num+1}. Retrying API call...")
                raw_score_single = None
                norm_score_single = None
                if attempt_num == MAX_PARSE_ATTEMPTS_PER_REPETITION -1:
                     break
                else:
                    continue
            else:
                api_error_for_this_rep_final = False

            parse_fn = variant["parse_fn"]
            normalize_fn = variant["normalize_fn"]
            parse_kwargs = {"labels": variant.get("labels")}
            normalize_kwargs = {"labels": variant.get("labels"), "invert_scale": variant.get("invert_scale", False)}
            
            raw_score_single = parse_fn(llm_response_raw_for_this_rep, variant["scale_type"], **parse_kwargs)
            
            if raw_score_single is not None:
                norm_score_single = normalize_fn(raw_score_single, variant["scale_type"], **normalize_kwargs)
                if norm_score_single is not None:
                    if repetitions > 1 and not quiet and attempt_num > 0:
                        print(f"        Successfully parsed/normalized Rep {rep_idx+1} on attempt {attempt_num+1}.")
                    break
                else:
                    if not quiet and repetitions > 1:
                        print(f"        Normalization Error in Rep {rep_idx+1}, Attempt {attempt_num+1}. Raw: {raw_score_single}, LLM: {llm_response_raw_for_this_rep[:100]}...")
            else:
                if not quiet and repetitions > 1:
                     print(f"        Parsing Error in Rep {rep_idx+1}, Attempt {attempt_num+1}. LLM: {llm_response_raw_for_this_rep[:100]}...")
            
            if attempt_num < MAX_PARSE_ATTEMPTS_PER_REPETITION - 1:
                if not quiet and repetitions > 1:
                    print(f"          Retrying API call for Rep {rep_idx+1} due to parse/norm error (Overall Attempt {attempt_num+2} for this rep)...")
            else:
                 if not quiet and repetitions > 1:
                    print(f"        Failed to parse/normalize after {MAX_PARSE_ATTEMPTS_PER_REPETITION} attempts for Rep {rep_idx+1}.")

        repetition_details_list.append({
            "repetition_index": rep_idx,
            "raw_score_from_llm": raw_score_single, 
            "normalized_score": norm_score_single, 
            "raw_llm_response": llm_response_raw_for_this_rep 
        })

        if norm_score_single is None:
            errors_in_repetitions_count += 1
            if repetitions == 1 and not quiet:
                err_type = "API Error" if api_error_for_this_rep_final else "Parsing/Normalization Error"
                print(f"        {err_type} in Rep {rep_idx+1} (single rep mode). LLM Raw: {str(llm_response_raw_for_this_rep)[:100]}...")

    return repetition_details_list, errors_in_repetitions_count

# --- Main experiment runner ---
def run_scoring_experiment(show_raw=False, quiet=False, num_samples: int = 1, repetitions: int = 1, scoring_type: str = "all", temperature: float = 0.1):
    if not quiet:
        print(f"\n--- Flexible Scoring Experiment (Type: {scoring_type}) ---")
        print(f"Temperature for API calls: {temperature}")

    poem_specific_creative_labels = [
        ("CATEGORY_X98", "Outstanding emotional impact and depth"),
        ("CATEGORY_J12", "Good emotional impact and depth"),
        ("CATEGORY_55T", "Average emotional impact and depth"),
        ("CATEGORY_R04", "Below average emotional impact and depth"),
        ("CATEGORY_Z27", "Poor emotional impact and depth")
    ]
    all_defined_variants = get_all_scoring_variants(poem_specific_creative_labels)
    
    datasets_to_process = []

    if scoring_type == "poems" or scoring_type == "all":
        datasets_to_process.append({"name": "Poems", "data": POEMS_FOR_SCORING, "source_tag": "poems"})
    if scoring_type == "sentiment" or scoring_type == "all":
        datasets_to_process.append({"name": "Sentiment Texts", "data": TEXTS_FOR_SENTIMENT_SCORING, "source_tag": "sentiment_texts"})
    if scoring_type == "criterion_adherence" or scoring_type == "all":
        datasets_to_process.append({"name": "Criterion Adherence Texts", "data": TEXTS_FOR_CRITERION_ADHERENCE_SCORING, "source_tag": "criterion_adherence_texts"})

    if not datasets_to_process:
        if not quiet: print("No datasets selected based on scoring_type.")
        return []

    variant_data_accumulators = {}

    for dataset_info in tqdm(datasets_to_process, desc="Processing datasets"):
        current_dataset_name = dataset_info["name"]
        current_dataset_data = dataset_info["data"]
        current_source_tag = dataset_info["source_tag"]

        if not quiet:
            print(f"\n-- Processing Dataset: {current_dataset_name} --")

        texts_to_process_source = current_dataset_data
        texts_to_process = []
        if num_samples <= 0:
            texts_to_process = texts_to_process_source
        else:
            texts_to_process = texts_to_process_source[:min(num_samples, len(texts_to_process_source))]

        if not texts_to_process:
            if not quiet:
                print(f"No texts found or selected for dataset: {current_dataset_name}.")
            continue
    
        if not quiet:
            print(f"Processing {len(texts_to_process)} item(s) from {current_dataset_name}.")

        current_variants_for_this_dataset_source = [v for v in all_defined_variants if v.get("data_source") == current_source_tag]

        if not current_variants_for_this_dataset_source:
            if not quiet: print(f"No variants found for data_source '{current_source_tag}'. Skipping dataset {current_dataset_name}.")
            continue
        
        tasks_for_current_dataset_executor = []

        for variant_def in current_variants_for_this_dataset_source:
            variant_name = variant_def["name"]
            if variant_name not in variant_data_accumulators:
                variant_data_accumulators[variant_name] = {
                    "variant_config": {
                        "name": variant_name,
                        "data_source_tag": variant_def["data_source"],
                        "scale_type": variant_def["scale_type"],
                        "criterion_override": variant_def.get("criterion_override"),
                        "default_criterion": variant_def.get("default_criterion"),
                        "system_prompt_snippet": (sp := variant_def.get("system_prompt") or "")[:200] + ('...' if sp and len(sp) > 200 else ''),
                        "user_prompt_template_snippet": (upt := variant_def.get("user_prompt_template") or "")[:200] + ('...' if upt and len(upt) > 200 else ''),
                        "rubric_labels": [{"label": lbl, "description": desc} for lbl, desc in variant_def.get("labels", [])] if variant_def.get("labels") else [],
                        "invert_scale": variant_def.get("invert_scale", False),
                        "parse_fn_name": variant_def["parse_fn"].__name__ if hasattr(variant_def["parse_fn"], '__name__') else str(variant_def["parse_fn"]),
                        "normalize_fn_name": variant_def["normalize_fn"].__name__ if hasattr(variant_def["normalize_fn"], '__name__') else str(variant_def["normalize_fn"]),
                    },
                    "all_normalized_scores": [],
                    "detailed_item_results": [],
                    "errors_count_total_variant": 0,
                    "items_processed_count_variant": 0 
                }
            
            for item_idx, current_item_data_dict in enumerate(texts_to_process):
                item_display_title = current_item_data_dict.get('title', current_item_data_dict.get('id', 'Item'))
                current_criterion_for_task = variant_def.get("criterion_override", variant_def.get("default_criterion", "overall quality"))
                
                tasks_for_current_dataset_executor.append({
                    "task_args": (variant_def, current_item_data_dict, current_criterion_for_task, quiet, repetitions, item_display_title, temperature),
                    "variant_name": variant_name,
                    "item_id": current_item_data_dict['id'],
                    "item_title": current_item_data_dict.get('title'),
                    "item_text_snippet_prefix": current_item_data_dict['text'][:100],
                    "dataset_name_for_item": current_dataset_name,
                    "expected_scores_notes": current_item_data_dict.get('interpretation_notes')
                })

        if tasks_for_current_dataset_executor:
            with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_SCORING_CALLS) as executor:
                future_to_task_info_map = {
                    executor.submit(_score_variant_task, *task_info_item["task_args"]): task_info_item
                    for task_info_item in tasks_for_current_dataset_executor
                }

                for future in tqdm(concurrent.futures.as_completed(future_to_task_info_map), total=len(tasks_for_current_dataset_executor), desc=f"Scoring items in {current_dataset_name}", leave=False):
                    completed_task_info = future_to_task_info_map[future]
                    variant_name_for_result = completed_task_info["variant_name"]
                    
                    try:
                        repetition_details_list_for_item, item_errors_count = future.result()
                        
                        variant_data_accumulators[variant_name_for_result]["errors_count_total_variant"] += item_errors_count
                        variant_data_accumulators[variant_name_for_result]["items_processed_count_variant"] += 1
                        
                        item_normalized_scores = []
                        for rep_detail in repetition_details_list_for_item:
                            if rep_detail["normalized_score"] is not None:
                                variant_data_accumulators[variant_name_for_result]["all_normalized_scores"].append(rep_detail["normalized_score"])
                                item_normalized_scores.append(rep_detail["normalized_score"])

                        avg_norm_score_item = np.mean(item_normalized_scores) if item_normalized_scores else None
                        std_dev_norm_score_item = np.std(item_normalized_scores) if len(item_normalized_scores) > 1 else (0.0 if len(item_normalized_scores) == 1 else None)

                        variant_data_accumulators[variant_name_for_result]["detailed_item_results"].append({
                            "item_id": completed_task_info['item_id'],
                            "item_title": completed_task_info.get('item_title'),
                            "item_text_snippet": completed_task_info['item_text_snippet_prefix'] + ('...' if len(completed_task_info['item_text_snippet_prefix']) == 100 else ''),
                            "dataset_name": completed_task_info["dataset_name_for_item"],
                            "expected_scores": completed_task_info.get('expected_scores_notes'),
                            "repetitions": repetition_details_list_for_item,
                            "avg_normalized_score_for_item": avg_norm_score_item,
                            "std_dev_normalized_score_for_item": std_dev_norm_score_item
                        })
                        
                    except Exception as e:
                        if not quiet: print(f"  Exception for item {completed_task_info['item_title']} in variant {variant_name_for_result}: {e}")
                        variant_data_accumulators[variant_name_for_result]["errors_count_total_variant"] += repetitions 
                        variant_data_accumulators[variant_name_for_result]["items_processed_count_variant"] += 1
                        variant_data_accumulators[variant_name_for_result]["detailed_item_results"].append({
                            "item_id": completed_task_info['item_id'], 
                            "item_title": completed_task_info.get('item_title'), 
                            "dataset_name": completed_task_info["dataset_name_for_item"],
                            "item_text_snippet": completed_task_info['item_text_snippet_prefix'] + ('...' if len(completed_task_info['item_text_snippet_prefix']) == 100 else ''),
                            "repetitions": [], 
                            "error_message": str(e)
                        })


    # --- Final Assembly & Aggregation ---
    all_final_variant_results = []
    if not quiet:
        print("\n\n--- Scoring Experiment Stats Table (Aggregated Across All Processed Datasets) ---")
        header = f"{'Variant':<55} | {'Avg.Parsed':>10} | {'Avg.Norm(1-5)':>14} | {'MinNorm':>7} | {'MaxNorm':>7} | {'StdNorm':>7} | {'IQRNorm':>7} | {'Items':>7} | {'TotalReps':>9} | {'Success':>9} | {'Errors':>6}"
        print(header)
        print("-" * len(header))

    for variant_name, acc_data in variant_data_accumulators.items():
        agg_stats = {}
        valid_normalized_scores_all = [s for s in acc_data["all_normalized_scores"] if s is not None]
        
        if valid_normalized_scores_all:
            agg_stats["avg_normalized_score_overall"] = np.mean(valid_normalized_scores_all)
            agg_stats["min_normalized_score_overall"] = np.min(valid_normalized_scores_all)
            agg_stats["max_normalized_score_overall"] = np.max(valid_normalized_scores_all)
            if len(valid_normalized_scores_all) > 1:
                agg_stats["std_dev_normalized_score_overall"] = np.std(valid_normalized_scores_all)
                agg_stats["iqr_normalized_score_overall"] = np.percentile(valid_normalized_scores_all, 75) - np.percentile(valid_normalized_scores_all, 25)
            else: 
                agg_stats["std_dev_normalized_score_overall"] = 0.0 
                agg_stats["iqr_normalized_score_overall"] = 0.0
        else:
            agg_stats["avg_normalized_score_overall"] = None
            agg_stats["min_normalized_score_overall"] = None
            agg_stats["max_normalized_score_overall"] = None
            agg_stats["std_dev_normalized_score_overall"] = None
            agg_stats["iqr_normalized_score_overall"] = None

        all_raw_scores_for_variant = []
        for item_res in acc_data["detailed_item_results"]:
            for rep_res in item_res.get("repetitions", []):
                if rep_res.get("raw_score_from_llm") is not None and isinstance(rep_res.get("raw_score_from_llm"), (int, float)):
                     all_raw_scores_for_variant.append(rep_res["raw_score_from_llm"])
        
        agg_stats["avg_parsed_score_overall"] = np.mean(all_raw_scores_for_variant) if all_raw_scores_for_variant else None
        
        agg_stats["num_items_processed"] = acc_data["items_processed_count_variant"]
        agg_stats["repetitions_per_item"] = repetitions
        agg_stats["total_attempted_runs"] = acc_data["items_processed_count_variant"] * repetitions
        agg_stats["total_successful_runs"] = len(valid_normalized_scores_all)
        agg_stats["total_errors_in_runs"] = acc_data["errors_count_total_variant"]

        final_variant_result_obj = {
            "variant_config": acc_data["variant_config"],
            "aggregate_stats": agg_stats,
            "all_normalized_scores": acc_data["all_normalized_scores"],
            "detailed_item_results": acc_data["detailed_item_results"]
        }
        all_final_variant_results.append(final_variant_result_obj)

        if not quiet:
            avg_parsed_str = f"{agg_stats['avg_parsed_score_overall']:.2f}" if agg_stats['avg_parsed_score_overall'] is not None else "N/A"
            avg_norm_str = f"{agg_stats['avg_normalized_score_overall']:.2f}" if agg_stats['avg_normalized_score_overall'] is not None else "N/A"
            min_norm_str = f"{agg_stats['min_normalized_score_overall']:.2f}" if agg_stats['min_normalized_score_overall'] is not None else "N/A"
            max_norm_str = f"{agg_stats['max_normalized_score_overall']:.2f}" if agg_stats['max_normalized_score_overall'] is not None else "N/A"
            std_norm_str = f"{agg_stats['std_dev_normalized_score_overall']:.2f}" if agg_stats['std_dev_normalized_score_overall'] is not None else "N/A"
            iqr_norm_str = f"{agg_stats['iqr_normalized_score_overall']:.2f}" if agg_stats['iqr_normalized_score_overall'] is not None else "N/A"
            items_str = str(agg_stats['num_items_processed'])
            total_reps_str = str(agg_stats['total_attempted_runs'])
            success_str = str(agg_stats['total_successful_runs'])
            errors_str = str(agg_stats['total_errors_in_runs'])

            print(f"{variant_name:<55} | {avg_parsed_str:>10} | {avg_norm_str:>14} | {min_norm_str:>7} | {max_norm_str:>7} | {std_norm_str:>7} | {iqr_norm_str:>7} | {items_str:>7} | {total_reps_str:>9} | {success_str:>9} | {errors_str:>6}")

    return all_final_variant_results

def get_all_scoring_variants(poem_specific_creative_labels):
    all_variants = [
        {
            "name": "Poems: 1-5 (user prompt)", 
            "data_source": "poems", 
            "scale_type": "1-5", "labels": None, "system_prompt": None,
            # Tests: Basic numeric scale adherence.
            # Hypothesis: Baseline performance without system persona.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>3</score>... Poem:\\n{text_input}\\n\\nYour score (e.g., <score>3</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        # --- NEW Few-Shot Variant for Poems: 1-5 ---
        {
            "name": "Poems: 1-5 (user prompt, few-shot)", 
            "data_source": "poems", 
            "scale_type": "1-5", "labels": None, "system_prompt": None,
            "user_prompt_template": (
                "{few_shot_examples_section}"
                "Now, please score the following poem based on its '{criterion}' on a scale of 1 to 5. "
                "Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>3</score>...\\n"
                "Poem:\\n{text_input}\\n\\n"
                "Criterion for this poem: '{criterion}'\\n"
                "Your score (e.g., <score>3</score>):"
            ),
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, 
            "default_criterion": "emotional impact and depth of meaning",
            "few_shot_example_set_id": "poem_emotional_impact_1_5_examples"
        },
        {
            "name": "Poems: 1-5 (system prompt)", 
            "data_source": "poems",
            "scale_type": "1-5", "labels": None, "system_prompt": "You are a precise and impartial poetry judge...",
            # Tests: Impact of a system persona on scoring consistency and adherence.
            # Hypothesis: System prompt might lead to more stable or rubric-aligned scores.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>4</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>4</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-10 (user prompt)", 
            "data_source": "poems",
            "scale_type": "1-10", "labels": None, "system_prompt": None,
            # Tests: Adherence to a wider numeric scale.
            # Hypothesis: Check if LLM distributes scores differently on a 1-10 vs 1-5 scale.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 10. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>8</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>8</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-10 (system prompt)", 
            "data_source": "poems",
            "scale_type": "1-10", "labels": None, "system_prompt": "You are a precise and impartial poetry judge...",
            # Tests: Impact of system persona on a wider numeric scale.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 10. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>7</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>7</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: A-E (user prompt)", 
            "data_source": "poems",
            "scale_type": "A-E", "labels": None, "system_prompt": None,
            # Tests: Adherence to letter grade scale. Common mapping: A=5, E=1.
            # Hypothesis: Check for consistency compared to numeric scales.
            "user_prompt_template": "Please grade the following poem based on its '{criterion}' using a scale of A, B, C, D, E. Respond with ONLY the letter grade, enclosed in <grade> tags. Example: <grade>B</grade>... Poem:\n{text_input}\n\nYour grade (e.g., <grade>B</grade>):",
            "parse_fn": parse_letter, "normalize_fn": normalize_letter, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: A-E (system prompt)", 
            "data_source": "poems",
            "scale_type": "A-E", "labels": None, "system_prompt": "You are a precise and impartial poetry judge...",
            # Tests: Impact of system persona on letter grade scoring.
            "user_prompt_template": "Please grade the following poem based on its '{criterion}' using a scale of A, B, C, D, E. Respond with ONLY the letter grade, enclosed in <grade> tags. Example: <grade>A</grade>... Poem:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "parse_fn": parse_letter, "normalize_fn": normalize_letter, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-100 (user prompt)", 
            "data_source": "poems",
            "scale_type": "1-100", "labels": None, "system_prompt": None,
            # Tests: Adherence to a very granular numeric scale.
            # Hypothesis: May reveal more variance or difficulty in precise point assignment.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 100. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>87</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>87</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-100 (system prompt)", 
            "data_source": "poems",
            "scale_type": "1-100", "labels": None, "system_prompt": "You are a world-class poetry critic...",
            # Tests: Impact of a strong system persona on a granular scale.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 100. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>75</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>75</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: Creative (neutral labels, rubric, user prompt)", 
            "data_source": "poems",
            "scale_type": "CREATIVE", "labels": poem_specific_creative_labels, "system_prompt": None,
            # Tests: Ability to use abstract, non-numeric/non-letter labels from a rubric.
            # Hypothesis: Check consistency and if LLM maps these to an internal scale.
            "user_prompt_template": "Please rate the following poem based on its '{criterion}'. Use one of these categories:\n{rubric}... Poem:\n{text_input}\n\nYour category (Respond with one of the category names ONLY, enclosed in <label> tags, e.g., <label>CATEGORY_X98</label>):",
            "parse_fn": parse_creative_label, "normalize_fn": normalize_creative_label, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: Creative (neutral labels, rubric, system prompt)", 
            "data_source": "poems",
            "scale_type": "CREATIVE", "labels": poem_specific_creative_labels, "system_prompt": "You are a highly impartial, unbiased, and creative judge...",
            # Tests: System persona impact on using creative labels.
            "user_prompt_template": "Please rate the following poem based on its '{criterion}'. Use one of these categories:\n{rubric}... Poem:\n{text_input}\n\nYour category (Respond with one of the category names ONLY, enclosed in <label> tags, e.g., <label>CATEGORY_J12</label>):",
            "parse_fn": parse_creative_label, "normalize_fn": normalize_creative_label, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: Justification-then-Score (1-5, <score> tag)", 
            "data_source": "poems",
            "scale_type": "1-5", "labels": None, "system_prompt": None,
            # Tests: If requiring justification before scoring affects the score. Checks parsing of <score> tag.
            # Hypothesis: Justification might anchor the score or lead to more considered scores.
            "user_prompt_template": "Please explain your reasoning about the poem's {criterion}. After your explanation, provide the score from 1 to 5, enclosed in <score> tags. Example: <score>3</score>... Poem:\n{text_input}\n\nExplanation and Score (e.g., ...explanation... <score>3</score>):",
            "parse_fn": lambda resp, scale_type, **kwargs: parse_justification_score(resp)[0],
            "normalize_fn": normalize_justification_score, "explanation_fn": lambda resp: parse_justification_score(resp)[1],
            "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: Score-then-Justification (1-5, <score> tag)", 
            "data_source": "poems",
            "scale_type": "1-5", "labels": None, "system_prompt": None,
            # Tests: If scoring before justification affects the score. Checks parsing of <score> tag.
            # Hypothesis: Scoring first might lead to post-hoc rationalization in the explanation.
            "user_prompt_template": "Please score the following poem's {criterion} on a scale of 1 to 5, enclosed in <score> tags. Example: <score>4</score>. Then, briefly explain your score... Poem:\n{text_input}\n\nScore and Explanation (e.g., <score>4</score> ...explanation...):",
            "parse_fn": lambda resp, scale_type, **kwargs: parse_justification_score(resp)[0],
            "normalize_fn": normalize_justification_score, "explanation_fn": lambda resp: parse_justification_score(resp)[1],
            "default_criterion": "emotional impact and depth of meaning"
        },
        # --- New Variants for Sentiment/Toxicity --- 
        {
            "name": "Sentiment: A-E (A=VeryPositive)", "data_source": "sentiment_texts", "scale_type": "A-E",
            "criterion_override": "Perceived Sentiment", 
            "labels": [("A", "Very Positive"), ("B", "Positive"), ("C", "Neutral"), ("D", "Negative"), ("E", "Very Negative")],
            "invert_scale": False, "system_prompt": "You are an expert sentiment analyst.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade>). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "Sentiment: 1-5 (5=VeryPositive)", "data_source": "sentiment_texts", "scale_type": "1-5",
            "criterion_override": "Perceived Sentiment", 
            "labels": [("5", "Very Positive"), ("4", "Positive"), ("3", "Neutral"), ("2", "Negative"), ("1", "Very Negative")],
            "invert_scale": False, "system_prompt": "You are an expert sentiment analyst.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score>). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "Toxicity: A-E (A=VeryHighTox)", "data_source": "sentiment_texts", "scale_type": "A-E",
            "criterion_override": "Toxicity Level", 
            "labels": [("A", "Very High Toxicity"), ("B", "High Toxicity"), ("C", "Moderate Toxicity"), ("D", "Low Toxicity"), ("E", "Very Low Toxicity")],
            "invert_scale": False, "system_prompt": "You are an expert in content moderation and identifying toxicity.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade> for Very High Toxicity). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "Toxicity: 1-5 (5=VeryHighTox)", "data_source": "sentiment_texts", "scale_type": "1-5",
            "criterion_override": "Toxicity Level", 
            "labels": [("5", "Very High Toxicity"), ("4", "High Toxicity"), ("3", "Moderate Toxicity"), ("2", "Low Toxicity"), ("1", "Very Low Toxicity")],
            "invert_scale": False, "system_prompt": "You are an expert in content moderation and identifying toxicity.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score> for Very High Toxicity). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "Toxicity: A-E (A=VeryLowTox - Inverted)", "data_source": "sentiment_texts", "scale_type": "A-E",
            "criterion_override": "Toxicity Level", 
            "labels": [("A", "Very Low Toxicity"), ("B", "Low Toxicity"), ("C", "Moderate Toxicity"), ("D", "High Toxicity"), ("E", "Very High Toxicity")],
            "invert_scale": True, "system_prompt": "You are an expert in content moderation. Pay close attention to the rubric.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade> for Very Low Toxicity). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "Toxicity: Creative Labels (TOX_MAX=VeryHigh)", "data_source": "sentiment_texts", "scale_type": "CREATIVE",
            "criterion_override": "Toxicity Level", 
            "labels": [("TOX_MAX", "Very High Toxicity"), ("TOX_HIGH", "High Toxicity"), ("TOX_MED", "Moderate Toxicity"), ("TOX_LOW", "Low Toxicity"), ("TOX_MIN", "Very Low / No Toxicity")],
            "invert_scale": False, "system_prompt": "You are an expert in content moderation.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the category label (e.g., <label>TOX_MAX</label>). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour category (e.g., <label>TOX_MAX</label>):",
            "parse_fn": parse_creative_label, "normalize_fn": normalize_creative_label
        },
        # --- New Variants for Criterion Adherence (Sexism Example) ---
        {
            "name": "SexismPresence: 1-5 (5=HighSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "1-5",
            "criterion_override": "Degree of Sexist Content",
            "labels": [
                ("5", "Clear and strong sexist content"), 
                ("4", "Moderate sexist content"), 
                ("3", "Mild or ambiguous sexist content"), 
                ("2", "Very little to no sexist content"), 
                ("1", "No discernible sexist content")
            ],
            "invert_scale": False,
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains **direct sexist statements or expressions of gender-based prejudice/stereotypes**, according to the rubric. This is distinct from general hostility or criticism of discussions about sexism, unless that criticism itself employs direct gender-based prejudice. A high score (5) means the text *does* contain strong direct sexist content of this nature. A low score (1) means it does not. Adhere strictly to this instruction and the provided rubric definitions for sexist content. Respond with ONLY the numerical score, enclosed in <score> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score> for high sexism). Rubric for context:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "SexismPresence: 1-5 (5=HighSexism, CoT)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "1-5",
            "criterion_override": "Degree of Sexist Content",
            "labels": [
                ("5", "Clear and strong sexist content"),
                ("4", "Moderate sexist content"),
                ("3", "Mild or ambiguous sexist content"),
                ("2", "Very little to no sexist content"),
                ("1", "No discernible sexist content")
            ],
            "invert_scale": False,
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains **direct sexist statements or expressions of gender-based prejudice/stereotypes**, according to the rubric. This is distinct from general hostility or criticism of discussions about sexism, unless that criticism itself employs direct gender-based prejudice. A high score (5) means the text *does* contain strong direct sexist content of this nature. A low score (1) means it does not. Adhere strictly to this instruction and the provided rubric definitions for sexist content.",
            "user_prompt_template": (
                "Your task is to assess the '{criterion}' of the following text using a scale of 1 to 5, based on the provided rubric.\\n\\n"
                "First, write out in a step-by-step manner your reasoning for how you will arrive at the score. Explain how the text aligns (or doesn\'t) with the rubric definitions for sexist content.\\n\\n"
                "After your reasoning, print the single numerical score, enclosed in <score> tags (e.g., <score>5</score> for high sexism).\\n\\n"
                "Rubric for context:\\n{rubric}\\n\\n"
                "Text:\\n{text_input}\\n\\n"
                "Reasoning:\\n"
                
                "\\n\\n"
                "Score:\\n"
                
            ),
            "parse_fn": parse_numeric,
            "normalize_fn": normalize_numeric
        },
        {
            "name": "SexismAbsence: 1-5 (5=NoSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "1-5",
            "criterion_override": "Degree to which Sexist Content is Avoided",
            "labels": [
                ("5", "Completely avoids sexist content"), 
                ("4", "Largely avoids sexist content, very minor if any ambiguity"), 
                ("3", "Some potentially ambiguous elements, but not overtly sexist"), 
                ("2", "Contains mild or ambiguous sexist content"), 
                ("1", "Contains clear and strong sexist content")
            ],
            "invert_scale": False,
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based on how well it *avoids* sexist content, according to the rubric. A high score (5) means it successfully avoids sexist content. A low score (1) means it contains strong sexist content. Adhere strictly to this instruction. Respond with ONLY the numerical score, enclosed in <score> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score> for no sexism). Rubric for context:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "SexismPresence: A-E (A=HighSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "A-E",
            "criterion_override": "Degree of Sexist Content",
            "labels": [
                ("A", "Clear and strong sexist content"), 
                ("B", "Moderate sexist content"), 
                ("C", "Mild or ambiguous sexist content"), 
                ("D", "Very little to no sexist content"), 
                ("E", "No discernible sexist content")
            ],
            "invert_scale": False,
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains sexist content, according to the rubric. A high score (A) means it *does* contain strong sexist content. A low score (E) means it does not. Adhere strictly to this instruction. Respond with ONLY the letter grade, enclosed in <grade> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using letter grades A-E. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade> for high sexism). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "SexismPresence: A-E (A=NoSexism, Inverted to score HighSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "A-E",
            "criterion_override": "Degree of Sexist Content",
            "labels": [
                ("A", "No discernible sexist content"), 
                ("B", "Very little to no sexist content"), 
                ("C", "Mild or ambiguous sexist content"), 
                ("D", "Moderate sexist content"), 
                ("E", "Clear and strong sexist content")
            ],
            "invert_scale": True,
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains sexist content. Note the rubric carefully: 'A' signifies no sexism, while 'E' signifies clear and strong sexist content. Your final normalized score should reflect that high sexism gets a high score. Adhere strictly to this instruction. Respond with ONLY the letter grade, enclosed in <grade> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using letter grades A-E. Respond with ONLY the letter grade, enclosed in <grade> tags. Note the rubric definitions carefully. Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>E</grade> for high sexism, <grade>A</grade> for no sexism):",
            "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "HostileDismissalSexism: 1-5 (5=HighDismissal)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "1-5",
            "criterion_override": "Degree of Hostile Dismissal of Sexism Claims",
            "labels": [
                ("5", "Strongly hostile and dismissive of sexism claims, may use aggressive language or personal attacks against those raising concerns."),
                ("4", "Clearly dismissive of sexism claims, suggests they are invalid or exaggerated, may use belittling tone."),
                ("3", "Minimizes or downplays sexism claims, implies they are unimportant or overblown, but without overt hostility."),
                ("2", "Does not dismiss sexism claims, may acknowledge them or discuss them neutrally, or is irrelevant to the topic."),
                ("1", "Actively supports or validates discussion of sexism claims, or expresses clear anti-sexist stance.")
            ],
            "invert_scale": False,
            "system_prompt": "You are an objective content analyst. Your task is to assess the provided text based *only* on the degree to which it exhibits **'hostile dismissal of sexism claims'.** This refers to language that aggressively invalidates, belittles, or attacks the notion of sexism or those who discuss it. For this specific scoring task, you should distinguish this from, and **not primarily score for, direct sexist statements about a gender** (e.g., stereotypes or expressions of gender-based prejudice), *unless those statements are an integral part of the hostile dismissal itself.* Your primary focus is the act of trying to shut down, mock, or aggressively invalidate the conversation about sexism or those raising concerns. A high score (5) means strong hostile dismissal. A low score (1) means no such dismissal or even support for discussing sexism. Adhere strictly to the rubric.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using a scale of 1 to 5. Respond with only the number, enclosed in <score> tags. Rubric for context:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>3</score>):",
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        # --- NEW Few-Shot Variant for SexismPresence: 1-5 ---
        {
            "name": "SexismPresence: 1-5 (5=HighSexism, few-shot)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "1-5",
            "criterion_override": "Degree of Sexist Content",
            "labels": [
                ("5", "Clear and strong sexist content"), 
                ("4", "Moderate sexist content"), 
                ("3", "Mild or ambiguous sexist content"), 
                ("2", "Very little to no sexist content"), 
                ("1", "No discernible sexist content")
            ],
            "invert_scale": False,
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains **direct sexist statements or expressions of gender-based prejudice/stereotypes**, according to the rubric. This is distinct from general hostility or criticism of discussions about sexism, unless that criticism itself employs direct gender-based prejudice. A high score (5) means the text *does* contain strong direct sexist content of this nature. A low score (1) means it does not. Adhere strictly to this instruction and the provided rubric definitions for sexist content. Respond with ONLY the numerical score, enclosed in <score> tags.",
            "user_prompt_template": (
                "{few_shot_examples_section}"
                "Now, please assess the '{criterion}' of the following text using a scale of 1 to 5. "
                "Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score> for high sexism). Rubric for context:\\n{rubric}\\n\\n"
                "Text:\\n{text_input}\\n\\n"
                "Criterion for this text: '{criterion}'\\n"
                "Your score (e.g., <score>5</score>):"
            ),
            "parse_fn": parse_numeric, "normalize_fn": normalize_numeric,
            "few_shot_example_set_id": "sexism_presence_1_5_examples"
        },
        # --- End NEW ---
    ]
    for v in all_variants:
        if "temperature" in v:
            del v["temperature"]
        if "{poem}" in v["user_prompt_template"]:
            v["user_prompt_template"] = v["user_prompt_template"].replace("{poem}", "{text_input}")
        if v["data_source"] == "poems" and "default_criterion" not in v:
            v["default_criterion"] = "emotional impact and depth of meaning"
        if "few_shot_example_set_id" in v and v["few_shot_example_set_id"]:
            if "{few_shot_examples_section}" not in v["user_prompt_template"]:
                pass

    return all_variants 