import json
import random
import concurrent.futures
from collections import Counter, defaultdict
from tqdm import tqdm
import re

from config_utils import call_openrouter_api, BIAS_SUITE_LLM_MODEL
# We will need to import actual test data from test_data.py later
# from test_data import CLASSIFICATION_CATEGORIES, CLASSIFICATION_ITEMS

# --- Constants ---
CONCURRENT_CLASSIFICATION_CALLS = 8 # Similar to other experiments

# --- Data Structures (Conceptual - Actual data in test_data.py) ---

# CLASSIFICATION_CATEGORIES_EXAMPLE = {
# "sentiment_basic": [
#         {"id": "pos", "name": "Positive", "description": "The text expresses a clearly positive sentiment." ليا},
#         {"id": "neg", "name": "Negative", "description": "The text expresses a clearly negative sentiment." ليا},
#         {"id": "neu", "name": "Neutral", "description": "The text expresses a neutral sentiment or is objective." ليا},
#         {"id": "mixed", "name": "Mixed", "description": "The text expresses both positive and negative sentiments clearly." ليا},
#         {"id": "unclear", "name": "Unclear/Ambiguous", "description": "The sentiment is difficult to determine or ambiguous." ليا}
# ],
# "user_intent_example": [
#         {"id": "bug", "name": "Bug Report", "description": "User is reporting an issue or something broken." ليا},
#         {"id": "feature", "name": "Feature Request", "description": "User is suggesting a new functionality or enhancement." ليا},
#         {"id": "question", "name": "Question", "description": "User is asking for information or help." ليا},
#         {"id": "feedback", "name": "General Feedback", "description": "User is providing a general opinion or comment not fitting other categories." ليا},
#         {"id": "other", "name": "Other", "description": "The intent does not fit any of the above categories." ليا}
# ]
# }

# CLASSIFICATION_ITEMS_EXAMPLE = [
# {
# "item_id": "item_001",
# "text": "The app crashes when I try to upload a video larger than 500MB. It should support 1GB.",
# "domain": "user_intent_example", # Links to a category set
# "true_category_ids": ["bug", "feature"], # Could be one or more if ambiguous or multi-label
# "ambiguity_level": "high", # "low", "medium", "high" - subjective rating for design
# "control_item": False # True if this is a clear-cut case for a specific category
# },
# # ... more items
# ]

# --- Prompt Variant Generation ---

def generate_prompt_variants(item_text: str, strategy_config: dict, base_categories_for_item: list, all_defined_category_sets: dict):
    """
    Generates a specific prompt string based on the strategy_config.
    """
    
    category_order_ids = strategy_config.get("category_order", [])
    include_definitions = strategy_config.get("include_definitions", False)
    base_prompt_template = strategy_config.get("base_prompt_template", 
        "Classify the following text into one of these categories: {category_list_comma_separated}.\\n"
        "{category_definitions_section}"
        "Text to classify: ```{item_text}```\\n"
        "Your classification (provide ONLY the category name):"
    )
    escape_hatch_config = strategy_config.get("escape_hatch_config")
    definition_nuance_domain_id = strategy_config.get("definition_nuance_domain_id")

    categories_source_for_definitions = base_categories_for_item
    if definition_nuance_domain_id and definition_nuance_domain_id in all_defined_category_sets:
        categories_source_for_definitions = all_defined_category_sets[definition_nuance_domain_id]

    ordered_categories_for_prompt_objects = []
    presented_category_names_for_parsing = []

    for cat_id in category_order_ids:
        base_cat_obj = next((c for c in base_categories_for_item if c["id"] == cat_id), None)
        if not base_cat_obj:
            print(f"Warning: Category ID '{cat_id}' from strategy not found in item's base_categories. Skipping.")
            continue

        desc_cat_obj = next((c for c in categories_source_for_definitions if c["id"] == cat_id), base_cat_obj)
        description_to_use = desc_cat_obj["description"]

        current_cat_obj_for_prompt = {
            "id": base_cat_obj["id"],
            "name": base_cat_obj["name"],
            "description": description_to_use
        }
        ordered_categories_for_prompt_objects.append(current_cat_obj_for_prompt)
        presented_category_names_for_parsing.append(base_cat_obj["name"])

    if escape_hatch_config and isinstance(escape_hatch_config, dict):
        eh_id = escape_hatch_config.get("id", "escape_hatch_default_id")
        eh_name = escape_hatch_config.get("name", "Other/Unclear")
        eh_description = escape_hatch_config.get("description", "Use if no other category clearly fits.")
        
        escape_category_obj = {"id": eh_id, "name": eh_name, "description": eh_description}
        ordered_categories_for_prompt_objects.append(escape_category_obj)
        presented_category_names_for_parsing.append(eh_name)

    category_definitions_string = ""
    if include_definitions:
        for cat_obj in ordered_categories_for_prompt_objects:
            category_definitions_string += f"- {cat_obj['name']}: {cat_obj['description']}\\n"
    
    category_list_comma_separated_string = ", ".join(presented_category_names_for_parsing)

    format_args = {
        "item_text": item_text,
        "category_list_comma_separated": category_list_comma_separated_string,
        "category_definitions_section": ""
    }
    if include_definitions and category_definitions_string:
        format_args["category_definitions_section"] = f"Category Definitions:\\n{category_definitions_string}\\n"
    elif "category_definitions_section" not in base_prompt_template and include_definitions and category_definitions_string:
        pass

    category_section_detail_string = ""
    for cat_obj in ordered_categories_for_prompt_objects:
        cat_detail = f"{cat_obj['name']}"
        if include_definitions:
            cat_detail += f" ({cat_obj['description']})"
        category_section_detail_string += f"- {cat_detail}\\n"
    format_args["category_section_detailed_list"] = category_section_detail_string

    try:
        final_prompt_text = base_prompt_template.format(**format_args)
    except KeyError as e:
        print(f"ERROR: Missing key '{e}' in prompt template or format_args. Strategy ID: {strategy_config.get('strategy_id')}")
        print(f"  Template: {base_prompt_template}")
        print(f"  Available format_args keys: {list(format_args.keys())}")
        final_prompt_text = f"Classify: {item_text}. Categories: {category_list_comma_separated_string}. Your choice:"

    return final_prompt_text, presented_category_names_for_parsing, ordered_categories_for_prompt_objects

def parse_classification_response(response_text, category_names_expected):
    """
    Parses the LLM's response to determine the chosen category.
    `category_names_expected` is the list of category names presented in the prompt.
    """
    response_text_stripped = response_text.strip()
    
    for cat_name in category_names_expected:
        if cat_name.lower() == response_text_stripped.lower():
            return cat_name

    for cat_name in category_names_expected:
        escaped_cat_name = re.escape(cat_name)
        if re.search(r"\\b" + escaped_cat_name + r"\\b", response_text_stripped, re.IGNORECASE):
            return cat_name

    return "Unparseable"


# --- Core Task Execution ---

def _execute_single_classification_task(
    item_to_classify: dict,
    prompt_variant_config: dict,
    base_category_set: list,
    all_defined_category_sets: dict,
    repetitions: int,
    quiet: bool,
    temperature: float
):
    """
    Sends a single classification task to the LLM and parses the response.
    Handles repetitions for this specific item-prompt_variant combination.
    """
    item_id = item_to_classify["item_id"]
    item_text = item_to_classify["text"]
    
    prompt_text, presented_category_names_for_parsing, categories_used_in_prompt = generate_prompt_variants(
        item_text=item_text,
        strategy_config=prompt_variant_config["strategy_config_used"],
        base_categories_for_item=base_category_set, 
        all_defined_category_sets=all_defined_category_sets
    )

    if not prompt_text or not presented_category_names_for_parsing:
        print(f"Critical error: Prompt text or presented category names missing for item {item_id}, variant {prompt_variant_config.get('variant_id')}")
        item_details_for_error = {
            "item_id": item_id,
            "item_text": item_text,
            "domain": item_to_classify.get("domain", "unknown"),
            "expected_true_categories": item_to_classify.get("expected_true_categories"),
            "ambiguity_score": item_to_classify.get("ambiguity_score"),
            "is_control_item": item_to_classify.get("is_control_item")
        }
        return {
            "item_details": item_details_for_error,
            "prompt_variant_id": prompt_variant_config.get("variant_id"),
            "prompt_variant_details": prompt_variant_config.get("strategy_config_used"),
            "runs": [{
                "repetition_index": i,
                "llm_classification_raw": "Error: Prompt generation failed",
                "parsed_classification": "Error",
                "error_in_repetition": True
            } for i in range(repetitions)],
            "aggregated_classifications": {"Error": repetitions},
            "errors_across_all_repetitions": repetitions,
            "total_repetitions_attempted": repetitions,
            "llm_chosen_category_id": None,
            "error_type": "PARSING_ERROR"
        }

    individual_runs_results: list[dict] = []
    errors_count = 0

    for rep_idx in range(repetitions):
        if repetitions > 1 and not quiet:
            print(f"    Rep {rep_idx + 1}/{repetitions} for Item ID: {item_id}, Variant: {prompt_variant_config.get('variant_id')}...")

        llm_response_raw = call_openrouter_api(prompt_text, quiet=True, temperature=temperature)

        parsed_category_name = None
        error_this_repetition = False
        is_api_error = isinstance(llm_response_raw, str) and llm_response_raw.startswith("Error:")

        if not is_api_error:
            parsed_category_name = parse_classification_response(llm_response_raw, presented_category_names_for_parsing)
            if parsed_category_name == "Unparseable":
                errors_count += 1
                error_this_repetition = True
                if not quiet:
                    print(f"      Parsing Error in Rep {rep_idx + 1}. LLM Raw: {llm_response_raw[:100]}...")
        else:
            errors_count += 1
            error_this_repetition = True
            parsed_category_name = "API Error" 
            if not quiet:
                 print(f"      API Error in Rep {rep_idx + 1}. LLM Raw: {llm_response_raw[:100]}...")
        
        individual_runs_results.append({
            "repetition_index": rep_idx,
            "llm_classification_raw": llm_response_raw,
            "parsed_classification": parsed_category_name,
            "error_in_repetition": error_this_repetition
        })

    aggregated_counts = Counter([run["parsed_classification"] for run in individual_runs_results if run["parsed_classification"] is not None])
    
    final_chosen_category_id_val = None
    final_error_type_val = None

    if errors_count == repetitions:
        is_predominantly_api_error = any(run["parsed_classification"] == "API Error" for run in individual_runs_results)
        final_error_type_val = "API_ERROR" if is_predominantly_api_error else "PARSING_ERROR"
    elif aggregated_counts:
        most_common = aggregated_counts.most_common(2)
        if most_common:
            chosen_name = most_common[0][0]
            chosen_count = most_common[0][1]
            is_tie = len(most_common) > 1 and most_common[1][1] == chosen_count

            if is_tie:
                final_error_type_val = "NO_MAJORITY"
            elif chosen_name not in ["Unparseable", "API Error", "Error"]:
                found_category_obj = next((cat_obj for cat_obj in categories_used_in_prompt if cat_obj["name"] == chosen_name), None)
                if found_category_obj:
                    final_chosen_category_id_val = found_category_obj["id"]
                else:
                    print(f"Warning: Parsed name '{chosen_name}' not in categories_used_in_prompt for ID mapping. Item: {item_id}.")
                    final_error_type_val = "PARSING_ERROR"
            else:
                final_error_type_val = "API_ERROR" if chosen_name == "API Error" else "PARSING_ERROR"
        else:
            final_error_type_val = "PARSING_ERROR"
    else:
        final_error_type_val = "PARSING_ERROR"

    item_details_to_embed = {
        "item_id": item_id,
        "item_text": item_text,
        "domain": item_to_classify.get("domain"),
        "expected_true_categories": item_to_classify.get("expected_true_categories"),
        "ambiguity_score": item_to_classify.get("ambiguity_score"),
        "is_control_item": item_to_classify.get("is_control_item")
    }

    return {
        "item_details": item_details_to_embed,
        "prompt_variant_id": prompt_variant_config.get("variant_id"), 
        "prompt_variant_details": prompt_variant_config.get("strategy_config_used"), 
        "runs": individual_runs_results,
        "aggregated_classifications": dict(aggregated_counts),
        "errors_across_all_repetitions": errors_count,
        "total_repetitions_attempted": repetitions,
        "llm_chosen_category_id": final_chosen_category_id_val,
        "error_type": final_error_type_val
    }

# --- Main Experiment Runner ---

def run_classification_experiment(
    classification_items: list,
    category_sets: dict,
    prompt_variant_strategies: list,
    show_raw: bool = False,
    quiet: bool = False,
    num_samples: int = 0,
    repetitions: int = 1,
    temperature: float = 0.1
):
    """
    Runs the classification experiment.
    - classification_items: The items to classify.
    - category_sets: All available category definitions, keyed by domain.
    - prompt_variant_strategies: A list of configurations, each defining how to construct a prompt variant 
                                 (e.g., category order, definition nuances, escape hatches).
    """
    if not quiet:
        print(f"\\n--- Classification Experiment ---")
        print(f"LLM Model: {BIAS_SUITE_LLM_MODEL}")
        print(f"Repetitions per item-prompt-variant: {repetitions}")
        print(f"Temperature for API calls: {temperature}")
        print(f"Number of prompt variant strategies: {len(prompt_variant_strategies)}")

    items_to_process = classification_items
    if num_samples > 0 and len(items_to_process) > num_samples:
        items_to_process = random.sample(items_to_process, num_samples) if num_samples < len(items_to_process) else items_to_process
        if not quiet: print(f"Processing a sample of {len(items_to_process)} items.")
    
    if not items_to_process:
        if not quiet: print("No items to process. Exiting classification experiment.")
        return []

    all_results_data = []
    tasks_for_executor = []
    
    for item_data in tqdm(items_to_process, desc="Preparing classification tasks", leave=False):
        item_domain = item_data.get("domain")
        base_categories_for_item = category_sets.get(item_domain)
        if not base_categories_for_item:
            if not quiet: print(f"Warning: No category set found for item {item_data['item_id']} with domain '{item_domain}'. Skipping.")
            continue

        for i, p_variant_strategy_config in enumerate(prompt_variant_strategies):
            strategy_domain_target = p_variant_strategy_config.get("domain_target")
            if strategy_domain_target and strategy_domain_target != item_domain:
                continue

            variant_id_for_task = p_variant_strategy_config.get("strategy_id", f"strategy_fallback_{i}")
            
            task_execution_config = {
                "variant_id": variant_id_for_task,
                "strategy_config_used": p_variant_strategy_config
            }
            
            tasks_for_executor.append(
                (item_data, task_execution_config, base_categories_for_item, category_sets, repetitions, quiet, temperature)
            )
            
    if not tasks_for_executor:
        if not quiet: print("No tasks generated for executor. Check item domains and strategies.")
        return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_CLASSIFICATION_CALLS) as executor:
        future_to_task_info = {
            executor.submit(
                _execute_single_classification_task, 
                task_item_arg,
                task_exec_config_arg,
                task_bcs_arg,
                task_all_sets_arg,
                task_reps_arg,
                task_quiet_arg,
                task_temp_arg
            ): (task_item_arg['item_id'], task_exec_config_arg.get('variant_id')) 
            for task_item_arg, task_exec_config_arg, task_bcs_arg, task_all_sets_arg, task_reps_arg, task_quiet_arg, task_temp_arg in tasks_for_executor
        }

        for future in tqdm(concurrent.futures.as_completed(future_to_task_info), total=len(future_to_task_info), desc="Running classifications"):
            item_id, variant_id = future_to_task_info[future]
            try:
                result = future.result()
                all_results_data.append(result)
            except Exception as exc:
                print(f"!! Exception for Item ID: {item_id}, Variant ID: {variant_id}: {exc}")
                item_data_for_error = next((item for item in items_to_process if item["item_id"] == item_id), {})
                item_details_for_error_exc = {
                    "item_id": item_id,
                    "item_text": item_data_for_error.get("text", "Unknown text due to earlier error"),
                    "domain": item_data_for_error.get("domain", "unknown"),
                    "expected_true_categories": item_data_for_error.get("expected_true_categories"),
                    "ambiguity_score": item_data_for_error.get("ambiguity_score"),
                    "is_control_item": item_data_for_error.get("is_control_item")
                }
                strategy_details_for_error = next((s for s in prompt_variant_strategies if s.get("strategy_id") == variant_id), {})

                all_results_data.append({
                    "item_details": item_details_for_error_exc,
                    "prompt_variant_id": variant_id,
                    "prompt_variant_details": strategy_details_for_error,
                    "runs": [{
                        "repetition_index": i,
                        "llm_classification_raw": f"Exception: {exc}",
                        "parsed_classification": "Exception",
                        "error_in_repetition": True
                        } for i in range(repetitions)],
                    "aggregated_classifications": {"Exception": repetitions},
                    "errors_across_all_repetitions": repetitions,
                    "total_repetitions_attempted": repetitions
                })

    if not quiet:
        print(f"\\n--- Classification Experiment Summary ---")
        total_runs = sum(r['total_repetitions_attempted'] for r in all_results_data if 'total_repetitions_attempted' in r)
        total_errors = sum(r['errors_across_all_repetitions'] for r in all_results_data if 'errors_across_all_repetitions' in r)
        print(f"Total classification attempts: {total_runs}")
        print(f"Total errors (API or Parse): {total_errors}")
        
    return all_results_data


if __name__ == '__main__':
    print("Running Classification Experiment (Direct Script Run - Mocked Data)...")

    MOCK_CATEGORY_SETS = {
        "sentiment_test_domain": [
            {"id": "pos", "name": "Positive", "description": "Clearly positive sentiment."},
            {"id": "neg", "name": "Negative", "description": "Clearly negative sentiment."},
            {"id": "other_sentiment", "name": "Other Sentiment", "description": "Any other sentiment type."}
        ]
    }
    MOCK_CLASSIFICATION_ITEMS = [
        {"item_id": "mock_item_1", "text": "This is great!", "domain": "sentiment_test_domain", "true_category_ids": ["pos"]},
        {"item_id": "mock_item_2", "text": "This is terrible.", "domain": "sentiment_test_domain", "true_category_ids": ["neg"]},
        {"item_id": "mock_item_3", "text": "The weather is mild today.", "domain": "sentiment_test_domain", "true_category_ids": ["other_sentiment"]},
    ]
    
    MOCK_PROMPT_VARIANT_STRATEGIES = [
        {
            "strategy_id": "order_PNO_defs_on_basic_template", 
            "description": "Order Positive, Negative, Other with definitions, using basic template",
            "domain_target": "sentiment_test_domain",
            "category_order": ["pos", "neg", "other_sentiment"], 
            "include_definitions": True,
            "base_prompt_template": "Please classify the text based on sentiment. Categories are: {category_list_comma_separated}.\\n{category_definitions_section}Text: ```{item_text}```\\nChosen Category Name Only:"
        },
        {
            "strategy_id": "order_ONP_defs_off_alt_template", 
            "description": "Order Other, Negative, Positive, no definitions, using alt template",
            "domain_target": "sentiment_test_domain",
            "category_order": ["other_sentiment", "neg", "pos"],
            "include_definitions": False,
            "base_prompt_template": "Which of these categories best describes the text: {category_list_comma_separated}? Text: ```{item_text}```. Your Answer (Category Name):"
        },
        {
            "strategy_id": "order_PN_with_escape_defs_on_detail_template",
            "description": "Order Positive, Negative with an escape hatch, definitions on, detailed list template",
            "domain_target": "sentiment_test_domain",
            "category_order": ["pos", "neg"], 
            "include_definitions": True,
            "escape_hatch_config": {"id": "unclear_esc_id", "name": "Unclear/Ambiguous Sentiment", "description": "Use if sentiment is not clearly positive or negative."},
            "base_prompt_template": "Consider the following categories for classifying the text's sentiment:\\n{category_section_detailed_list}Text: ```{item_text}```\\nWhich category applies? (Name Only):"
        },
        {
            "strategy_id": "UF_order_BF_nuanced_defs",
            "description": "User Feedback: Order Bug, Feature with NUANCED definitions from user_feedback_v1_defs_nuance_A.",
            "domain_target": "user_feedback_v1",
            "category_order": ["bug", "feature_request"],
            "include_definitions": True,
            "definition_nuance_domain_id": "user_feedback_v1_defs_nuance_A",
            "base_prompt_template": "Please classify the user feedback using the detailed definitions provided.\\nText: ```{item_text}```\\n{category_definitions_section}Selected Category Name:"
        }
    ]

    results = run_classification_experiment(
        classification_items=MOCK_CLASSIFICATION_ITEMS,
        category_sets=MOCK_CATEGORY_SETS,
        prompt_variant_strategies=MOCK_PROMPT_VARIANT_STRATEGIES,
        show_raw=True,
        quiet=False,
        num_samples=0, 
        repetitions=2,
        temperature=0.6
    )

    print("\\nClassification Experiment Results (Mocked Run):")
    item_classifications_summary = defaultdict(lambda: defaultdict(lambda: {"responses": [], "counts": Counter()}))
    for res in results:
        item_id = res['item_id']
        variant_id = res['prompt_variant_id']
        parsed_list = []
        if 'runs' in res and isinstance(res['runs'], list):
            for run_item in res['runs']:
                if 'parsed_classification' in run_item:
                    parsed_list.append(run_item['parsed_classification'])
        
        item_classifications_summary[item_id][variant_id]["responses"].extend(parsed_list)
        item_classifications_summary[item_id][variant_id]["counts"].update(parsed_list)


    print(json.dumps(item_classifications_summary, indent=2, default=str)) # Use default=str for Counter
    print("\\nClassification Experiment (Direct Script Run) COMPLETE.") 