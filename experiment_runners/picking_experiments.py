# bias_suite/experiment_runners/picking_experiments.py

import time
import random
import concurrent.futures
from tqdm import tqdm
from collections import Counter # Moved for wider use
import string # For random ID generation
import re

# Corrected import for shared function and config
from config_utils import call_openrouter_api, BIAS_SUITE_LLM_MODEL 
from test_data import PICKING_PAIRS # Import test data

CONCURRENT_API_CALLS = 8

# Define symbol constants
FILLED_SQUARE = "■"
EMPTY_SQUARE = "□"
FILLED_CIRCLE = "●"
EMPTY_CIRCLE = "○"

# --- Labeling Schemes Definition ---
def _generate_random_id_pair():
    """Generates a pair of unique random alphanumeric IDs, e.g., ('ID_a1b2', 'ID_c3d4')."""
    # Ensure IDs are reasonably unique and not too long for prompts
    chars = string.ascii_lowercase + string.digits
    while True:
        id1 = "ID_" + ''.join(random.choice(chars) for _ in range(4))
        id2 = "ID_" + ''.join(random.choice(chars) for _ in range(4))
        if id1 != id2:
            return id1, id2

LABELING_SCHEMES = [
    {
        "name": "Response12", # Original baseline
        "get_labels_for_pair": lambda: ("Response 1", "Response 2"),
        "description": "Labels are 'Response 1' and 'Response 2'"
    },
    {
        "name": "ParentheticalABC",
        "get_labels_for_pair": lambda: ("(A)", "(B)"),
        "description": "Labels are '(A)' and '(B)'"
    },
    {
        "name": "TextAB",
        "get_labels_for_pair": lambda: ("TEXT_A", "TEXT_B"),
        "description": "Labels are 'TEXT_A' and 'TEXT_B'"
    },
    {
        "name": "ResponseAB",
        "get_labels_for_pair": lambda: ("Response A", "Response B"),
        "description": "Labels are 'Response A' and 'Response B'"
    },
    {
        "name": "RandomAlphanumericIDs",
        "get_labels_for_pair": _generate_random_id_pair, # Function to generate fresh IDs per pair
        "description": "Labels are randomly generated alphanumeric IDs (e.g., ID_x7y2, ID_z3k9)"
    },
    {
        "name": "OptionXY",
        "get_labels_for_pair": lambda: ("Option X", "Option Y"),
        "description": "Labels are 'Option X' and 'Option Y'"
    },
    {
        "name": "ExoticSymbolLabels",
        "get_labels_for_pair": lambda: (FILLED_SQUARE, FILLED_CIRCLE), # Present filled square and filled circle
        "description": "Labels are '■' and '●' (Filled Square and Filled Circle)"
    }
]

# Standardized User Prompt for System Prompt Versions
# Ensures consistency in how data is presented when a system prompt is primarily guiding behavior.
STANDARD_USER_PROMPT_FOR_SYSTEM_VERSIONS = (
    "Question: {question}\\n\\n"
    "Option {label1}: \\'{response_a_content}\\'\\n\\n"
    "Option {label2}: \\'{response_b_content}\\'\\n\\n"
    "Please provide your choice ({label1} or {label2})." # System prompt is expected to guide format.
)

# Original prompt variants (will be augmented with system prompt versions)
ORIGINAL_PROMPT_VARIANTS = [
    {
        "name": "Baseline (Impartial Judge)",
        "prompt_template": (
            "You are an impartial judge. Evaluate the quality of the two responses ({label1}, {label2}) for the question: \'{question}\'. "
            "Choose the response that answers the question better based on helpfulness and relevance. "
            "Respond with your choice inside <choice> tags only. For example: <choice>{label1}</choice>. Do not provide explanations or any other text.\\n\\n"
            "Question: {question}\\n\\n"
            "{label1}: \'{response_a_content}\'\\n"
            "{label2}: \'{response_b_content}\'\\n\\n"
            "Which response is better ({label1} or {label2})? Answer with your choice inside <choice> tags only. For example: <choice>{label1}</choice>."
        )
    },
    {
        "name": "Strong Instruction (Avoid Bias)",
        "prompt_template": (
            "You are an impartial judge and your task is to **fairly** evaluate the quality of the two responses provided for the question given below. "
            "The question and two responses are in English. You must choose the response that follows the provided guidelines and answers the question better. "
            "Your evaluation should consider factors such as the helpfulness, relevance, accuracy, depth, linguistic acceptability, and the level of detail of the responses. "
            "**Avoid** any position biases and ensure that the order in which the responses were presented does not influence your decision. "
            "**Do not** allow the length of the responses to influence your evaluation. Be as objective as possible. "
            "You must respond with your choice inside <choice> tags only. For example: <choice>{label1}</choice>. Do not provide explanations or any other text.\\n\\n"
            "Question: {question}\\n\\n"
            "{label1}: \'{response_a_content}\'\\n"
            "{label2}: \'{response_b_content}\'\\n\\n"
            "Which response is better ({label1} or {label2})? Answer with your choice inside <choice> tags only. For example: <choice>{label1}</choice>."
        )
    },
    {
        "name": "Minimal Instruction (Pick Better)",
        "prompt_template": (
            "Evaluate the quality of the two responses ({label1}, {label2}) for the question: \'{question}\'. "
            "Choose the response that answers the question better. "
            "Respond with your choice inside <choice> tags only. For example: <choice>{label1}</choice>.\\n\\n"
            "Question: {question}\\n\\n"
            "{label1}: \'{response_a_content}\'\\n"
            "{label2}: \'{response_b_content}\'\\n\\n"
            "Which response is better ({label1} or {label2})? Answer with your choice inside <choice> tags only. For example: <choice>{label1}</choice>."
        )
    },
    {
        "name": "ClarityPick: Terse Instruction",
        "prompt_template": (
            "Question: {question}\\n\\n"
            "{label1}: \'{response_a_content}\'\\n"
            "{label2}: \'{response_b_content}\'\\n\\n"
            "Evaluate for clarity. Choose the clearer response ({label1} or {label2}). Respond with your choice inside <choice> tags only. For example: <choice>{label1}</choice>."
        )
    },
    {
        "name": "ClarityPick: Expert Persona Instruction",
        "prompt_template": (
            "You are a meticulous Clarity Assessment Expert. Your sole function is to evaluate textual explanations for their understandability, precision, and ease of comprehension for a general audience. You are to remain entirely unbiased, meticulously avoiding any positional bias or influence from response length. Your judgment must be based purely on which text more effectively communicates its message with higher clarity.\\n\\n"
            "The question is: {question}\\n\\n"
            "{label1}: \'{response_a_content}\'\\n"
            "{label2}: \'{response_b_content}\'\\n\\n"
            "Which response exhibits higher clarity ({label1} or {label2})? Answer with your choice inside <choice> tags only. For example: <choice>{label1}</choice>."
        )
    },
    {
        "name": "Emphasis on Content, De-emphasis on Label Names", # This one might be tricky to split, as its structure IS the intervention
        "prompt_template": (
            "You are an impartial judge.\\n"
            "Question: '{question}'\\n\\n"
            "Consider the following two pieces of text:\\n"
            "Piece 1: \\'{response_a_content}\\'\\n"
            "Piece 2: \\'{response_b_content}\\'\\n\\n"
            "Which piece of text answers the question better based on helpfulness and relevance?\\n"
            "If you choose Piece 1, respond with <choice>{label1}</choice>.\\n"
            "If you choose Piece 2, respond with <choice>{label2}</choice>.\\n"
            "Respond with your choice inside <choice> tags only. Use {label1} to refer to Piece 1, and {label2} to refer to Piece 2. Do not provide explanations or any other text.\\n\\n"
            "Your choice:"
        )
    }
]

PROMPT_VARIANTS = []
# The following loop programmatically creates system prompt versions for each original prompt variant.
# The system prompt is generally extracted from the initial instructional part of the original prompt template.
# This is a heuristic-based extraction and might require adjustments if new, structurally complex 
# ORIGINAL_PROMPT_VARIANTS are added. Specific variants with unique structures 
# (e.g., "Emphasis on Content", "ClarityPick: Terse") have custom handling.
for original_variant in ORIGINAL_PROMPT_VARIANTS:
    PROMPT_VARIANTS.append(original_variant) # Add the original

    # Create the system prompt version
    system_version_name = f"{original_variant['name']} (System Prompt Version)"
    system_prompt_content = ""
    
    # Special handling for "Emphasis on Content, De-emphasis on Label Names"
    # This variant's core logic is tied to its user prompt structure, making a system prompt version less direct.
    # We can still create one, but the system prompt will be more about setting up the 'impartial judge' role.
    if original_variant['name'] == "Emphasis on Content, De-emphasis on Label Names":
        system_prompt_content = (
            "You are an impartial judge. You will be presented with a question and two pieces of text. "
            "Your task is to determine which piece of text answers the question better based on helpfulness and relevance. "
            "The user prompt will then instruct you on how to indicate your choice using specific labels (<choice>LABEL</choice>)."
            "Focus solely on the content of the pieces of text for your evaluation. Do not provide explanations or any other text beyond the choice itself."
        )
        # The user prompt remains the same as the original for this specific case, as its structure is the key.
        user_prompt_for_system_version = original_variant['prompt_template']
    elif original_variant['name'] == "ClarityPick: Terse Instruction":
        # For this variant, the "instructional part" is very minimal and embedded.
        # System prompt will take "Evaluate for clarity."
        system_prompt_content = (
            "Your task is to evaluate two responses for clarity. "
            "Choose the clearer response. "
            "Respond with your choice inside <choice> tags only. For example: <choice>CHOSEN_LABEL</choice>. Do not provide explanations or any other text."
        )
        # User prompt is just the data and the question phrasing
        user_prompt_for_system_version = STANDARD_USER_PROMPT_FOR_SYSTEM_VERSIONS # Using the standard one
    else:
        # General case for extracting system prompt instructions
        # This is a simplified extraction; more sophisticated parsing might be needed for complex cases.
        # We'll take the initial instructional sentences.
        
        # For "Baseline (Impartial Judge)"
        if original_variant['name'] == "Baseline (Impartial Judge)":
            system_prompt_content = (
                "You are an impartial judge. Evaluate the quality of the two responses provided for the given question. "
                "Choose the response that answers the question better based on helpfulness and relevance. "
                "Respond with your choice inside <choice> tags only. For example: <choice>CHOSEN_LABEL</choice>. Do not provide explanations or any other text."
            )
        # For "Strong Instruction (Avoid Bias)"
        elif original_variant['name'] == "Strong Instruction (Avoid Bias)":
            system_prompt_content = (
                "You are an impartial judge and your task is to **fairly** evaluate the quality of the two responses provided for the question given below. "
                "The question and two responses are in English. You must choose the response that follows the provided guidelines and answers the question better. "
                "Your evaluation should consider factors such as the helpfulness, relevance, accuracy, depth, linguistic acceptability, and the level of detail of the responses. "
                "**Avoid** any position biases and ensure that the order in which the responses were presented does not influence your decision. "
                "**Do not** allow the length of the responses to influence your evaluation. Be as objective as possible. "
                "You must respond with your choice inside <choice> tags only. For example: <choice>CHOSEN_LABEL</choice>. Do not provide explanations or any other text."
            )
        # For "Minimal Instruction (Pick Better)"
        elif original_variant['name'] == "Minimal Instruction (Pick Better)":
            system_prompt_content = (
                "Evaluate the quality of the two responses provided for the given question. "
                "Choose the response that answers the question better. "
                "Respond with your choice inside <choice> tags only. For example: <choice>CHOSEN_LABEL</choice>. Do not provide explanations or any other text."
            )
        # For "ClarityPick: Expert Persona Instruction"
        elif original_variant['name'] == "ClarityPick: Expert Persona Instruction":
            system_prompt_content = (
                "You are a meticulous Clarity Assessment Expert. Your sole function is to evaluate textual explanations for their understandability, precision, and ease of comprehension for a general audience. "
                "You are to remain entirely unbiased, meticulously avoiding any positional bias or influence from response length. Your judgment must be based purely on which text more effectively communicates its message with higher clarity. "
                "Respond with your choice inside <choice> tags only. For example: <choice>CHOSEN_LABEL</choice>. Do not provide explanations or any other text."
            )
        
        user_prompt_for_system_version = STANDARD_USER_PROMPT_FOR_SYSTEM_VERSIONS

    if system_prompt_content: # Only add if we successfully defined a system prompt
        PROMPT_VARIANTS.append({
            "name": system_version_name,
            "system_prompt": system_prompt_content,
            "prompt_template": user_prompt_for_system_version 
        })

def parse_picking_response(response_text, option1_id="Response 1", option2_id="Response 2"):
    """Parses the LLM's response to determine which option was picked, expecting a <choice> tag."""
    response_stripped = response_text.strip()
    
    # Search for the <choice>TAG_CONTENT</choice> pattern, case-insensitive tag
    match = re.search(r'<choice>\s*(.*?)\s*</choice>', response_stripped, re.IGNORECASE | re.DOTALL)
    
    if not match:
        print(f"Warning: <choice> tag not found in response: '{response_stripped}'")
        return "Unclear" # Tag not found
        
    picked_content_from_tag = match.group(1).strip()

    # Use the passed option1_id and option2_id directly, these are the actual labels used in the prompt.
    label1_original_stripped = option1_id.strip()
    label2_original_stripped = option2_id.strip()
    
    picked_clean_lower = picked_content_from_tag.lower()
    label1_clean_lower = label1_original_stripped.lower()
    label2_clean_lower = label2_original_stripped.lower()

    def is_option_matched(text_to_check_lower, original_label_stripped, lower_label_stripped):
        """
        Checks if the picked text (text_to_check_lower) matches the original label (original_label_stripped).
        Employs several matching strategies in a specific order:
        1. Exact match (case-insensitive).
        2. Symbol variants (e.g., filled vs. empty square/circle if original_label_stripped is a defined symbol).
        3. Parenthetical deconstruction (e.g., "(A)" matches "A", or "A" matches "(A)").
        4. Single character matching the last alphanumeric token of the label.
        5. Substring containment (with word boundary checks for short, single-letter labels).
        Returns a string indicating the match type (e.g., "exact", "variant_symbol_match") or None.
        """
        # 1. Exact match (case insensitive)
        if text_to_check_lower == lower_label_stripped:
            return "exact"
        
        # Rationale for accepting symbol variants (filled/empty):
        # LLMs have occasionally been observed to return the empty version of a symbol 
        # when the filled version was presented (and vice-versa). 
        # This behavior's root cause isn't fully understood but is an observed trait.
        # To make parsing more robust to this, we accept either form if the base symbol matches.
        # NEW: Check for alternate symbol forms (filled/empty)
        # original_label_stripped is the symbol *presented* in the prompt
        # text_to_check_lower is the symbol *picked* by the LLM (already lowercased by caller)
        if original_label_stripped == FILLED_SQUARE and text_to_check_lower == EMPTY_SQUARE: # .lower() not needed for symbols
            return "variant_symbol_match"
        if original_label_stripped == EMPTY_SQUARE and text_to_check_lower == FILLED_SQUARE:
            return "variant_symbol_match"
        if original_label_stripped == FILLED_CIRCLE and text_to_check_lower == EMPTY_CIRCLE:
            return "variant_symbol_match"
        if original_label_stripped == EMPTY_CIRCLE and text_to_check_lower == FILLED_CIRCLE:
            return "variant_symbol_match"

        # 2. Parenthetical variations: label is "(X)", picked text is "X" or contains "X" (inner content)
        #    e.g. original_label_stripped = "(A)", picked_text_lower = "a" or "option a"
        match_label_paren = re.fullmatch(r"\\((.+)\\)", original_label_stripped) # Matches "(<something>)"
        if match_label_paren:
            inner_label_content_original = match_label_paren.group(1) # e.g., "A" from "(A)"
            inner_label_content_lower = inner_label_content_original.lower() # e.g., "a"

            # Case 2a: Picked text is exactly the inner content of the parenthetical label
            if text_to_check_lower == inner_label_content_lower:
                return "exact_parenthetical_label_inner"
            
            # Case 2b: Inner content of parenthetical label is contained in picked text
            is_inner_content_short_single_alpha = len(inner_label_content_lower) == 1 and inner_label_content_lower.isalpha()
            if is_inner_content_short_single_alpha:
                if re.search(r'\\b' + re.escape(inner_label_content_lower) + r'\\b', text_to_check_lower):
                    return "contains_parenthetical_label_inner_boundary"
            elif inner_label_content_lower in text_to_check_lower:
                return "contains_parenthetical_label_inner"

        # 3. Parenthetical variations: label is "X", picked text is "(X)"
        #    e.g. original_label_stripped = "A", picked_text_lower = "(a)"
        match_picked_paren = re.fullmatch(r"\\((.+)\\)", text_to_check_lower) 
        if match_picked_paren:
            inner_picked_content_lower = match_picked_paren.group(1).lower()
            if inner_picked_content_lower == lower_label_stripped: # e.g. Label "A", Picked "(A)" -> inner_picked_content_lower ("a") == lower_label_stripped ("a")
                return "exact_parenthetical_picked_inner"

        # 4. NEW: Picked text is a single alphanumeric character, and it matches the key identifying letter/number of the label
        #    e.g., Label "Option Y", Picked "Y"; Label "Response 1", Picked "1"
        if len(text_to_check_lower) == 1 and text_to_check_lower.isalnum():
            # Extract all alphanumeric "words" or sequences from the original label
            label_tokens = re.findall(r'[a-zA-Z0-9]+', original_label_stripped)
            if label_tokens:
                last_token_of_label = label_tokens[-1].lower()
                if text_to_check_lower == last_token_of_label:
                    return "single_char_matches_last_token"

        # 5. Label is contained in text (case insensitive) - General fallback
        #    Refined: For very short, single alphabetic labels (e.g., "A"), require word boundaries
        #    when checking for containment to avoid accidental matches within other words.
        #    For other labels (multi-word, or with numbers/symbols), direct containment is fine.
        is_short_single_alpha_label = len(lower_label_stripped) == 1 and lower_label_stripped.isalpha()

        if is_short_single_alpha_label: # e.g. Label is "A"
            # Check if the single alpha label (e.g., "a") is present as a whole word in the picked text (e.g., "option a")
            if re.search(r'\\b' + re.escape(lower_label_stripped) + r'\\b', text_to_check_lower):
                return "contains_boundary" 
        elif lower_label_stripped in text_to_check_lower: # e.g. Label "Opt Y", Picked "I pick Opt Y"
            return "contains"
        
        return None # No match found

    match_type1 = is_option_matched(picked_clean_lower, label1_original_stripped, label1_clean_lower)
    match_type2 = is_option_matched(picked_clean_lower, label2_original_stripped, label2_clean_lower)

    # Define what constitutes a "strong" match for tie-breaking (various forms of exactness)
    is_strong_match1 = match_type1 in ["exact", "exact_parenthetical_label_inner", "exact_parenthetical_picked_inner", "single_char_matches_last_token", "variant_symbol_match"]
    is_strong_match2 = match_type2 in ["exact", "exact_parenthetical_label_inner", "exact_parenthetical_picked_inner", "single_char_matches_last_token", "variant_symbol_match"]

    if match_type1 and not match_type2:
        return option1_id # Return the original canonical option1_id (passed to function)
    elif match_type2 and not match_type1:
        return option2_id # Return the original canonical option2_id
    elif match_type1 and match_type2: # Both options matched in some way
        # Tie-breaking: if one is a strong match and the other isn't, prefer the strong one.
        if is_strong_match1 and not is_strong_match2:
            return option1_id
        elif is_strong_match2 and not is_strong_match1:
            return option2_id
        else:
            # Both are strong matches (e.g. identical labels, highly unlikely for distinct options),
            # or both are weaker matches (e.g. both 'contains' like in "I choose A and B").
            # This is genuinely ambiguous.
            print(f"Warning: Ambiguous content '{picked_content_from_tag}' (both options detected, tie-break failed). Match1: {match_type1}, Match2: {match_type2}. Options: ('{label1_original_stripped}', '{label2_original_stripped}'). Response: '{response_stripped}'")
            return "Ambiguous"
    else: # Neither option matched
        print(f"Warning: Content '{picked_content_from_tag}' inside <choice> tag does not match expected options ('{label1_original_stripped}', '{label2_original_stripped}'). Response: '{response_stripped}'")
        return "Ambiguous"

def _execute_pick_task(task_details, quiet=False, repetitions: int = 1, temperature: float = 0.1):
    # These details are constant for all repetitions of this specific task order
    prompt = task_details["prompt"]
    model_to_use = task_details["model_to_use"]
    pair_id = task_details["pair_id"]
    order_run = task_details["order_run"] # Indicates if it's Run 1 (textA as R1) or Run 2 (textB as R1)
    response1_original_id = task_details["response1_original_id"] # Original ID of text presented as Response 1
    response2_original_id = task_details["response2_original_id"] # Original ID of text presented as Response 2
    # Add variant_name to task_details and pass it here for logging
    variant_name = task_details.get("variant_name", "Unknown Variant")
    labeling_scheme_name = task_details.get("labeling_scheme_name", "Unknown Scheme") # New
    actual_label1_for_prompt = task_details["actual_label1_for_prompt"] # New: The label text used for the first option in the prompt
    actual_label2_for_prompt = task_details["actual_label2_for_prompt"] # New: The label text used for the second option in the prompt

    system_prompt_for_api = task_details.get("system_prompt") # Get system_prompt if available

    picked_option_labels_list = []
    picked_original_ids_list = []
    llm_raw_responses_list = []
    errors_in_repetitions_count = 0
    # Store the prompt that's actually sent (it's the same for all reps in this task)
    actual_prompt_sent_to_llm = prompt # Renamed from task_details["prompt"] for clarity here

    if not quiet:
        # Initial message for the task (covering all repetitions)
        print(f"    Executing task for Variant: {variant_name}, Scheme: {labeling_scheme_name}, Pair ID: {pair_id}, Order Run: {order_run} (Presented {actual_label1_for_prompt}: {response1_original_id}, {actual_label2_for_prompt}: {response2_original_id}) with {repetitions} repetition(s).")

    for rep_idx in range(repetitions):
        # Unconditional progress print if repetitions > 1
        if repetitions > 1 and not quiet:
            # The existing "if not quiet and repetitions > 1" was for the detailed message below.
            # This new print is the unconditional heartbeat.
            print(f"      Rep {rep_idx + 1}/{repetitions} for Variant: {variant_name}, Scheme: {labeling_scheme_name}, Pair ID: {pair_id}, Order Run: {order_run} ({actual_label1_for_prompt}:{response1_original_id}, {actual_label2_for_prompt}:{response2_original_id})...")
        
        llm_response_raw = call_openrouter_api(
            prompt, 
            model_name_override=model_to_use, # Pass model_to_use as model_name_override
            quiet=True, 
            temperature=temperature,
            system_prompt_text=system_prompt_for_api # Pass system_prompt here
        )
        
        picked_option_label_single = None
        picked_original_id_single = None
        is_api_error = isinstance(llm_response_raw, str) and llm_response_raw.startswith("Error:")
        is_parsing_error = False

        if not is_api_error:
            # IMPORTANT: Pass the actual labels used in the prompt to the parser
            picked_option_label_single = parse_picking_response(llm_response_raw, actual_label1_for_prompt, actual_label2_for_prompt)
            
            if picked_option_label_single == actual_label1_for_prompt:
                picked_original_id_single = response1_original_id
            elif picked_option_label_single == actual_label2_for_prompt:
                picked_original_id_single = response2_original_id
            else: # "Ambiguous" or "Unclear"
                picked_original_id_single = picked_option_label_single # Store "Ambiguous" or "Unclear"
                is_parsing_error = True 
        else:
             # API error, so picked_original_id_single remains None or we can set to "API Error"
             picked_original_id_single = "API Error"

        picked_option_labels_list.append(picked_option_label_single)
        picked_original_ids_list.append(picked_original_id_single)
        llm_raw_responses_list.append(llm_response_raw)

        if is_api_error or is_parsing_error:
            errors_in_repetitions_count += 1
            if not quiet and repetitions > 1:
                error_type = "API Error" if is_api_error else "Parsing Error"
                print(f"        {error_type} in Rep {rep_idx+1} for Variant: {variant_name}, Scheme: {labeling_scheme_name}, Pair ID: {pair_id}, Order Run: {order_run}. Picked: {picked_original_id_single}. LLM Raw: {llm_response_raw[:100]}...")
        elif not quiet and repetitions > 1: # Successful repetition, print if verbose and multiple reps
            print(f"        Success in Rep {rep_idx+1} for Variant: {variant_name}, Scheme: {labeling_scheme_name}, Pair ID: {pair_id}. Picked (original_id): {picked_original_id_single}, Picked Label: {picked_option_label_single}")


    # Final summary for this task after all repetitions
    if not quiet:
        # Calculate majority pick for this specific task order across its repetitions
        valid_picks_for_majority = [pid for pid in picked_original_ids_list if pid not in [None, "API Error", "Ambiguous", "Unclear"]]
        majority_picked_id_for_task = "N/A"
        if valid_picks_for_majority:
            from collections import Counter
            pick_counts = Counter(valid_picks_for_majority)
            if pick_counts:
                 # Get the most common, then check if it's a true majority or just most frequent in case of ties
                most_common_picks = pick_counts.most_common()
                if len(most_common_picks) == 1 or (len(most_common_picks) > 1 and most_common_picks[0][1] > most_common_picks[1][1]):
                    majority_picked_id_for_task = most_common_picks[0][0]
                else:
                    majority_picked_id_for_task = "Tie/No Clear Majority"
        
        print(f"    Finished task for Variant: {variant_name}, Scheme: {labeling_scheme_name}, Pair ID: {pair_id}, Order Run: {order_run}. Majority Pick (across {repetitions} reps): {majority_picked_id_for_task}. Total Errors in Reps: {errors_in_repetitions_count}/{repetitions}")

    return {
        "variant_name": variant_name, # Include variant name in results
        "labeling_scheme_name": labeling_scheme_name, # New
        "pair_id": pair_id,
        "order_run": order_run,
        "response1_original_id": response1_original_id, # Original ID presented as R1 in this order_run
        "response2_original_id": response2_original_id, # Original ID presented as R2 in this order_run
        "presented_as_label1_text": actual_label1_for_prompt, # New: Actual label text used for first option
        "presented_as_label2_text": actual_label2_for_prompt, # New: Actual label text used for second option
        "llm_raw_responses": llm_raw_responses_list, # List of raw responses
        "picked_option_labels": picked_option_labels_list, # List of actual labels picked e.g. ["(A)", "(A)", "(B)"]
        "picked_original_ids": picked_original_ids_list, # List of actual original IDs picked
        "errors_in_repetitions": errors_in_repetitions_count,
        "total_repetitions": repetitions,
        "actual_prompt_sent_to_llm": actual_prompt_sent_to_llm # Add prompt even on exception for debugging
    }

def _get_majority_pick_and_consistency(picked_original_ids_list, total_repetitions):
    """
    Determines the majority picked original ID and pick consistency from a list of picks.
    Returns (majority_picked_id, pick_consistency_percentage_str, pick_distribution_dict)
    """
    valid_picks = [pid for pid in picked_original_ids_list if pid not in [None, "API Error", "Ambiguous", "Unclear"]]
    
    if not valid_picks:
        return "No Valid Picks", "0/0", {}

    pick_counts = Counter(valid_picks)
    pick_distribution = dict(pick_counts) # For JSON output

    # Majority Pick ID
    majority_picked_id = "Tie/No Clear Majority" # Default if no clear majority or tie
    most_common_picks = pick_counts.most_common()
    if most_common_picks:
        if len(most_common_picks) == 1 or (len(most_common_picks) > 1 and most_common_picks[0][1] > most_common_picks[1][1]):
            majority_picked_id = most_common_picks[0][0]
        # else it remains "Tie/No Clear Majority"
    
    # Pick Consistency (how many times the majority_picked_id was chosen out of valid picks)
    # If there's no clear majority, consistency is based on the count of the most frequent pick.
    pick_consistency_str = "0/0"
    if majority_picked_id not in ["Tie/No Clear Majority", "No Valid Picks"]:
        consistency_count = pick_counts.get(majority_picked_id, 0)
        pick_consistency_str = f"{consistency_count}/{len(valid_picks)}"
    elif most_common_picks: # Handle Tie case for consistency string
        # If tie, consistency based on the count of one of the tied items
        consistency_count = most_common_picks[0][1] 
        pick_consistency_str = f"{consistency_count}/{len(valid_picks)}"
        
    return majority_picked_id, pick_consistency_str, pick_distribution

def _analyze_pair_results(
    pair_id, 
    run1_results, 
    run2_results, 
    question_text, 
    text1_id, 
    text2_id, 
    labeling_scheme_name,             # New
    scheme_label1_used_for_pair,      # New: e.g., "(A)" - the first label from the scheme for this pair
    scheme_label2_used_for_pair,      # New: e.g., "(B)" - the second label from the scheme for this pair
    expected_better_id=None, 
    quiet=False
):
    """
    Analyzes the results for a single pair from its two order runs.
    Returns a dictionary summarizing the analysis for this pair.
    run1_results and run2_results are dicts from _execute_pick_task.
    """
    # --- Run 1 Analysis ---
    run1_majority_pick_id, run1_pick_consistency_str, run1_pick_distribution = _get_majority_pick_and_consistency(
        run1_results["picked_original_ids"], run1_results["total_repetitions"]
    )
    run1_errors = run1_results["errors_in_repetitions"]
    run1_total_reps = run1_results["total_repetitions"]
    
    # --- Run 2 Analysis ---
    run2_majority_pick_id, run2_pick_consistency_str, run2_pick_distribution = _get_majority_pick_and_consistency(
        run2_results["picked_original_ids"], run2_results["total_repetitions"]
    )
    run2_errors = run2_results["errors_in_repetitions"]
    run2_total_reps = run2_results["total_repetitions"]

    # --- Sampled Prompts/Responses for Debugging ---
    # Prompt is the same for all reps in a run, so pick from run1.
    # Responses are sampled up to min(repetitions, 3)
    num_samples_to_include = min(run1_total_reps, 3) # Assuming run1_total_reps is representative of total_repetitions argument

    sampled_run1_interactions = {
        "prompt_sent_to_llm": run1_results.get("actual_prompt_sent_to_llm"),
        "sampled_llm_raw_responses": run1_results.get("llm_raw_responses", [])[:num_samples_to_include]
    }
    sampled_run2_interactions = {
        "prompt_sent_to_llm": run2_results.get("actual_prompt_sent_to_llm"),
        "sampled_llm_raw_responses": run2_results.get("llm_raw_responses", [])[:num_samples_to_include]
    }


    # --- Combined Analysis ---
    analysis_status = "OK"
    if run1_errors == run1_total_reps or run2_errors == run2_total_reps:
        analysis_status = "Error/Missing Runs"
    elif run1_majority_pick_id == "No Valid Picks" or run2_majority_pick_id == "No Valid Picks":
        analysis_status = "Missing run data"
    elif run1_majority_pick_id == "Tie/No Clear Majority" or run2_majority_pick_id == "Tie/No Clear Majority":
        analysis_status = "Error/Inconclusive in runs"

    consistent_choice = None
    positional_bias_detected = None # True, False, or None (if inconclusive)
    favored_actual_label_text = None # New field: e.g., "(A)" or "ID_xyz" if that label was favored

    if analysis_status == "OK":
        if run1_majority_pick_id == run2_majority_pick_id: # Same *original text* picked in both runs
            consistent_choice = run1_majority_pick_id
            positional_bias_detected = False
            # favored_actual_label_text remains None as there's no positional bias
        else:
            # Different original texts picked -> Positional Bias Suspected
            consistent_choice = None 
            positional_bias_detected = True
            
            # Determine which *actual presented label* (e.g., "(A)", "ID_xyz") was picked in each run,
            # considering what that label corresponded to in terms of original content.

            # Run 1: What label was picked?
            # run1_results["picked_option_labels"] contains the list of actual labels picked across repetitions for this run.
            # We need the majority actual label picked for run1.
            run1_valid_actual_labels = [l for l in run1_results["picked_option_labels"] if l not in ["Ambiguous", "Unclear", None]] # Exclude parsing errors
            run1_majority_actual_label_picked = None
            if run1_valid_actual_labels:
                run1_actual_label_counts = Counter(run1_valid_actual_labels)
                run1_most_common_actual_labels = run1_actual_label_counts.most_common()
                if run1_most_common_actual_labels and (len(run1_most_common_actual_labels) == 1 or run1_most_common_actual_labels[0][1] > run1_most_common_actual_labels[1][1]):
                    run1_majority_actual_label_picked = run1_most_common_actual_labels[0][0]
            
            # Run 2: What label was picked?
            run2_valid_actual_labels = [l for l in run2_results["picked_option_labels"] if l not in ["Ambiguous", "Unclear", None]]
            run2_majority_actual_label_picked = None
            if run2_valid_actual_labels:
                run2_actual_label_counts = Counter(run2_valid_actual_labels)
                run2_most_common_actual_labels = run2_actual_label_counts.most_common()
                if run2_most_common_actual_labels and (len(run2_most_common_actual_labels) == 1 or run2_most_common_actual_labels[0][1] > run2_most_common_actual_labels[1][1]):
                    run2_majority_actual_label_picked = run2_most_common_actual_labels[0][0]

            # If the same *actual label string* (e.g., "(A)") was the majority pick in both runs,
            # even though it pointed to different original content, that's the favored label string.
            if run1_majority_actual_label_picked is not None and run1_majority_actual_label_picked == run2_majority_actual_label_picked:
                favored_actual_label_text = run1_majority_actual_label_picked
            else:
                favored_actual_label_text = "Inconclusive Position" 
    
    pair_summary = {
        "pair_id": pair_id,
        "labeling_scheme_name": labeling_scheme_name, # New
        "scheme_label1_used_for_pair": scheme_label1_used_for_pair, # New
        "scheme_label2_used_for_pair": scheme_label2_used_for_pair, # New
        "question": question_text,
        "text1_id": text1_id,
        "text2_id": text2_id,
        "expected_better_id": expected_better_id,
        "analysis_status": analysis_status,
        "consistent_choice": consistent_choice,
        "positional_bias_detected": positional_bias_detected,
        "favored_actual_label_text": favored_actual_label_text, # New: e.g. "(A)" or "ID_xyz"
        
        "run1_order": f"{run1_results['presented_as_label1_text']}: {run1_results['response1_original_id']} vs {run1_results['presented_as_label2_text']}: {run1_results['response2_original_id']}", # Updated order string
        "run1_majority_pick_id": run1_majority_pick_id,
        "run1_pick_consistency": run1_pick_consistency_str,
        "run1_pick_distribution": run1_pick_distribution,
        "run1_errors": f"{run1_errors}/{run1_total_reps}",
        "run1_raw_llm_responses": run1_results["llm_raw_responses"] if not quiet else "Suppressed",
        "run1_sampled_interactions": sampled_run1_interactions, # New for JSON output

        "run2_order": f"{run2_results['presented_as_label1_text']}: {run2_results['response1_original_id']} vs {run2_results['presented_as_label2_text']}: {run2_results['response2_original_id']}", # Updated order string
        "run2_majority_pick_id": run2_majority_pick_id,
        "run2_pick_consistency": run2_pick_consistency_str,
        "run2_pick_distribution": run2_pick_distribution,
        "run2_errors": f"{run2_errors}/{run2_total_reps}",
        "run2_raw_llm_responses": run2_results["llm_raw_responses"] if not quiet else "Suppressed",
        "run2_sampled_interactions": sampled_run2_interactions # New for JSON output
    }
    return pair_summary


def run_positional_bias_picking_experiment(model_to_run_experiment_with: str, num_pairs_to_test=None, quiet=False, repetitions: int = 1, temperature: float = 0.1):
    """
    Runs the positional bias picking experiment for a specified number of pairs and prompt variants.
    Each pair is tested with two orders of presentation (Run 1 and Run 2).
    Each order run is repeated `repetitions` times.
    Returns a list of dictionaries, where each dictionary represents a prompt variant and contains a summary of results.
    """
    if not quiet:
        print(f"\n--- Running Positional Bias Picking Experiment ---")
        print(f"Number of prompt variants: {len(PROMPT_VARIANTS)}")
        print(f"Number of labeling schemes: {len(LABELING_SCHEMES)}") # New
        print(f"Repetitions per order run: {repetitions}")
        print(f"Temperature for API calls: {temperature}") # Log temperature
        print(f"LLM Model: {model_to_run_experiment_with}") # Uses the passed model name

    pairs_to_evaluate = PICKING_PAIRS
    if num_pairs_to_test is not None and num_pairs_to_test > 0:
        if num_pairs_to_test <= len(PICKING_PAIRS):
            pairs_to_evaluate = random.sample(PICKING_PAIRS, num_pairs_to_test)
            if not quiet: print(f"Testing with a random sample of {num_pairs_to_test} pairs.")
        else:
            if not quiet: print(f"Requested {num_pairs_to_test} pairs, but only {len(PICKING_PAIRS)} available. Testing with all available pairs.")
    else:
        if not quiet: print(f"Testing with all {len(PICKING_PAIRS)} available pairs.")
    
    if not quiet:
        print(f"Total pairs to evaluate: {len(pairs_to_evaluate)}")

    all_experiment_results = [] # This will be the final list of dicts (one per variant-scheme combo)

    for variant_info in tqdm(PROMPT_VARIANTS, desc="Prompt Variants", leave=False):
        variant_name = variant_info["name"]
        prompt_template = variant_info["prompt_template"]
        system_prompt_content = variant_info.get("system_prompt") # Get system_prompt for the task details

        if not quiet:
            print(f"\n  Processing Variant: {variant_name}")

        for scheme_info in tqdm(LABELING_SCHEMES, desc=f"Labeling Schemes ({variant_name})", leave=False): # New inner loop
            labeling_scheme_name = scheme_info["name"]
            get_labels_for_pair_func = scheme_info["get_labels_for_pair"]
            
            if not quiet:
                print(f"\n    Processing Labeling Scheme: {labeling_scheme_name} for Variant: {variant_name}")

            # --- Prepare tasks for this variant + scheme ---
            tasks_for_variant_scheme = []
            # Store generated labels per pair for this scheme to ensure consistency between run1 and run2
            # especially for random schemes.
            pair_specific_labels = {} 

            for pair_data in pairs_to_evaluate:
                pair_id = pair_data["pair_id"]
                question = pair_data["question"]
                text_a = pair_data["text_A"]
                text_b = "text_B" # This was a typo, should be pair_data["text_B"]
                text_b = pair_data["text_B"] # Corrected
                expected_better_id = pair_data.get("expected_better_id")

                # Get/Generate labels for this pair using the current scheme's method
                # These labels (scheme_label1, scheme_label2) are what the *scheme* defines as its first and second label.
                # For "RandomAlphanumericIDs", this will generate a new pair for each (pair_data, scheme_info) combo.
                # We need to ensure the *same* random IDs are used for Run1 and Run2 of the *same pair_data*.
                if pair_id not in pair_specific_labels:
                    pair_specific_labels[pair_id] = get_labels_for_pair_func()
                
                scheme_defined_label1, scheme_defined_label2 = pair_specific_labels[pair_id]
                
                # Run 1: text_a is presented with scheme_defined_label1, text_b with scheme_defined_label2
                # The prompt template uses {label1} for the first presented item, {label2} for the second.
                prompt1 = prompt_template.format(
                    question=question, 
                    label1=scheme_defined_label1, response_a_content=text_a, 
                    label2=scheme_defined_label2, response_b_content=text_b
                )
                tasks_for_variant_scheme.append({
                    "variant_name": variant_name,
                    "labeling_scheme_name": labeling_scheme_name, # New
                    "pair_id": pair_id,
                    "order_run": 1,
                    "question_text": question,
                    "text_a_original_id": "text_A", 
                    "text_b_original_id": "text_B",
                    "response1_original_id": "text_A", # Content for the first slot
                    "response2_original_id": "text_B", # Content for the second slot
                    "actual_label1_for_prompt": scheme_defined_label1, # Label used for the first slot in prompt
                    "actual_label2_for_prompt": scheme_defined_label2, # Label used for the second slot in prompt
                    "prompt": prompt1,
                    "model_to_use": model_to_run_experiment_with,
                    "expected_better_id": expected_better_id,
                    "system_prompt": system_prompt_content # Add system_prompt to task details
                })

                # Run 2: text_b is presented with scheme_defined_label1, text_a with scheme_defined_label2
                prompt2 = prompt_template.format(
                    question=question, 
                    label1=scheme_defined_label1, response_a_content=text_b, # text_b is now in {label1}'s slot
                    label2=scheme_defined_label2, response_b_content=text_a  # text_a is now in {label2}'s slot
                )
                tasks_for_variant_scheme.append({
                    "variant_name": variant_name,
                    "labeling_scheme_name": labeling_scheme_name, # New
                    "pair_id": pair_id,
                    "order_run": 2,
                    "question_text": question,
                    "text_a_original_id": "text_A", 
                    "text_b_original_id": "text_B", 
                    "response1_original_id": "text_B", # Content for the first slot
                    "response2_original_id": "text_A", # Content for the second slot
                    "actual_label1_for_prompt": scheme_defined_label1, # Label used for the first slot in prompt
                    "actual_label2_for_prompt": scheme_defined_label2, # Label used for the second slot in prompt
                    "prompt": prompt2,
                    "model_to_use": model_to_run_experiment_with,
                    "expected_better_id": expected_better_id,
                    "system_prompt": system_prompt_content # Add system_prompt to task details
                })
            
            # --- Execute tasks for this variant + scheme ---
            current_run_raw_execution_results = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_API_CALLS) as executor:
                future_to_task = { 
                    executor.submit(_execute_pick_task, task, quiet, repetitions, temperature): task # Pass temperature
                    for task in tasks_for_variant_scheme # Use tasks for current scheme
                }
                for future in tqdm(concurrent.futures.as_completed(future_to_task), total=len(tasks_for_variant_scheme), desc=f"API Calls ({variant_name}/{labeling_scheme_name})", leave=False):
                    task_details = future_to_task[future]
                    try:
                        result = future.result()
                        current_run_raw_execution_results.append(result)
                    except Exception as exc:
                        print(f'Task {task_details["pair_id"]} (Variant: {variant_name}, Scheme: {labeling_scheme_name}, Order Run: {task_details["order_run"]}) generated an exception: {exc}')
                        current_run_raw_execution_results.append({
                            "variant_name": variant_name,
                            "labeling_scheme_name": labeling_scheme_name,
                            "pair_id": task_details["pair_id"],
                            "order_run": task_details["order_run"],
                            "response1_original_id": task_details["response1_original_id"],
                            "response2_original_id": task_details["response2_original_id"],
                            "presented_as_label1_text": task_details["actual_label1_for_prompt"],
                            "presented_as_label2_text": task_details["actual_label2_for_prompt"],
                            "llm_raw_responses": [f"Exception: {exc}"],
                            "picked_option_labels": [None],
                            "picked_original_ids": ["Exception"],
                            "errors_in_repetitions": repetitions,
                            "total_repetitions": repetitions,
                            "actual_prompt_sent_to_llm": task_details["prompt"] # Add prompt even on exception for debugging
                        })
            
            # --- Process and analyze results for this variant + scheme ---
            summary_list_for_variant_scheme = [] 
            # Counters for this specific variant + scheme combination
            favored_scheme_label1_count = 0
            favored_scheme_label2_count = 0
            favored_position_inconclusive_count = 0 # Renamed from variant-level
            
            positional_bias_detected_count = 0 # Renamed
            consistent_choices_count = 0       # Renamed
            error_or_inconclusive_pairs_count = 0 # Renamed
            valid_pairs_for_bias_calc = 0
            valid_pairs_for_consistency_calc = 0

            results_by_pair_for_scheme = {}
            for res in current_run_raw_execution_results:
                pid = res["pair_id"]
                if pid not in results_by_pair_for_scheme:
                    results_by_pair_for_scheme[pid] = {}
                results_by_pair_for_scheme[pid][res["order_run"]] = res
            
            total_pairs_tested_in_scheme = len(results_by_pair_for_scheme)

            for pair_id, runs_data in tqdm(results_by_pair_for_scheme.items(), desc=f"Analyzing Pairs ({variant_name}/{labeling_scheme_name})", leave=False):
                run1_res = runs_data.get(1)
                run2_res = runs_data.get(2)
                
                original_pair_info = next((p for p in pairs_to_evaluate if p["pair_id"] == pair_id), None)
                if not original_pair_info:
                    print(f"Warning: Could not find original pair info for {pair_id} in variant {variant_name}, scheme {labeling_scheme_name}. Skipping.")
                    error_or_inconclusive_pairs_count += 1
                    continue

                # Retrieve the specific labels used for this pair under this scheme
                # This is crucial for _analyze_pair_results and for the final summary counts
                current_pair_scheme_labels = pair_specific_labels.get(pair_id)
                if not current_pair_scheme_labels:
                     print(f"Critical Error: Could not find stored scheme labels for pair {pair_id} under scheme {labeling_scheme_name}. Skipping analysis.")
                     error_or_inconclusive_pairs_count +=1
                     continue
                
                scheme_label1_for_this_pair, scheme_label2_for_this_pair = current_pair_scheme_labels

                if run1_res and run2_res and original_pair_info:
                    pair_analysis_result = _analyze_pair_results(
                        pair_id=pair_id,
                        run1_results=run1_res,
                        run2_results=run2_res,
                        question_text=original_pair_info["question"],
                        text1_id=original_pair_info["text_A_id"], 
                        text2_id=original_pair_info["text_B_id"],
                        labeling_scheme_name=labeling_scheme_name,           # Pass scheme name
                        scheme_label1_used_for_pair=scheme_label1_for_this_pair, # Pass actual first label of scheme
                        scheme_label2_used_for_pair=scheme_label2_for_this_pair, # Pass actual second label of scheme
                        expected_better_id=original_pair_info.get("expected_better_id"),
                        quiet=quiet
                    )
                    summary_list_for_variant_scheme.append(pair_analysis_result)

                    if pair_analysis_result["analysis_status"] == "OK":
                        valid_pairs_for_bias_calc += 1
                        if pair_analysis_result["positional_bias_detected"] is True:
                            positional_bias_detected_count += 1
                            # Now count which actual label was favored
                            fav_label_text = pair_analysis_result.get("favored_actual_label_text")
                            if fav_label_text == scheme_label1_for_this_pair:
                                favored_scheme_label1_count += 1
                            elif fav_label_text == scheme_label2_for_this_pair:
                                favored_scheme_label2_count += 1
                            elif fav_label_text == "Inconclusive Position": # check if this is the exact string
                                favored_position_inconclusive_count +=1
                        
                        if pair_analysis_result["consistent_choice"] is not None:
                            valid_pairs_for_consistency_calc += 1 
                            consistent_choices_count += 1 
                    else:
                        error_or_inconclusive_pairs_count += 1
                else:
                    if not quiet: print(f"    Skipping analysis for Pair ID: {pair_id} in {variant_name}/{labeling_scheme_name} due to missing run data or original info.")
                    error_or_inconclusive_pairs_count += 1
                    summary_list_for_variant_scheme.append({
                        "pair_id": pair_id,
                        "labeling_scheme_name": labeling_scheme_name,
                        "scheme_label1_used_for_pair": scheme_label1_for_this_pair,
                        "scheme_label2_used_for_pair": scheme_label2_for_this_pair,
                        "question": original_pair_info["question"] if original_pair_info else "Unknown",
                        "text1_id": original_pair_info["text_A_id"] if original_pair_info else "Unknown",
                        "text2_id": original_pair_info["text_B_id"] if original_pair_info else "Unknown",
                        "expected_better_id": original_pair_info.get("expected_better_id") if original_pair_info else None,
                        "analysis_status": "Error/Missing Execution Data",
                        "consistent_choice": None,
                        "positional_bias_detected": None,
                        "favored_actual_label_text": None,
                        "run1_majority_pick_id": run1_res.get("picked_original_ids", ["Missing"])[0] if run1_res else "Missing",
                        "run2_majority_pick_id": run2_res.get("picked_original_ids", ["Missing"])[0] if run2_res else "Missing",
                    })
            
            # --- Summary for this Variant + Scheme ---
            bias_rate = (positional_bias_detected_count / valid_pairs_for_bias_calc * 100) if valid_pairs_for_bias_calc > 0 else 0
            consistency_rate = (consistent_choices_count / valid_pairs_for_bias_calc * 100) if valid_pairs_for_bias_calc > 0 else 0
            # Determine how many samples to take from the first pair's runs for the overall summary
            # This is just to show an example of what prompts looked like for this variant-scheme
            # The actual full sample for each pair is within summary_list_for_variant_scheme
            example_pair_summary_for_prompts = next(iter(summary_list_for_variant_scheme), None)
            example_prompt_run1 = "N/A"
            example_prompt_run2 = "N/A"
            if example_pair_summary_for_prompts:
                if example_pair_summary_for_prompts.get("run1_sampled_interactions"):
                    example_prompt_run1 = example_pair_summary_for_prompts["run1_sampled_interactions"].get("prompt_sent_to_llm", "N/A")
                if example_pair_summary_for_prompts.get("run2_sampled_interactions"):
                    example_prompt_run2 = example_pair_summary_for_prompts["run2_sampled_interactions"].get("prompt_sent_to_llm", "N/A")

            # Get the scheme's canonical labels for the summary (for non-random, these are fixed)
            # For random, this won't be a single pair, but it indicates the *type* of labels used.
            # The pair_summary will have the *actual* random IDs used for that pair.
            # For the aggregate summary, we just note the scheme name and its general label pattern if fixed.
            scheme_display_label1, scheme_display_label2 = ("", "")
            if labeling_scheme_name != "RandomAlphanumericIDs":
                 # For fixed schemes, we can get their representative labels
                 # This assumes get_labels_for_pair() returns consistent representative labels for non-random schemes
                 # or we can store scheme_info["description"] or the labels themselves if static.
                 # Let's use the first pair's labels for simplicity in display, or the scheme description.
                 # For the ProcessedPickingData, we DO want the *actual scheme labels* (e.g., "(A)", "(B)")
                 # So, let's get them from the *first* pair processed for this scheme, assuming they are consistent for non-random.
                 # Or better, get it from scheme_info directly if it stores static labels.
                 # Our current LABELING_SCHEMES structure uses a function for all.
                 # For non-random, calling it again gives the same labels.
                temp_l1, temp_l2 = get_labels_for_pair_func()
                scheme_display_label1 = temp_l1
                scheme_display_label2 = temp_l2
            else: # Random IDs
                scheme_display_label1 = "ID_rand1" # Placeholder for summary
                scheme_display_label2 = "ID_rand2" # Placeholder for summary

            # Get the prompts used for this variant for storing in the summary
            # These were defined at the top level of the variant_info
            system_prompt_for_summary = variant_info.get("system_prompt")
            user_prompt_template_for_summary = variant_info.get("prompt_template")

            experiment_summary_dict = {
                "model_name": model_to_run_experiment_with,
                "variant_name": variant_name,
                "labeling_scheme_name": labeling_scheme_name,
                "scheme_description": scheme_info["description"], # Add scheme description
                "scheme_display_label1": scheme_display_label1, # e.g., "(A)" or "ID_rand1"
                "scheme_display_label2": scheme_display_label2, # e.g., "(B)" or "ID_rand2"
                "system_prompt_used": system_prompt_for_summary, # ADDED
                "user_prompt_template_used": user_prompt_template_for_summary, # ADDED
                "example_full_prompt_run1_structure": example_prompt_run1, # Example of a fully formatted prompt for run 1
                "example_full_prompt_run2_structure": example_prompt_run2, # Example of a fully formatted prompt for run 2
                "total_pairs_tested_in_scheme": total_pairs_tested_in_scheme,
                "repetitions_per_order_run": repetitions,
                "pairs_with_errors_or_inconclusive_in_scheme": error_or_inconclusive_pairs_count,
                "valid_pairs_for_bias_calculation": valid_pairs_for_bias_calc,
                "positional_bias_detected_count": positional_bias_detected_count,
                "positional_bias_rate_percentage": float(f"{bias_rate:.2f}"),
                "favored_scheme_label1_count": favored_scheme_label1_count, # Count of pairs biased towards the scheme's first label
                "favored_scheme_label2_count": favored_scheme_label2_count, # Count of pairs biased towards the scheme's second label
                "favored_position_inconclusive_count": favored_position_inconclusive_count, # Bias detected, but not consistently for L1 or L2
                "valid_pairs_for_consistency_calculation": valid_pairs_for_consistency_calc,
                "consistent_choices_count": consistent_choices_count,
                "consistency_rate_percentage": float(f"{consistency_rate:.2f}"),
                "pairs_summary_for_scheme": summary_list_for_variant_scheme 
            }
            all_experiment_results.append(experiment_summary_dict)

            if not quiet:
                print(f"    Summary for Variant: {variant_name}, Scheme: {labeling_scheme_name}")
                print(f"      Total Pairs Tested: {total_pairs_tested_in_scheme}")
                print(f"      Pairs with Errors/Inconclusive: {error_or_inconclusive_pairs_count}")
                print(f"      Positional Bias Detected In: {positional_bias_detected_count}/{valid_pairs_for_bias_calc} valid pairs ({bias_rate:.2f}%)")
                print(f"        Favored '{scheme_display_label1}': {favored_scheme_label1_count} times")
                print(f"        Favored '{scheme_display_label2}': {favored_scheme_label2_count} times")
                print(f"        Favored (Inconclusive Position): {favored_position_inconclusive_count} times")
                print(f"      Consistent Choices In: {consistent_choices_count}/{valid_pairs_for_consistency_calc} valid pairs ({consistency_rate:.2f}%)")

    if not quiet:
        print(f"\n--- Positional Bias Picking Experiment Complete ---")
    
    return all_experiment_results # This list of dicts (one per variant-scheme) is the output


if __name__ == '__main__':
    from dotenv import load_dotenv
    import os 
    # Load .env from parent directory or current/project root.
    # Assumes structure where this script is in a subdirectory (e.g., experiment_runners)
    # and .env is in the project root (parent of this script's dir).
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    PROJECT_ROOT = os.path.dirname(SCRIPT_DIR) # This should be llm_judge_bias_suite
    dotenv_path_project_root = os.path.join(PROJECT_ROOT, '.env')

    if os.path.exists(dotenv_path_project_root):
        load_dotenv(dotenv_path_project_root)
    else:
        load_dotenv() # Fallback to default .env loading (current dir or search up)
    
    from config_utils import set_api_key, set_llm_model
    set_api_key(os.getenv('OPENROUTER_API_KEY'))
    set_llm_model(os.getenv('BIAS_SUITE_LLM_MODEL'))

    if not os.getenv('OPENROUTER_API_KEY'):
        print("CRITICAL: OPENROUTER_API_KEY not found in environment. Please ensure .env file is correctly placed and loaded.")
    else:
        run_positional_bias_picking_experiment(model_to_run_experiment_with="gpt-3.5-turbo", num_pairs_to_test=1, repetitions=1, quiet=False, temperature=0.5) 