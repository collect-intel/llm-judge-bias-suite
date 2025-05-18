import random
import collections
from tqdm import tqdm
import concurrent.futures
from test_data import RANKING_SETS
from config_utils import call_openrouter_api
import re

# --- Elo rating helpers ---
def elo_expected(rating_a, rating_b):
    return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))

def elo_update(rating, expected, score, k=32):
    return rating + k * (score - expected)

# --- Response parsing helpers ---
def parse_decision_tag(llm_response, allow_tie=False):
    # Parses the LLM response for a decision, expecting <decision>A/B/C</decision>.
    # More leniently checks for raw A/B/C if tags are missing.
    response_stripped = llm_response.strip()
    
    # 1. Try to find content within <decision> tags
    match = re.search(r'<decision>\s*(.*?)\s*</decision>', response_stripped, re.IGNORECASE | re.DOTALL)
    
    decision_content = None
    if match:
        decision_content = match.group(1).strip().upper()
        if decision_content == 'A': return 'A'
        if decision_content == 'B': return 'B'
        if allow_tie and decision_content == 'C': return 'C'

    # 2. If tags not found or content inside tags was not A/B/C,
    #    check if the entire stripped response is exactly A, B, or C.
    response_upper = response_stripped.upper()
    if response_upper == 'A': return 'A'
    if response_upper == 'B': return 'B'
    if allow_tie and response_upper == 'C': return 'C'

    # 3. Fallback: If neither of the above, check if the original stripped response
    #    CONTAINS A, B, or C. This is lenient.
    #    To reduce ambiguity, if A is found, ensure B (and C if tie) is not also found.
    a_present = 'A' in response_upper
    b_present = 'B' in response_upper
    c_present = allow_tie and ('C' in response_upper)

    if a_present and not b_present and not c_present:
        return 'A'
    if b_present and not a_present and not c_present:
        return 'B'
    if c_present and not a_present and not b_present:
        return 'C'

    return None

def parse_json_winner(llm_response, allow_tie=False):
    import json
    try:
        clean_response = llm_response.strip()
        if clean_response.startswith("```json"):
            clean_response = clean_response[7:-3].strip()
        elif clean_response.startswith("```"):
            clean_response = clean_response[3:-3].strip()
        
        obj = json.loads(clean_response)
        winner = obj.get('winner', None)

        if winner is not None:
            winner_str = str(winner).strip().upper()
            if winner_str == 'A':
                return 'A'
            if winner_str == 'B':
                return 'B'
            if allow_tie and winner_str == 'C':
                return 'C'
            print(f"Warning: Invalid 'winner' value '{obj.get('winner')}' in JSON. Raw: {llm_response[:100]}...")
        else:
            print(f"Warning: 'winner' key missing in JSON. Raw: {llm_response[:100]}...")
            
    except json.JSONDecodeError:
        print(f"Warning: JSONDecodeError parsing response. Raw: {llm_response[:100]}...")
    except Exception as e:
        print(f"Warning: Unexpected error during JSON parsing: {e}. Raw: {llm_response[:100]}...")
    return None

# --- Helper function to process a single ELO variant ---
def _process_single_variant(
    variant_config, 
    items, 
    criterion, 
    k, 
    quiet, 
    repetitions, 
    show_raw, 
    current_set_id,
    elo_match_repetition_concurrency,
    example_json_A_str,
    example_json_B_str,
    temperature: float
    ):
    if not quiet:
        print(f"\\n  === Starting Elo Variant: {variant_config['name']} (Set: '{current_set_id}') ===")

    ratings = {item['id']: 1000 for item in items}
    win_loss = {item['id']: {'W': 0, 'L': 0, 'T': 0} for item in items}
    detailed_pair_results_for_variant = []
    
    n_items = len(items)
    pairs = [(i, j) for i in range(n_items) for j in range(i + 1, n_items)]
    pairs_shuffled = pairs[:]
    random.shuffle(pairs_shuffled)

    current_variant_user_prompt_template = variant_config["user_prompt_template"]
    if "{criterion}" in current_variant_user_prompt_template:
        current_variant_user_prompt_template = current_variant_user_prompt_template.format(criterion=criterion, example_json_A_str=example_json_A_str, example_json_B_str=example_json_B_str)
    
    current_variant_system_prompt = variant_config["system_prompt"]
    if current_variant_system_prompt and "{criterion}" in current_variant_system_prompt:
        current_variant_system_prompt = current_variant_system_prompt.format(criterion=criterion)

    match_pbar_desc = f"Matches for {variant_config['name']} ({current_set_id})"
    for idx, (i_idx, j_idx) in enumerate(tqdm(pairs_shuffled, desc=match_pbar_desc, leave=False)):
        item_a_obj = items[i_idx]
        item_b_obj = items[j_idx]
        
        is_item_a_actually_first = random.random() < 0.5
        prompt_item_A = item_a_obj if is_item_a_actually_first else item_b_obj
        prompt_item_B = item_b_obj if is_item_a_actually_first else item_a_obj

        user_prompt = current_variant_user_prompt_template.format(A=prompt_item_A['text'], B=prompt_item_B['text'])
        
        prompt = current_variant_system_prompt + "\\n\\n" + user_prompt if current_variant_system_prompt else user_prompt

        repetition_winner_labels = [None] * repetitions
        repetition_llm_responses = [None] * repetitions
        repetition_errors_this_match = 0

        if not quiet and repetitions > 1:
             print(f"\\n    Match {idx+1}/{len(pairs_shuffled)} ({variant_config['name']}): {prompt_item_A['id']} vs {prompt_item_B['id']} ({repetitions} reps)")

        if repetitions == 1:
            llm_response_single_rep = call_openrouter_api(prompt, None, True, temperature=temperature)
            repetition_llm_responses[0] = llm_response_single_rep
            current_rep_winner_label = None
            is_api_error_rep = isinstance(llm_response_single_rep, str) and llm_response_single_rep.startswith("Error:")
            if not is_api_error_rep:
                current_rep_winner_label = variant_config["parse_fn"](llm_response_single_rep, allow_tie=variant_config["allow_tie"])
            if current_rep_winner_label is None or is_api_error_rep:
                repetition_errors_this_match += 1
            repetition_winner_labels[0] = current_rep_winner_label
        elif repetitions > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(elo_match_repetition_concurrency, repetitions)) as executor_reps:
                future_to_rep_idx = {}
                for rep_idx_loop in range(repetitions):
                    future = executor_reps.submit(call_openrouter_api, prompt, None, True, temperature=temperature)
                    future_to_rep_idx[future] = rep_idx_loop
                
                rep_iterator = future_to_rep_idx.keys()
                if repetitions > elo_match_repetition_concurrency and repetitions > 5 and not quiet :
                    rep_iterator = tqdm(concurrent.futures.as_completed(future_to_rep_idx), total=repetitions, desc=f"Reps {prompt_item_A['id']}v{prompt_item_B['id']}", leave=False)
                else:
                    rep_iterator = concurrent.futures.as_completed(future_to_rep_idx)

                for future_item in rep_iterator:
                    rep_idx_completed = future_to_rep_idx[future_item]
                    try:
                        llm_response_single_rep = future_item.result()
                        repetition_llm_responses[rep_idx_completed] = llm_response_single_rep
                        current_rep_winner_label_async = None
                        is_api_error_rep_async = isinstance(llm_response_single_rep, str) and llm_response_single_rep.startswith("Error:")
                        if not is_api_error_rep_async:
                            current_rep_winner_label_async = variant_config["parse_fn"](llm_response_single_rep, allow_tie=variant_config["allow_tie"])
                        if current_rep_winner_label_async is None or is_api_error_rep_async:
                            repetition_errors_this_match += 1
                        repetition_winner_labels[rep_idx_completed] = current_rep_winner_label_async
                    except Exception as exc:
                        repetition_errors_this_match += 1
                        repetition_llm_responses[rep_idx_completed] = f"Exception during API call for Rep {rep_idx_completed + 1}: {exc}"
        
        valid_rep_labels = [label for label in repetition_winner_labels if label is not None]
        overall_match_winner_label = None
        
        if not valid_rep_labels:
            if not quiet: print(f"      Match Result ({variant_config['name']}): All {repetitions} reps failed for {prompt_item_A['id']} vs {prompt_item_B['id']}.")
            detailed_pair_results_for_variant.append({
                "item_A_id_prompted": prompt_item_A['id'], "item_B_id_prompted": prompt_item_B['id'],
                "item_A_content_snippet": prompt_item_A['text'][:50] + "...", "item_B_content_snippet": prompt_item_B['text'][:50] + "...",
                "winner": "ERROR_ALL_REPS_FAILED", "is_tie": False,
                "raw_responses_per_repetition": repetition_llm_responses,
                "errors_in_repetitions": repetition_errors_this_match, "total_repetitions": repetitions
            })
            continue 

        if repetitions > 1:
            counts = collections.Counter(valid_rep_labels)
            most_common = counts.most_common()
            if not most_common or (len(most_common) > 1 and most_common[0][1] == most_common[1][1] and not variant_config["allow_tie"]):
                overall_match_winner_label = None 
            elif not most_common: 
                overall_match_winner_label = None 
            else:
                overall_match_winner_label = most_common[0][0]
            
            if not quiet and overall_match_winner_label: print(f"      Match Result ({variant_config['name']}): Majority '{overall_match_winner_label}' for {prompt_item_A['id']} vs {prompt_item_B['id']} (Votes: {counts})")
            elif not quiet: print(f"      Match Result ({variant_config['name']}): No majority/tie for {prompt_item_A['id']} vs {prompt_item_B['id']} (Votes: {counts})")

        else:
            overall_match_winner_label = valid_rep_labels[0]
            if not quiet: print(f"      Match Result ({variant_config['name']}): Picked '{overall_match_winner_label}' for {prompt_item_A['id']} vs {prompt_item_B['id']}.")
        
        if overall_match_winner_label is None:
            detailed_pair_results_for_variant.append({
                "item_A_id_prompted": prompt_item_A['id'], "item_B_id_prompted": prompt_item_B['id'],
                "item_A_content_snippet": prompt_item_A['text'][:50] + "...", "item_B_content_snippet": prompt_item_B['text'][:50] + "...",
                "winner": "NO_MAJORITY_OR_TIE_NOT_ALLOWED", "is_tie": False,
                "raw_responses_per_repetition": repetition_llm_responses,
                "errors_in_repetitions": repetition_errors_this_match, "total_repetitions": repetitions
            })
            continue 

        expected_a = elo_expected(ratings[prompt_item_A['id']], ratings[prompt_item_B['id']])
        expected_b = 1 - expected_a
        score_a, score_b = 0, 0
        is_match_tie = False

        if overall_match_winner_label == 'A':
            score_a = 1
            win_loss[prompt_item_A['id']]['W'] += 1
            win_loss[prompt_item_B['id']]['L'] += 1
        elif overall_match_winner_label == 'B':
            score_b = 1
            win_loss[prompt_item_B['id']]['W'] += 1
            win_loss[prompt_item_A['id']]['L'] += 1
        elif overall_match_winner_label == 'C' and variant_config["allow_tie"]:
            score_a = 0.5
            score_b = 0.5
            is_match_tie = True
            win_loss[prompt_item_A['id']]['T'] += 1
            win_loss[prompt_item_B['id']]['T'] += 1
        else:
            if not quiet: print(f"Warning ({variant_config['name']}): Unhandled label '{overall_match_winner_label}' for {prompt_item_A['id']} vs {prompt_item_B['id']}. No Elo update.")
            detailed_pair_results_for_variant.append({
                "item_A_id_prompted": prompt_item_A['id'], "item_B_id_prompted": prompt_item_B['id'],
                "item_A_content_snippet": prompt_item_A['text'][:50]+"...", 
                "item_B_content_snippet": prompt_item_B['text'][:50]+"...",
                "winner": f"UNHANDLED_LABEL_{overall_match_winner_label}", "is_tie": False,
                "raw_responses_per_repetition": repetition_llm_responses,
                "errors_in_repetitions": repetition_errors_this_match, "total_repetitions": repetitions
            })
            continue 

        ratings[prompt_item_A['id']] = elo_update(ratings[prompt_item_A['id']], expected_a, score_a, k)
        ratings[prompt_item_B['id']] = elo_update(ratings[prompt_item_B['id']], expected_b, score_b, k)

        detailed_pair_results_for_variant.append({
            "item_A_id_prompted": prompt_item_A['id'],
            "item_B_id_prompted": prompt_item_B['id'],
            "item_A_content_snippet": prompt_item_A['text'][:50] + "...",
            "item_B_content_snippet": prompt_item_B['text'][:50] + "...",
            "winner": overall_match_winner_label, 
            "is_tie": is_match_tie,
            "raw_responses_per_repetition": repetition_llm_responses if show_raw else "Suppressed",
            "errors_in_repetitions": repetition_errors_this_match,
            "total_repetitions": repetitions
        })

    final_rankings = sorted([{"id": item_id, "text_snippet": next((it['text'] for it in items if it['id'] == item_id),"")[:50]+"...", "elo": round(rating), "W": win_loss[item_id]['W'], "L": win_loss[item_id]['L'], "T": win_loss[item_id]['T']} for item_id, rating in ratings.items()], key=lambda x: x['elo'], reverse=True)
    
    system_prompt_display = "None"
    if current_variant_system_prompt:
        system_prompt_display = current_variant_system_prompt
    
    user_prompt_template_display = current_variant_user_prompt_template

    variant_summary_result = {
        "variant_name": variant_config['name'],
        "system_prompt_used": system_prompt_display,
        "user_prompt_template_used": user_prompt_template_display,
        "allow_tie_enabled": variant_config['allow_tie'],
        "parse_function_used": variant_config['parse_fn'].__name__,
        "temperature_setting": temperature,
        "final_rankings": final_rankings,
        "detailed_pair_results": detailed_pair_results_for_variant
    }
    
    if not quiet:
        print(f"  === Finished Elo Variant: {variant_config['name']} (Set: '{current_set_id}') ===")

    return variant_summary_result


# --- Main experiment runner ---
def run_pairwise_elo_experiment(
    show_raw=False, 
    k=32, 
    quiet=False, 
    repetitions: int = 1,
    max_concurrent_variants: int = 3,
    elo_match_repetition_concurrency: int = 5,
    temperature: float = 0.1
    ):
    if not quiet:
        print("\\n--- Pairwise Elo LLM Ranking Experiment ---")
        if repetitions > 1:
            print(f"--- Repetitions per match: {repetitions} (Concurrency per match: {elo_match_repetition_concurrency}) ---")
        if max_concurrent_variants > 1:
            print(f"--- Max Concurrent Variants: {max_concurrent_variants} ---")
        else:
            print(f"--- Variants will run sequentially ---")
        print(f"--- Temperature for API calls: {temperature} ---")


    overall_results_all_sets = []

    example_json_A_str = '{{"winner": "A"}}'
    example_json_B_str = '{{"winner": "B"}}'

    for ranking_set_info in RANKING_SETS:
        current_set_id = ranking_set_info['id']
        current_set_criterion = ranking_set_info['criterion']
        current_set_items = ranking_set_info['items']

        if not current_set_items:
            if not quiet: print(f"Skipping ranking set '{current_set_id}' as it has no items.")
            continue
        
        if not quiet:
            print(f"\\nProcessing Ranking Set: '{current_set_id}' (Criterion: '{current_set_criterion}', Items: {len(current_set_items)})")

        items = current_set_items
        n = len(items)
        if n < 2:
            if not quiet: print(f"Skipping ranking set '{current_set_id}' as it has fewer than 2 items.")
            continue

        variants_definitions = [
            {
                "name": "Classic (no system prompt, no tie)",
                "system_prompt": None,
                "user_prompt_template": (
                    "You are a judge. Which item is better based on: '{criterion}'?\\n"
                    "Item A:\\n{{A}}\\n\\nItem B:\\n{{B}}\\n\\n"
                    "Respond with your choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False, "parse_fn": parse_decision_tag, "temperature": 0.1
            },
            {
                "name": "Justification-First (no tie)",
                "system_prompt": None,
                "user_prompt_template": (
                    "You are a judge. Explain your reasoning, then pick which item is better based on: '{criterion}'.\\n"
                    "Item A:\\n{{A}}\\n\\nItem B:\\n{{B}}\\n\\n"
                    "After your explanation, state your final choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False, "parse_fn": parse_decision_tag, "temperature": 0.1
            },
            {
                "name": "System Prompt (no tie)",
                "system_prompt": "You are a world-class judge specializing in '{criterion}'. Be impartial and detailed.",
                "user_prompt_template": (
                    "Which item is better based on: '{criterion}'? Context for judgment: the items are distinct and should be evaluated independently against the criterion provided.\\nItem A:\\n{{A}}\\n\\nItem B:\\n{{B}}\\n\\n"
                    "Respond with your choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False, "parse_fn": parse_decision_tag, "temperature": 0.1
            },
            {
                "name": "Allow Tie (A/B/C)",
                "system_prompt": None,
                "user_prompt_template": (
                    "You are a judge. Which item is better based on: '{criterion}'? Context for judgment: the items are distinct and should be evaluated independently against the criterion provided.\\n"
                    "Item A:\\n{{A}}\\n\\nItem B:\\n{{B}}\\n\\n"
                    "Respond with your choice inside <decision> tags. For example: <decision>A</decision>, <decision>B</decision>, or <decision>C</decision> (if both are equally good based on '{criterion}')."
                ),
                "allow_tie": True, "parse_fn": parse_decision_tag, "temperature": 0.1
            },
            {
                "name": "JSON Output (no tie)",
                "system_prompt": None,
                "user_prompt_template": (
                    "You are a judge. Which item is better based on: '{criterion}'? Context for judgment: the items are distinct and should be evaluated independently against the criterion provided.\\\\n"
                    "Item A:\\\\n{{A}}\\\\n\\\\nItem B:\\\\n{{B}}\\\\n\\\\nRespond with a JSON object like this: {example_json_A_str} or {example_json_B_str}. Ensure the JSON is valid."
                ), 
                "allow_tie": False, "parse_fn": parse_json_winner, "temperature": 0.1
            },
            {
                "name": "Chain-of-Thought (CoT)",
                "system_prompt": "You are a meticulous judge. Analyze each item carefully based on the criterion '{criterion}' before making your final decision.",
                "user_prompt_template": (
                    "Your task is to determine which item is better based on: '{criterion}'.\\n"
                    "Item A:\\n{{A}}\\n\\nItem B:\\n{{B}}\\n\\n"
                    "Please follow these steps in your thought process before making a decision:\\n"
                    "1. Briefly analyze Item A based on '{criterion}'. What are its strengths or weaknesses in this regard?\\n"
                    "2. Briefly analyze Item B based on '{criterion}'. What are its strengths or weaknesses in this regard?\\n"
                    "3. Compare your analyses. Which item, on balance, is better according to '{criterion}' based on your step-by-step reasoning?\\n\\n"
                    "After your step-by-step analysis, state your final choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False, "parse_fn": parse_decision_tag, "temperature": 0.1 
            }
        ]

        current_set_elo_summary = {
            "ranking_set_id": current_set_id,
            "criterion": current_set_criterion,
            "item_count": n,
            "variants_summary": []
        }

        variant_futures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrent_variants) as executor_variants:
            for variant_idx, variant_def in enumerate(tqdm(variants_definitions, desc=f"Submitting Variants for '{current_set_id}'", leave=False)):
                future = executor_variants.submit(
                    _process_single_variant,
                    variant_config=variant_def,
                    items=items,
                    criterion=current_set_criterion,
                    k=k,
                    quiet=quiet,
                    repetitions=repetitions,
                    show_raw=show_raw,
                    current_set_id=current_set_id,
                    elo_match_repetition_concurrency=elo_match_repetition_concurrency,
                    example_json_A_str=example_json_A_str,
                    example_json_B_str=example_json_B_str,
                    temperature=temperature
                )
                variant_futures.append(future)
            
            results_pbar_desc = f"Collecting Variant Results for '{current_set_id}'"
            for future in tqdm(concurrent.futures.as_completed(variant_futures), total=len(variant_futures), desc=results_pbar_desc, leave=True):
                try:
                    variant_summary_data = future.result()
                    current_set_elo_summary["variants_summary"].append(variant_summary_data)
                except Exception as exc:
                    print(f"ERROR: Variant processing for set '{current_set_id}' generated an exception: {exc}")
                    current_set_elo_summary["variants_summary"].append({
                        "variant_name": "VARIANT_PROCESSING_ERROR",
                        "error_details": str(exc),
                        "final_rankings": [],
                        "detailed_pair_results": []
                    })

        original_variant_names = [v_def['name'] for v_def in variants_definitions]
        def get_sort_key(summary):
            try:
                return original_variant_names.index(summary['variant_name'])
            except (ValueError, KeyError):
                return len(original_variant_names)
        current_set_elo_summary["variants_summary"].sort(key=get_sort_key)
        
        overall_results_all_sets.append(current_set_elo_summary)

        if not quiet:
             print(f"\\n--- Finished all variant processing for Ranking Set: '{current_set_id}' ---")
             for var_summary in current_set_elo_summary["variants_summary"]:
                 if var_summary.get("final_rankings"):
                    print(f"  Summary for Variant: {var_summary['variant_name']}")
                    for rank_info in var_summary["final_rankings"][:3]:
                        print(f"    {rank_info['id']} (Elo: {rank_info['elo']}, W/L/T: {rank_info['W']}/{rank_info['L']}/{rank_info['T']})")


    if not quiet:
        print("\\n--- Pairwise Elo LLM Ranking Experiment Complete ---")
    return overall_results_all_sets


if __name__ == '__main__':
    import os
    from dotenv import load_dotenv
    from config_utils import set_api_key, set_llm_model, BIAS_SUITE_LLM_MODEL
    
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
    dotenv_path_project_root = os.path.join(PROJECT_ROOT, '.env')


    if os.path.exists(dotenv_path_project_root):
        load_dotenv(dotenv_path_project_root)
        print(f"Loaded .env from: {dotenv_path_project_root}")
    else:
        print(f".env file not found at {dotenv_path_project_root}. Trying default load_dotenv().")
        load_dotenv() 

    API_KEY = os.getenv('OPENROUTER_API_KEY')
    MODEL_NAME_FROM_ENV = os.getenv('BIAS_SUITE_LLM_MODEL')
    MODEL_NAME_TO_USE = MODEL_NAME_FROM_ENV if MODEL_NAME_FROM_ENV else BIAS_SUITE_LLM_MODEL


    if not API_KEY:
        print("CRITICAL: OPENROUTER_API_KEY not found. Ensure it is in your .env file.")
    elif not MODEL_NAME_TO_USE:
        print("CRITICAL: LLM Model (BIAS_SUITE_LLM_MODEL) not found in .env or config_utils.")
    else:
        print(f"Running ELO test with model: {MODEL_NAME_TO_USE}")
        set_api_key(API_KEY)
        set_llm_model(MODEL_NAME_TO_USE) 
        
        results = run_pairwise_elo_experiment(
            quiet=False, 
            repetitions=2, 
            max_concurrent_variants=2,
            elo_match_repetition_concurrency=3,
            temperature=0.6
        )
        
        if results and results[0]["variants_summary"]:
            first_set_first_variant_summary = results[0]["variants_summary"][0]
            print(f"\\nSample from results for Set '{results[0]['ranking_set_id']}', Variant '{first_set_first_variant_summary['variant_name']}':")
            if first_set_first_variant_summary.get("final_rankings"):
                for rank_info in first_set_first_variant_summary["final_rankings"][:2]:
                    print(rank_info)
            else:
                print("No final rankings in the first variant's summary.")
        else:
            print("No results or variants summary to display sample from.")