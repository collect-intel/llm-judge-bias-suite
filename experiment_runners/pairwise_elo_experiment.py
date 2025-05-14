import random
import collections
from tqdm import tqdm
import concurrent.futures
from test_data import RANKING_SETS
from config_utils import call_openrouter_api

CONCURRENT_ELO_REPETITIONS = 8

# --- Elo rating helpers ---
def elo_expected(rating_a, rating_b):
    return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))

def elo_update(rating, expected, score, k=32):
    return rating + k * (score - expected)

# --- Response parsing helpers ---
def parse_ab(llm_response, allow_tie=False):
    resp = llm_response.strip().upper()
    if 'A' in resp and (not allow_tie or 'C' not in resp):
        return 'A'
    if 'B' in resp and (not allow_tie or 'C' not in resp):
        return 'B'
    if allow_tie and 'C' in resp:
        return 'C'
    return None

def parse_decision_tag(llm_response, allow_tie=False):
    import re
    match = re.search(r'<decision>\\s*([ABCabc])\\s*</decision>', llm_response, re.IGNORECASE)
    if match:
        choice = match.group(1).upper()
        if choice in ['A', 'B']:
            return choice
        if allow_tie and choice == 'C':
            return 'C'
        print(f"Warning: Invalid content '{match.group(1)}' in <decision> tag. Raw: {llm_response[:100]}...")
        return parse_ab(llm_response, allow_tie)
    else:
        return parse_ab(llm_response, allow_tie)

def parse_json_winner(llm_response, allow_tie=False):
    import json
    try:
        clean_response = llm_response.strip()
        if clean_response.startswith("```json"):
            clean_response = clean_response[7:-3].strip()
        elif clean_response.startswith("```"):
            clean_response = clean_response[3:-3].strip()
        
        obj = json.loads(clean_response)
        winner = obj.get('winner', '').upper()
        if winner in ['A', 'B']:
            return winner
        if allow_tie and winner == 'C':
            return 'C'
    except Exception:
        pass 
    return parse_ab(llm_response, allow_tie=allow_tie)

# --- Main experiment runner ---
def run_pairwise_elo_experiment(show_raw=False, k=32, quiet=False, repetitions: int = 1):
    if not quiet:
        print("\n--- Pairwise Elo LLM Ranking Experiment ---")
        if repetitions > 1:
            print(f"--- Repetitions per match: {repetitions} ---")

    overall_results_all_sets = []

    for ranking_set_info in RANKING_SETS:
        current_set_id = ranking_set_info['id']
        current_set_criterion = ranking_set_info['criterion']
        current_set_items = ranking_set_info['items']

        if not current_set_items:
            if not quiet: print(f"Skipping ranking set '{current_set_id}' as it has no items.")
            continue
        
        if not quiet:
            print(f"\nProcessing Ranking Set: '{current_set_id}' (Criterion: '{current_set_criterion}', Items: {len(current_set_items)})")

        items = current_set_items
        criterion = current_set_criterion 
        n = len(items)
        if n < 2:
            if not quiet: print(f"Skipping ranking set '{current_set_id}' as it has fewer than 2 items.")
            continue
        pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]

        variants = [
            {
                "name": "Classic (no system prompt, no tie)",
                "system_prompt": None,
                "user_prompt_template": (
                    f"You are a judge. Which item is better based on: '{criterion}'?\n"
                    f"Item A:\n{{A}}\n\nItem B:\n{{B}}\n\n"
                    f"Respond with your choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False,
                "parse_fn": parse_decision_tag,
                "temperature": 0.1
            },
            {
                "name": "Justification-First (no tie)",
                "system_prompt": None,
                "user_prompt_template": (
                    f"You are a judge. Explain your reasoning, then pick which item is better based on: '{criterion}'.\n"
                    f"Item A:\n{{A}}\n\nItem B:\n{{B}}\n\n"
                    f"After your explanation, state your final choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False,
                "parse_fn": parse_decision_tag,
                "temperature": 0.1
            },
            {
                "name": "System Prompt (no tie)",
                "system_prompt": f"You are a world-class judge specializing in '{criterion}'. Be impartial and detailed.",
                "user_prompt_template": (
                    f"Which item is better based on: '{criterion}'? Context for judgment: the items are distinct and should be evaluated independently against the criterion provided.\nItem A:\n{{A}}\n\nItem B:\n{{B}}\n\n"
                    f"Respond with your choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False,
                "parse_fn": parse_decision_tag,
                "temperature": 0.1
            },
            {
                "name": "Allow Tie (A/B/C)",
                "system_prompt": None,
                "user_prompt_template": (
                    f"You are a judge. Which item is better based on: '{criterion}'? Context for judgment: the items are distinct and should be evaluated independently against the criterion provided.\n"
                    f"Item A:\n{{A}}\n\nItem B:\n{{B}}\n\n"
                    f"Respond with your choice inside <decision> tags. For example: <decision>A</decision>, <decision>B</decision>, or <decision>C</decision> (if both are equally good based on '{criterion}')."
                ),
                "allow_tie": True,
                "parse_fn": parse_decision_tag,
                "temperature": 0.1
            },
            {
                "name": "JSON Output (no tie)",
                "system_prompt": None,
                "user_prompt_template": (
                    f"You are a judge. Which item is better based on: '{criterion}'? Context for judgment: the items are distinct and should be evaluated independently against the criterion provided.\n"
                    f"Item A:\n{{A}}\n\nItem B:\n{{B}}\n\nRespond with a JSON object like this: {{{{'\"winner\": \"A\"'}}}} or {{{{'\"winner\": \"B\"'}}}}. Ensure the JSON is valid."
                ), 
                "allow_tie": False,
                "parse_fn": parse_json_winner,
                "temperature": 0.1
            },
            {
                "name": "Chain-of-Thought (CoT)",
                "system_prompt": f"You are a meticulous judge. Analyze each item carefully based on the criterion '{criterion}' before making your final decision.",
                "user_prompt_template": (
                    f"Your task is to determine which item is better based on: '{criterion}'.\n"
                    f"Item A:\n{{A}}\n\nItem B:\n{{B}}\n\n"
                    f"Please follow these steps in your thought process before making a decision:\n"
                    f"1. Briefly analyze Item A based on '{criterion}'. What are its strengths or weaknesses in this regard?\n"
                    f"2. Briefly analyze Item B based on '{criterion}'. What are its strengths or weaknesses in this regard?\n"
                    f"3. Compare your analyses. Which item, on balance, is better according to '{criterion}' based on your step-by-step reasoning?\n\n"
                    f"After your step-by-step analysis, state your final choice inside <decision> tags. For example: <decision>A</decision> or <decision>B</decision>."
                ),
                "allow_tie": False, 
                "parse_fn": parse_decision_tag,
                "temperature": 0.1 
            }
        ]

        current_set_elo_summary = {
            "ranking_set_id": current_set_id,
            "criterion": current_set_criterion,
            "item_count": n,
            "variants_summary": []
        }

        for variant in tqdm(variants, desc=f"Processing Variants for '{current_set_id}'"):
            if not quiet:
                print(f"\n  === Elo Variant: {variant['name']} (Set: '{current_set_id}') ===")
            
            ratings = {item['id']: 1000 for item in items}
            win_loss = {item['id']: {'W': 0, 'L': 0, 'T': 0} for item in items}
            detailed_pair_results_for_variant = []
            
            pairs_shuffled = pairs[:]
            random.shuffle(pairs_shuffled)

            for idx, (i_idx, j_idx) in enumerate(tqdm(pairs_shuffled, desc=f"Matches for {variant['name']} ({current_set_id})", leave=False)):
                item_a_obj = items[i_idx]
                item_b_obj = items[j_idx]
                
                is_item_a_actually_first = random.random() < 0.5
                prompt_item_A = item_a_obj if is_item_a_actually_first else item_b_obj
                prompt_item_B = item_b_obj if is_item_a_actually_first else item_a_obj

                user_prompt = variant["user_prompt_template"].format(A=prompt_item_A['text'], B=prompt_item_B['text']) 
                
                system_p_text = variant["system_prompt"]
                if system_p_text and '{criterion}' in system_p_text:
                    system_p_text = system_p_text.format(criterion=criterion)
                
                prompt = system_p_text + "\n\n" + user_prompt if system_p_text else user_prompt

                repetition_winner_labels = [None] * repetitions
                repetition_llm_responses = [None] * repetitions
                repetition_errors_this_match = 0

                if not quiet:
                     print(f"\n    Match {idx+1}/{len(pairs_shuffled)}: {prompt_item_A['id']} (Prompted as A) vs {prompt_item_B['id']} (Prompted as B)")

                if repetitions == 1:
                    llm_response_single_rep = call_openrouter_api(prompt, quiet=True, temperature=variant.get("temperature", 0.1))
                    repetition_llm_responses[0] = llm_response_single_rep
                    current_rep_winner_label = None
                    is_api_error_rep = isinstance(llm_response_single_rep, str) and llm_response_single_rep.startswith("Error:")
                    if not is_api_error_rep:
                        current_rep_winner_label = variant["parse_fn"](llm_response_single_rep, allow_tie=variant["allow_tie"])
                    if current_rep_winner_label is None or is_api_error_rep:
                        repetition_errors_this_match += 1
                    repetition_winner_labels[0] = current_rep_winner_label
                elif repetitions > 1:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=min(CONCURRENT_ELO_REPETITIONS, repetitions)) as executor:
                        future_to_rep_idx = {}
                        for rep_idx_loop in range(repetitions):
                            future = executor.submit(call_openrouter_api, prompt, True, variant.get("temperature", 0.1))
                            future_to_rep_idx[future] = rep_idx_loop
                        for future_item in concurrent.futures.as_completed(future_to_rep_idx):
                            rep_idx_completed = future_to_rep_idx[future_item]
                            try:
                                llm_response_single_rep = future_item.result()
                                repetition_llm_responses[rep_idx_completed] = llm_response_single_rep
                                current_rep_winner_label_async = None
                                is_api_error_rep_async = isinstance(llm_response_single_rep, str) and llm_response_single_rep.startswith("Error:")
                                if not is_api_error_rep_async:
                                    current_rep_winner_label_async = variant["parse_fn"](llm_response_single_rep, allow_tie=variant["allow_tie"])
                                if current_rep_winner_label_async is None or is_api_error_rep_async:
                                    repetition_errors_this_match += 1
                                repetition_winner_labels[rep_idx_completed] = current_rep_winner_label_async
                            except Exception as exc:
                                repetition_errors_this_match += 1
                                repetition_llm_responses[rep_idx_completed] = f"Exception during API call for Rep {rep_idx_completed + 1}: {exc}"
                
                valid_rep_labels = [label for label in repetition_winner_labels if label is not None]
                overall_match_winner_label = None
                
                if not valid_rep_labels:
                    if not quiet: print(f"      Match Result: All {repetitions} repetitions failed for {prompt_item_A['id']} vs {prompt_item_B['id']}. Skipping match score update.")
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
                    if not most_common or (len(most_common) > 1 and most_common[0][1] == most_common[1][1] and not variant["allow_tie"]):
                        overall_match_winner_label = None 
                        if not quiet: print(f"      Match Result: Tie in repetitions but tie not allowed, or no clear majority for {prompt_item_A['id']} vs {prompt_item_B['id']}.")
                    elif not most_common: 
                        overall_match_winner_label = None 
                    else:
                        overall_match_winner_label = most_common[0][0]
                        if not quiet: print(f"      Match Result: Majority pick '{overall_match_winner_label}' for {prompt_item_A['id']} vs {prompt_item_B['id']}.")
                else: 
                    overall_match_winner_label = valid_rep_labels[0]
                    if not quiet: print(f"      Match Result: Picked '{overall_match_winner_label}' for {prompt_item_A['id']} vs {prompt_item_B['id']}.")
                
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
                elif overall_match_winner_label == 'C' and variant["allow_tie"]:
                    score_a = 0.5
                    score_b = 0.5
                    is_match_tie = True
                    win_loss[prompt_item_A['id']]['T'] += 1
                    win_loss[prompt_item_B['id']]['T'] += 1
                else:
                    if not quiet: print(f"Warning: Unhandled match winner label '{overall_match_winner_label}' for {prompt_item_A['id']} vs {prompt_item_B['id']}. No Elo update.")
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
            if variant['system_prompt']:
                if '{criterion}' in variant['system_prompt']:
                    system_prompt_display = variant['system_prompt'].format(criterion=criterion)
                else:
                    system_prompt_display = variant['system_prompt']

            variant_summary = {
                "variant_name": variant['name'],
                "system_prompt_used": system_prompt_display,
                "user_prompt_template_used": variant['user_prompt_template'],
                "allow_tie_enabled": variant['allow_tie'],
                "parse_function_used": variant['parse_fn'].__name__,
                "temperature_setting": variant.get("temperature", 0.1),
                "final_rankings": final_rankings,
                "detailed_pair_results": detailed_pair_results_for_variant
            }
            current_set_elo_summary["variants_summary"].append(variant_summary)

            if not quiet:
                print(f"  Final Elo Ratings for {variant['name']} (Set: '{current_set_id}'):")
                for rank_info in final_rankings:
                    print(f"    {rank_info['id']} (Elo: {rank_info['elo']}, W/L/T: {rank_info['W']}/{rank_info['L']}/{rank_info['T']})")
        
        overall_results_all_sets.append(current_set_elo_summary)

    if not quiet:
        print("\n--- Pairwise Elo LLM Ranking Experiment Complete ---")
    return overall_results_all_sets


if __name__ == '__main__':
    import os
    from dotenv import load_dotenv
    from config_utils import set_api_key, set_llm_model
    
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
    dotenv_path_project_root = os.path.join(PROJECT_ROOT, '.env')

    if os.path.exists(dotenv_path_project_root):
        load_dotenv(dotenv_path_project_root)
    else:
        load_dotenv() 

    API_KEY = os.getenv('OPENROUTER_API_KEY')
    MODEL_NAME = os.getenv('BIAS_SUITE_LLM_MODEL')

    if not API_KEY:
        print("CRITICAL: OPENROUTER_API_KEY not found.")
    elif not MODEL_NAME:
        print("CRITICAL: BIAS_SUITE_LLM_MODEL not found.")
    else:
        print(f"Running ELO test with model: {MODEL_NAME}")
        set_api_key(API_KEY)
        set_llm_model(MODEL_NAME) 
        results = run_pairwise_elo_experiment(quiet=False, repetitions=1)
        # To test with JSON output, you might write to a file:
        # with open("elo_experiment_results.json", "w") as f:
        #     json.dump(results, f, indent=2)
        # print("ELO experiment results (sample from first set, first variant, first ranking):")
        # if results and results[0]["variants_summary"] and results[0]["variants_summary"][0]["final_rankings"]:
        #     print(json.dumps(results[0]["variants_summary"][0]["final_rankings"][0], indent=2))
        # else:
        #     print("No results to display sample from.") 