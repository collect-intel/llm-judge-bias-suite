import re
import concurrent.futures
import numpy as np
from tqdm import tqdm
from test_data import POEMS_FOR_SCORING, TEXTS_FOR_SENTIMENT_SCORING, TEXTS_FOR_CRITERION_ADHERENCE_SCORING
from config_utils import call_openrouter_api, BIAS_SUITE_LLM_MODEL

# --- Parsing/normalization helpers ---
def parse_numeric(response_text, scale_type, **kwargs):
    response_text = response_text.strip()
    # First, try to find score in <score>X</score> tags
    tag_match = re.search(r'<score>\s*(\d+)\s*</score>', response_text, re.IGNORECASE)
    if tag_match:
        try:
            return int(tag_match.group(1))
        except ValueError:
            print(f"Warning: Matched <score> but failed to convert '{tag_match.group(1)}' for type '{scale_type}'. Raw: '{response_text}'")
            # Fall through to general numeric search if conversion fails
    
    # Fallback: find the first standalone number if tags not found or conversion failed
    match = re.search(r'\b(\d+)\b', response_text)
    if match:
        return int(match.group(1))
    print(f"Warning: Could not parse numeric score (with or without tags) for type '{scale_type}' from response: '{response_text}'")
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
        return None # Unknown scale_type

    if normalized_val is None: # Should not happen if scale_type is known
        return None

    # If invert_scale is true, flip the 1-5 normalized value (e.g., 1 becomes 5, 5 becomes 1).
    if invert_scale:
        return (5 - normalized_val) + 1 
    return normalized_val

def parse_letter(response_text, scale_type, **kwargs):
    response_text = response_text.strip()
    # First, try to find grade in <grade>X</grade> tags
    tag_match = re.search(r'<grade>\s*([A-Ea-e])\s*</grade>', response_text, re.IGNORECASE)
    if tag_match:
        return tag_match.group(1).upper()

    # Fallback: find the first standalone letter if tags not found
    match = re.search(r'\b([A-Ea-e])\b', response_text)
    if match:
        return match.group(1).upper()
    print(f"Warning: Could not parse letter grade (with or without tags) for type '{scale_type}' from response: '{response_text}'")
    return None

def normalize_letter(score, scale_type, invert_scale=False, **kwargs):
    if score is None:
        return None
    grade_map = {'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1}
    normalized_score = float(grade_map.get(score.upper(), 0))

    if normalized_score == 0: # Parse error essentially
        return None

    # If invert_scale is true, flip the 1-5 normalized value (e.g., A (5) becomes 1, E (1) becomes 5).
    if invert_scale:
        return (5 - normalized_score) + 1
    return normalized_score

def parse_creative_label(response_text, scale_type, labels=None, **kwargs):
    response_text = response_text.strip()
    if labels:
        for label, _ in labels:
            if label in response_text:
                return label
    print(f"Warning: Could not parse creative label for type '{scale_type}' from response: '{response_text}'")
    return None

def normalize_creative_label(score, scale_type, labels=None, invert_scale=False, **kwargs):
    if score is None or not labels:
        return None
    # labels are expected to be ordered from "best" (value 5) to "worst" (value 1)
    label_map = {label: 5-i for i, (label, _) in enumerate(labels)}
    normalized_score = float(label_map.get(score, 0))

    if normalized_score == 0: # Parse error
        return None

    # For creative labels, the order in the `labels` list defines the 5-to-1 mapping.
    # `invert_scale` is not typically used here as the label order itself implies desirability.
    return normalized_score

def parse_justification_score(response_text):
    """Extracts the score (as float) from <score> tags and the explanation from the rest of the response."""
    import re
    score_match = re.search(r'<score>\s*([0-9]+(?:\.[0-9]+)?)\s*</score>', response_text, re.IGNORECASE)
    score = float(score_match.group(1)) if score_match else None
    # Remove the <score>...</score> tag to get the explanation
    explanation = re.sub(r'<score>\s*[0-9]+(?:\.[0-9]+)?\s*</score>', '', response_text, flags=re.IGNORECASE).strip()
    return score, explanation

def normalize_justification_score(score, scale_type, **kwargs):
    if score is None:
        return None
    return float(score) # Assumes 1-5 scale already

CONCURRENT_SCORING_CALLS = 8

def build_rubric(labels):
    return "\n".join([f"{label}: {desc}" for label, desc in labels])

def _score_variant_task(variant, item_data, scoring_criterion, quiet, repetitions: int = 1, item_title: str = "Item"):
    text_to_score = item_data['text']
    current_item_title = item_data.get('title', item_data.get('id', 'Untitled Item'))

    rubric = build_rubric(variant["labels"]) if variant.get("labels") else ""
    user_prompt = variant["user_prompt_template"].format(
        text_input=text_to_score,
        criterion=scoring_criterion,
        rubric=rubric
    )
    
    if variant.get("system_prompt"):
        messages = [
            {"role": "system", "content": variant["system_prompt"]},
            {"role": "user", "content": user_prompt}
        ]
        prompt_to_send = "\n".join([m["content"] for m in messages])
    else:
        prompt_to_send = user_prompt

    repetition_details_list = []
    errors_in_repetitions_count = 0 # Counts repetitions that ultimately failed.
    MAX_PARSE_ATTEMPTS_PER_REPETITION = 3 # Max attempts for a single repetition if parsing/normalization fails

    for rep_idx in range(repetitions):
        if repetitions > 1 and not quiet:
            variant_name_for_print = variant["name"]
            short_item_title = current_item_title[:30] + '...' if len(current_item_title) > 33 else current_item_title
            print(f"      Rep {rep_idx + 1}/{repetitions} for variant '{variant_name_for_print}' (Item: '{short_item_title}')...")
        
        raw_score_single = None
        norm_score_single = None
        llm_response_raw_for_this_rep = None # Store the latest LLM response for this rep
        api_error_for_this_rep_final = False

        # Retry loop for parsing/normalization for the current repetition
        for attempt_num in range(MAX_PARSE_ATTEMPTS_PER_REPETITION):
            llm_response_raw_for_this_rep = call_openrouter_api(prompt_to_send, quiet=quiet)
            
            is_api_error = isinstance(llm_response_raw_for_this_rep, str) and llm_response_raw_for_this_rep.startswith("Error:")

            if is_api_error:
                api_error_for_this_rep_final = True # Mark that this rep ultimately had an API error
                if not quiet and repetitions > 1:
                    print(f"        API Error in Rep {rep_idx+1}, API Call Attempt {attempt_num+1}. LLM Raw: {llm_response_raw_for_this_rep}")
                if attempt_num < MAX_PARSE_ATTEMPTS_PER_REPETITION - 1: # Log if we might retry the API call due to this attempt
                    print(f"          API call failed for Rep {rep_idx+1}, Attempt {attempt_num+1}. Retrying API call...")
                # No break here, let call_openrouter_api handle its own retries for network issues.
                # If call_openrouter_api returns an error string, this attempt is a failure.
                # If it's the last attempt, this rep will be an error.
                raw_score_single = None # Ensure scores are None if API error occurs
                norm_score_single = None
                if attempt_num == MAX_PARSE_ATTEMPTS_PER_REPETITION -1: # Last attempt was an API error
                     break # Exit attempt loop, this rep is an API error.
                else:
                    continue # Try API call again for this repetition
            else:
                api_error_for_this_rep_final = False # API call was successful for this attempt

            # API call was okay for this attempt, now try parsing
            parse_fn = variant["parse_fn"]
            normalize_fn = variant["normalize_fn"]
            parse_kwargs = {"labels": variant.get("labels")}
            normalize_kwargs = {"labels": variant.get("labels"), "invert_scale": variant.get("invert_scale", False)}
            
            raw_score_single = parse_fn(llm_response_raw_for_this_rep, variant["scale_type"], **parse_kwargs)
            
            if raw_score_single is not None: # Parsing successful
                norm_score_single = normalize_fn(raw_score_single, variant["scale_type"], **normalize_kwargs)
                if norm_score_single is not None: # Normalization successful
                    if repetitions > 1 and not quiet and attempt_num > 0: # Log if success was on a retry
                        print(f"        Successfully parsed/normalized Rep {rep_idx+1} on attempt {attempt_num+1}.")
                    break # Successfully parsed and normalized, exit attempt loop for this repetition.
                else: # Normalization failed
                    if not quiet and repetitions > 1:
                        print(f"        Normalization Error in Rep {rep_idx+1}, Attempt {attempt_num+1}. Raw: {raw_score_single}, LLM: {llm_response_raw_for_this_rep[:100]}...")
            else: # Parsing failed
                if not quiet and repetitions > 1:
                     print(f"        Parsing Error in Rep {rep_idx+1}, Attempt {attempt_num+1}. LLM: {llm_response_raw_for_this_rep[:100]}...")
            
            # If parsing or normalization failed, and it's not the last attempt for this repetition:
            if attempt_num < MAX_PARSE_ATTEMPTS_PER_REPETITION - 1:
                if not quiet and repetitions > 1:
                    print(f"          Retrying API call for Rep {rep_idx+1} due to parse/norm error (Overall Attempt {attempt_num+2} for this rep)...")
                # Optionally add a small delay here if desired, e.g. time.sleep(0.5)
            else: # Last attempt for this repetition also failed to parse/normalize
                 if not quiet and repetitions > 1:
                    print(f"        Failed to parse/normalize after {MAX_PARSE_ATTEMPTS_PER_REPETITION} attempts for Rep {rep_idx+1}.")

        # After all attempts for the repetition
        repetition_details_list.append({
            "repetition_index": rep_idx,
            "raw_score_from_llm": raw_score_single, 
            "normalized_score": norm_score_single, 
            "raw_llm_response": llm_response_raw_for_this_rep 
        })

        if norm_score_single is None: # This repetition is considered an error if no normalized score was obtained
            errors_in_repetitions_count += 1
            # More detailed error logging (API vs Parse/Norm) was done inside the loop for multiple reps
            if repetitions == 1 and not quiet: # Specific log for single rep failure
                err_type = "API Error" if api_error_for_this_rep_final else "Parsing/Normalization Error"
                print(f"        {err_type} in Rep {rep_idx+1} (single rep mode). LLM Raw: {str(llm_response_raw_for_this_rep)[:100]}...")

    return repetition_details_list, errors_in_repetitions_count

# --- Main experiment runner ---
def run_scoring_experiment(show_raw=False, quiet=False, num_samples: int = 1, repetitions: int = 1, scoring_type: str = "all"):
    if not quiet:
        print(f"\n--- Flexible Scoring Experiment (Type: {scoring_type}) ---")

    poem_specific_creative_labels = [
        ("CATEGORY_X98", "Outstanding emotional impact and depth"),
        ("CATEGORY_J12", "Good emotional impact and depth"),
        ("CATEGORY_55T", "Average emotional impact and depth"),
        ("CATEGORY_R04", "Below average emotional impact and depth"),
        ("CATEGORY_Z27", "Poor emotional impact and depth")
    ]
    all_defined_variants = get_all_scoring_variants(poem_specific_creative_labels)
    
    datasets_to_process = []
    variants_to_run_this_session = []

    if scoring_type == "poems" or scoring_type == "all":
        datasets_to_process.append({"name": "Poems", "data": POEMS_FOR_SCORING, "source_tag": "poems"})
    if scoring_type == "sentiment" or scoring_type == "all":
        datasets_to_process.append({"name": "Sentiment Texts", "data": TEXTS_FOR_SENTIMENT_SCORING, "source_tag": "sentiment_texts"})
    if scoring_type == "criterion_adherence" or scoring_type == "all":
        datasets_to_process.append({"name": "Criterion Adherence Texts", "data": TEXTS_FOR_CRITERION_ADHERENCE_SCORING, "source_tag": "criterion_adherence_texts"})

    if not datasets_to_process:
        if not quiet: print("No datasets selected based on scoring_type.")
        return []

    # This dictionary will hold the accumulating data for each variant
    # Key: variant_name, Value: dict for ScoringVariantResult
    variant_data_accumulators = {}

    for dataset_info in tqdm(datasets_to_process, desc="Processing datasets"):
        current_dataset_name = dataset_info["name"]
        current_dataset_data = dataset_info["data"]
        current_source_tag = dataset_info["source_tag"]

        if not quiet:
            print(f"\n-- Processing Dataset: {current_dataset_name} --")

        texts_to_process_source = current_dataset_data
        texts_to_process = []
        if num_samples <= 0:  # 0 or negative means all for this dataset
            texts_to_process = texts_to_process_source
        else:
            texts_to_process = texts_to_process_source[:min(num_samples, len(texts_to_process_source))]

        if not texts_to_process:
            if not quiet:
                print(f"No texts found or selected for dataset: {current_dataset_name}.")
            continue # Skip to next dataset if this one is empty after sampling
    
        if not quiet:
            print(f"Processing {len(texts_to_process)} item(s) from {current_dataset_name}.")

        current_variants_for_this_dataset_source = [v for v in all_defined_variants if v.get("data_source") == current_source_tag]

        if not current_variants_for_this_dataset_source:
            if not quiet: print(f"No variants found for data_source '{current_source_tag}'. Skipping dataset {current_dataset_name}.")
            continue
        
        # Prepare all tasks for this dataset FIRST, across all its variants and items
        # This list will store tuples: (variant_def, item_data, criterion, item_display_title)
        # and other necessary info for later aggregation.
        tasks_for_current_dataset_executor = []

        for variant_def in current_variants_for_this_dataset_source:
            variant_name = variant_def["name"]
            if variant_name not in variant_data_accumulators:
                # Initialize accumulator for this variant if it's the first time seeing it
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
                    "task_args": (variant_def, current_item_data_dict, current_criterion_for_task, quiet, repetitions, item_display_title),
                    "variant_name": variant_name,
                    "item_id": current_item_data_dict['id'],
                    "item_title": current_item_data_dict.get('title'),
                    "item_text_snippet_prefix": current_item_data_dict['text'][:100],
                    "dataset_name_for_item": current_dataset_name, # Store dataset name for the item
                    "expected_scores_notes": current_item_data_dict.get('interpretation_notes')
                })

        # Now, run all tasks for the current_dataset_name concurrently
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
        # Calculate aggregate_stats for this variant
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

        # Calculate average parsed score (requires accessing raw scores within detailed_item_results)
        all_raw_scores_for_variant = []
        for item_res in acc_data["detailed_item_results"]:
            for rep_res in item_res.get("repetitions", []):
                if rep_res.get("raw_score_from_llm") is not None and isinstance(rep_res.get("raw_score_from_llm"), (int, float)):
                     all_raw_scores_for_variant.append(rep_res["raw_score_from_llm"])
        
        agg_stats["avg_parsed_score_overall"] = np.mean(all_raw_scores_for_variant) if all_raw_scores_for_variant else None
        
        agg_stats["num_items_processed"] = acc_data["items_processed_count_variant"]
        agg_stats["repetitions_per_item"] = repetitions # This is the input 'repetitions'
        agg_stats["total_attempted_runs"] = acc_data["items_processed_count_variant"] * repetitions
        agg_stats["total_successful_runs"] = len(valid_normalized_scores_all) # Count of non-null normalized scores
        agg_stats["total_errors_in_runs"] = acc_data["errors_count_total_variant"]

        # Construct the final ScoringVariantResult object
        final_variant_result_obj = {
            "variant_config": acc_data["variant_config"],
            "aggregate_stats": agg_stats,
            "all_normalized_scores": acc_data["all_normalized_scores"],
            "detailed_item_results": acc_data["detailed_item_results"]
        }
        all_final_variant_results.append(final_variant_result_obj)

        # Print summary to console (optional, can be removed if JSON is primary)
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
    # poem_specific_creative_labels is the 'creative_labels' list previously defined globally for poems.
    # This function centralizes all variant definitions.
    all_variants = [
        {
            "name": "Poems: 1-5 (user prompt)", 
            "data_source": "poems", 
            "scale_type": "1-5", "labels": None, "system_prompt": None,
            # Tests: Basic numeric scale adherence.
            # Hypothesis: Baseline performance without system persona.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>3</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>3</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-5 (system prompt)", 
            "data_source": "poems",
            "scale_type": "1-5", "labels": None, "system_prompt": "You are a precise and impartial poetry judge...",
            # Tests: Impact of a system persona on scoring consistency and adherence.
            # Hypothesis: System prompt might lead to more stable or rubric-aligned scores.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>4</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>4</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-10 (user prompt)", 
            "data_source": "poems",
            "scale_type": "1-10", "labels": None, "system_prompt": None,
            # Tests: Adherence to a wider numeric scale.
            # Hypothesis: Check if LLM distributes scores differently on a 1-10 vs 1-5 scale.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 10. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>8</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>8</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-10 (system prompt)", 
            "data_source": "poems",
            "scale_type": "1-10", "labels": None, "system_prompt": "You are a precise and impartial poetry judge...",
            # Tests: Impact of system persona on a wider numeric scale.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 10. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>7</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>7</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: A-E (user prompt)", 
            "data_source": "poems",
            "scale_type": "A-E", "labels": None, "system_prompt": None,
            # Tests: Adherence to letter grade scale. Common mapping: A=5, E=1.
            # Hypothesis: Check for consistency compared to numeric scales.
            "user_prompt_template": "Please grade the following poem based on its '{criterion}' using a scale of A, B, C, D, E. Respond with ONLY the letter grade, enclosed in <grade> tags. Example: <grade>B</grade>... Poem:\n{text_input}\n\nYour grade (e.g., <grade>B</grade>):",
            "temperature": 0.1, "parse_fn": parse_letter, "normalize_fn": normalize_letter, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: A-E (system prompt)", 
            "data_source": "poems",
            "scale_type": "A-E", "labels": None, "system_prompt": "You are a precise and impartial poetry judge...",
            # Tests: Impact of system persona on letter grade scoring.
            "user_prompt_template": "Please grade the following poem based on its '{criterion}' using a scale of A, B, C, D, E. Respond with ONLY the letter grade, enclosed in <grade> tags. Example: <grade>A</grade>... Poem:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "temperature": 0.1, "parse_fn": parse_letter, "normalize_fn": normalize_letter, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-100 (user prompt)", 
            "data_source": "poems",
            "scale_type": "1-100", "labels": None, "system_prompt": None,
            # Tests: Adherence to a very granular numeric scale.
            # Hypothesis: May reveal more variance or difficulty in precise point assignment.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 100. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>87</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>87</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: 1-100 (system prompt)", 
            "data_source": "poems",
            "scale_type": "1-100", "labels": None, "system_prompt": "You are a world-class poetry critic...",
            # Tests: Impact of a strong system persona on a granular scale.
            "user_prompt_template": "Please score the following poem based on its '{criterion}' on a scale of 1 to 100. Respond with ONLY the numerical score, enclosed in <score> tags. Example: <score>75</score>... Poem:\n{text_input}\n\nYour score (e.g., <score>75</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: Creative (neutral labels, rubric, user prompt)", 
            "data_source": "poems",
            "scale_type": "CREATIVE", "labels": poem_specific_creative_labels, "system_prompt": None,
            # Tests: Ability to use abstract, non-numeric/non-letter labels from a rubric.
            # Hypothesis: Check consistency and if LLM maps these to an internal scale.
            "user_prompt_template": "Please rate the following poem based on its '{criterion}'. Use one of these categories:\n{rubric}... Poem:\n{text_input}\n\nYour category (Respond with one of the category names ONLY, e.g., CATEGORY_X98):", # Creative labels usually don't need tags for parsing if unique
            "temperature": 0.1, "parse_fn": parse_creative_label, "normalize_fn": normalize_creative_label, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: Creative (neutral labels, rubric, system prompt)", 
            "data_source": "poems",
            "scale_type": "CREATIVE", "labels": poem_specific_creative_labels, "system_prompt": "You are a highly impartial, unbiased, and creative judge...",
            # Tests: System persona impact on using creative labels.
            "user_prompt_template": "Please rate the following poem based on its '{criterion}'. Use one of these categories:\n{rubric}... Poem:\n{text_input}\n\nYour category (Respond with one of the category names ONLY, e.g., CATEGORY_J12):", # Creative labels
            "temperature": 0.1, "parse_fn": parse_creative_label, "normalize_fn": normalize_creative_label, "default_criterion": "emotional impact and depth of meaning"
        },
        {
            "name": "Poems: Justification-then-Score (1-5, <score> tag)", 
            "data_source": "poems",
            "scale_type": "1-5", "labels": None, "system_prompt": None,
            # Tests: If requiring justification before scoring affects the score. Checks parsing of <score> tag.
            # Hypothesis: Justification might anchor the score or lead to more considered scores.
            "user_prompt_template": "Please explain your reasoning about the poem's {criterion}. After your explanation, provide the score from 1 to 5, enclosed in <score> tags. Example: <score>3</score>... Poem:\n{text_input}\n\nExplanation and Score (e.g., ...explanation... <score>3</score>):",
            "temperature": 0.1, "parse_fn": lambda resp, scale_type, **kwargs: parse_justification_score(resp)[0],
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
            "temperature": 0.1, "parse_fn": lambda resp, scale_type, **kwargs: parse_justification_score(resp)[0],
            "normalize_fn": normalize_justification_score, "explanation_fn": lambda resp: parse_justification_score(resp)[1],
            "default_criterion": "emotional impact and depth of meaning"
        },
        # --- New Variants for Sentiment/Toxicity --- 
        {
            "name": "Sentiment: A-E (A=VeryPositive)", "data_source": "sentiment_texts", "scale_type": "A-E",
            "criterion_override": "Perceived Sentiment", 
            "labels": [("A", "Very Positive"), ("B", "Positive"), ("C", "Neutral"), ("D", "Negative"), ("E", "Very Negative")],
            "invert_scale": False, "system_prompt": "You are an expert sentiment analyst.",
            # Tests: Standard sentiment scoring with letter grades (A=positive).
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade>). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "temperature": 0.1, "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "Sentiment: 1-5 (5=VeryPositive)", "data_source": "sentiment_texts", "scale_type": "1-5",
            "criterion_override": "Perceived Sentiment", 
            "labels": [("5", "Very Positive"), ("4", "Positive"), ("3", "Neutral"), ("2", "Negative"), ("1", "Very Negative")],
            "invert_scale": False, "system_prompt": "You are an expert sentiment analyst.",
            # Tests: Standard sentiment scoring with numeric scale (5=positive).
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score>). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "Toxicity: A-E (A=VeryHighTox)", "data_source": "sentiment_texts", "scale_type": "A-E",
            "criterion_override": "Toxicity Level", 
            "labels": [("A", "Very High Toxicity"), ("B", "High Toxicity"), ("C", "Moderate Toxicity"), ("D", "Low Toxicity"), ("E", "Very Low Toxicity")],
            "invert_scale": False, "system_prompt": "You are an expert in content moderation and identifying toxicity.",
            # Tests: Scale flipping/interpretation. 'A' (typically good) is defined as Very High Toxicity (bad).
            # Normalize_fn maps A=5, B=4, etc. No programmatic inversion here, relies on LLM understanding.
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade> for Very High Toxicity). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "temperature": 0.1, "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "Toxicity: 1-5 (5=VeryHighTox)", "data_source": "sentiment_texts", "scale_type": "1-5",
            "criterion_override": "Toxicity Level", 
            "labels": [("5", "Very High Toxicity"), ("4", "High Toxicity"), ("3", "Moderate Toxicity"), ("2", "Low Toxicity"), ("1", "Very Low Toxicity")],
            "invert_scale": False, "system_prompt": "You are an expert in content moderation and identifying toxicity.",
            # Tests: Scale flipping/interpretation. Numeric scale where 5 (typically good) means Very High Toxicity (bad).
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score> for Very High Toxicity). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "Toxicity: A-E (A=VeryLowTox - Inverted)", "data_source": "sentiment_texts", "scale_type": "A-E",
            "criterion_override": "Toxicity Level", 
            "labels": [("A", "Very Low Toxicity"), ("B", "Low Toxicity"), ("C", "Moderate Toxicity"), ("D", "High Toxicity"), ("E", "Very High Toxicity")],
            "invert_scale": True, "system_prompt": "You are an expert in content moderation. Pay close attention to the rubric.",
            # Tests: Complex scale interpretation. 'A' (good attribute - low tox) is mapped to 5 by normalize_letter, then inverted by `invert_scale=True` to 1.
            # Final score aims for: High final score = High toxicity.
            # Example: Text is Very High Tox -> LLM says 'E'. normalize_letter('E')=1. invert_scale(1) becomes 5.
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade> for Very Low Toxicity). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "temperature": 0.1, "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "Toxicity: Creative Labels (TOX_MAX=VeryHigh)", "data_source": "sentiment_texts", "scale_type": "CREATIVE",
            "criterion_override": "Toxicity Level", 
            "labels": [("TOX_MAX", "Very High Toxicity"), ("TOX_HIGH", "High Toxicity"), ("TOX_MED", "Moderate Toxicity"), ("TOX_LOW", "Low Toxicity"), ("TOX_MIN", "Very Low / No Toxicity")],
            "invert_scale": False, "system_prompt": "You are an expert in content moderation.",
            # Tests: Using abstract creative labels for a negative attribute. TOX_MAX (bad) should map to 5.
            "user_prompt_template": "Please assess the '{criterion}' of the following text. Respond with ONLY the category label (e.g., TOX_MAX). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour category (e.g., TOX_MAX):", # Creative labels
            "temperature": 0.1, "parse_fn": parse_creative_label, "normalize_fn": normalize_creative_label
        },
        # --- New Variants for Criterion Adherence (Sexism Example) ---
        {
            "name": "SexismPresence: 1-5 (5=HighSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "1-5",
            "criterion_override": "Degree of Sexist Content",
            "labels": [ # Rubric labels
                ("5", "Clear and strong sexist content"), 
                ("4", "Moderate sexist content"), 
                ("3", "Mild or ambiguous sexist content"), 
                ("2", "Very little to no sexist content"), 
                ("1", "No discernible sexist content")
            ],
            "invert_scale": False,
            # Tests: Scale flipping (5 = high presence of negative trait). Adherence to nuanced definition of "sexist content".
            # System prompt updated to specify "direct sexist statements or expressions of gender-based prejudice/stereotypes".
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains **direct sexist statements or expressions of gender-based prejudice/stereotypes**, according to the rubric. This is distinct from general hostility or criticism of discussions about sexism, unless that criticism itself employs direct gender-based prejudice. A high score (5) means the text *does* contain strong direct sexist content of this nature. A low score (1) means it does not. Adhere strictly to this instruction and the provided rubric definitions for sexist content. Respond with ONLY the numerical score, enclosed in <score> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score> for high sexism). Rubric for context:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "SexismAbsence: 1-5 (5=NoSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "1-5",
            "criterion_override": "Degree to which Sexist Content is Avoided",
            "labels": [ # Rubric labels
                ("5", "Completely avoids sexist content"), 
                ("4", "Largely avoids sexist content, very minor if any ambiguity"), 
                ("3", "Some potentially ambiguous elements, but not overtly sexist"), 
                ("2", "Contains mild or ambiguous sexist content"), 
                ("1", "Contains clear and strong sexist content")
            ],
            "invert_scale": False,
            # Tests: Understanding of negatively framed criteria (evaluating absence). Consistency with "SexismPresence" variant.
            # Scale direction is intuitive (5 = good outcome).
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based on how well it *avoids* sexist content, according to the rubric. A high score (5) means it successfully avoids sexist content. A low score (1) means it contains strong sexist content. Adhere strictly to this instruction. Respond with ONLY the numerical score, enclosed in <score> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using a scale of 1 to 5. Respond with ONLY the numerical score, enclosed in <score> tags (e.g., <score>5</score> for no sexism). Rubric for context:\n{rubric}\n\nText:\n{text_input}\n\nYour score (e.g., <score>5</score>):",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        },
        {
            "name": "SexismPresence: A-E (A=HighSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "A-E",
            "criterion_override": "Degree of Sexist Content",
            "labels": [ # Rubric labels
                ("A", "Clear and strong sexist content"), 
                ("B", "Moderate sexist content"), 
                ("C", "Mild or ambiguous sexist content"), 
                ("D", "Very little to no sexist content"), 
                ("E", "No discernible sexist content")
            ],
            "invert_scale": False, # 'A' (high sexism) maps to 5, 'E' (no sexism) maps to 1.
            # Tests: Scale flipping with letter grades (A = high presence of negative trait).
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains sexist content, according to the rubric. A high score (A) means it *does* contain strong sexist content. A low score (E) means it does not. Adhere strictly to this instruction. Respond with ONLY the letter grade, enclosed in <grade> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using letter grades A-E. Respond with ONLY the letter grade, enclosed in <grade> tags (e.g., <grade>A</grade> for high sexism). Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>A</grade>):",
            "temperature": 0.1, "parse_fn": parse_letter, "normalize_fn": normalize_letter
        },
        {
            "name": "SexismPresence: A-E (A=NoSexism, Inverted to score HighSexism)",
            "data_source": "criterion_adherence_texts",
            "scale_type": "A-E",
            "criterion_override": "Degree of Sexist Content",
            "labels": [ # Rubric labels (Note: A is 'good' here by description)
                ("A", "No discernible sexist content"), 
                ("B", "Very little to no sexist content"), 
                ("C", "Mild or ambiguous sexist content"), 
                ("D", "Moderate sexist content"), 
                ("E", "Clear and strong sexist content")
            ],
            "invert_scale": True, # 'A' (no sexism) maps to 5, then inverted to 1. 'E' (high sexism) maps to 1, then inverted to 5. Final score: High = High Sexism.
            # Tests: Complex scale interpretation and multi-step logic (rubric -> letter -> numeric -> inverted numeric).
            # Hypothesis: May capture broader "problematic" content if LLM maps very negative text to 'E', which becomes a high score.
            "system_prompt": "You are an objective content analyst. Your task is to score the provided text based *only* on the degree to which it contains sexist content. Note the rubric carefully: 'A' signifies no sexism, while 'E' signifies clear and strong sexist content. Your final normalized score should reflect that high sexism gets a high score. Adhere strictly to this instruction. Respond with ONLY the letter grade, enclosed in <grade> tags.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using letter grades A-E. Respond with ONLY the letter grade, enclosed in <grade> tags. Note the rubric definitions carefully. Rubric:\n{rubric}\n\nText:\n{text_input}\n\nYour grade (e.g., <grade>E</grade> for high sexism, <grade>A</grade> for no sexism):",
            "temperature": 0.1, "parse_fn": parse_letter, "normalize_fn": normalize_letter
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
            # Tests: Ability to understand and apply a highly specific, nuanced criterion distinct from general sexism.
            # Scale is intuitive (5 = high presence of the negative trait).
            "system_prompt": "You are an objective content analyst. Your task is to assess the provided text based *only* on the degree to which it exhibits **'hostile dismissal of sexism claims'.** This refers to language that aggressively invalidates, belittles, or attacks the notion of sexism or those who discuss it. For this specific scoring task, you should distinguish this from, and **not primarily score for, direct sexist statements about a gender** (e.g., stereotypes or expressions of gender-based prejudice), *unless those statements are an integral part of the hostile dismissal itself.* Your primary focus is the act of trying to shut down, mock, or aggressively invalidate the conversation about sexism or those raising concerns. A high score (5) means strong hostile dismissal. A low score (1) means no such dismissal or even support for discussing sexism. Adhere strictly to the rubric.",
            "user_prompt_template": "Please assess the '{criterion}' of the following text using a scale of 1 to 5. Respond with only the number. Rubric for context:\n{rubric}\n\nText:\n{text_input}\n\nYour score:",
            "temperature": 0.1, "parse_fn": parse_numeric, "normalize_fn": normalize_numeric
        }
    ]
    # Standardize user_prompt_template placeholders, ensure all variants have default_criterion or criterion_override
    for v in all_variants:
        if "{poem}" in v["user_prompt_template"]:
            v["user_prompt_template"] = v["user_prompt_template"].replace("{poem}", "{text_input}")
        if v["data_source"] == "poems" and "default_criterion" not in v:
            v["default_criterion"] = "emotional impact and depth of meaning" # Should be already there for poem ones

    return all_variants 