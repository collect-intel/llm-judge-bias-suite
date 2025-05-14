import os
import requests
import time
import json

# --- LLM Configuration ---
# OPENROUTER_API_KEY is populated by the main script (bias_analyzer.py) after loading .env
OPENROUTER_API_KEY = None

# BIAS_SUITE_LLM_MODEL serves as a fallback default if no model is specified via
# command-line arguments (--model or --models) or the BIAS_SUITE_LLM_MODEL environment variable in .env.
# The actual model used by experiments is determined in bias_analyzer.py based on this hierarchy.
BIAS_SUITE_LLM_MODEL = "mistralai/mistral-small-3.1-24b-instruct"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

def set_api_key(key):
    global OPENROUTER_API_KEY
    OPENROUTER_API_KEY = key

def set_llm_model(model_name):
    """Sets the global LLM model. Called by bias_analyzer.py based on CLI args / .env or its own default."""
    global BIAS_SUITE_LLM_MODEL
    if model_name:
        BIAS_SUITE_LLM_MODEL = model_name

def call_openrouter_api(prompt_text, model_name_override=None, quiet=False):
    """Calls the OpenRouter API with the given prompt and model."""

    if not OPENROUTER_API_KEY:
        # This case is critical and should be loud if not quiet.
        error_msg = "Error: OPENROUTER_API_KEY is not set. Ensure it is loaded and set via set_api_key()."
        if not quiet: print(f"CRITICAL_API_CALL_FAILURE: {error_msg}")
        return error_msg

    # Use override model_name if provided, otherwise use the global config
    actual_model_name = model_name_override if model_name_override else BIAS_SUITE_LLM_MODEL

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost/bias_suite", 
        "X-Title": "Bias Suite Experiment"
    }
    data = {
        "model": actual_model_name,
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": 1000, 
        "temperature": 0.1
    }
    
    max_retries = 3
    retry_delay = 5

    for attempt in range(max_retries):
        if not quiet:
            print(f"    [API Call Attempt {attempt + 1}/{max_retries} to {actual_model_name}] Sending request...")
        try:
            response = requests.post(OPENROUTER_API_URL, headers=headers, json=data, timeout=60)
            response.raise_for_status() # Raises an HTTPError for bad responses (4XX or 5XX)
            response_data = response.json()
            
            llm_content = None
            message_obj = response_data.get('choices', [{}])[0].get('message', {})
            llm_content_from_main = message_obj.get('content')
            llm_reasoning_content = message_obj.get('reasoning') # Check for 'reasoning' field

            if llm_content_from_main and llm_content_from_main.strip():
                llm_content = llm_content_from_main
                if not quiet:
                    print(f"    [API Call Success for {actual_model_name}] Received content from 'content' field.")
            elif llm_reasoning_content and llm_reasoning_content.strip():
                llm_content = llm_reasoning_content # Use reasoning if content is empty but reasoning is not
                if not quiet:
                    print(f"    [API Call Info for {actual_model_name}] Main 'content' was empty, using 'reasoning' field instead.")
            else:
                # Both content and reasoning are empty or just whitespace
                error_msg = f"Error: LLM response was empty in both 'content' and 'reasoning' fields from {actual_model_name}."
                if not quiet:
                    print(f"    [API Call Warning for {actual_model_name}] {error_msg} Full API response: {response_data}")
                return error_msg 
            
            # llm_content should now be populated if either field had text
            # The old check "if not llm_content:" is covered by the logic above.
            
            if not quiet and llm_content_from_main and llm_content_from_main.strip(): # Only print this if main content was used and verbose
                # This log might be too verbose if we successfully got content from reasoning, 
                # so it's conditional on original llm_content_from_main being present.
                # The success/info log above is now the primary indicator.
                pass # The specific "Received response." log is now part of the conditional logs above.

            return llm_content.strip()
            
        except requests.exceptions.HTTPError as http_err:
            error_message = f"HTTPError calling OpenRouter API ({actual_model_name}): {http_err.response.status_code} {http_err.response.reason}."
            try:
                error_details_json = http_err.response.json()
                error_message += f" API Response: {error_details_json}"
            except ValueError: # If response is not JSON
                error_message += f" API Response (Non-JSON): {http_err.response.text}"
            
            if not quiet:
                print(f"    [API Call HTTPError for {actual_model_name}, Attempt {attempt + 1}/{max_retries}] {error_message}")
            # Decide on retrying based on status code for HTTP errors
            if http_err.response.status_code in [401, 403, 404]: # Don't retry for auth or not found errors
                if not quiet: print(f"    [API Call {actual_model_name}] Critical error {http_err.response.status_code}. Not retrying.")
                return error_message # Return the detailed error immediately
            # For other errors (e.g., 429, 5xx), proceed to retry if attempts left

        except requests.exceptions.RequestException as e:
            # Catches other network errors like ConnectionError, Timeout, etc.
            error_message = f"RequestException calling OpenRouter API ({actual_model_name}): {e}"
            if not quiet:
                print(f"    [API Call RequestException for {actual_model_name}, Attempt {attempt + 1}/{max_retries}] {error_message}")
        
        except (KeyError, IndexError, json.JSONDecodeError) as e: # Added json.JSONDecodeError here
            # Handles issues with parsing the expected JSON structure from a 200 OK response
            error_message = f"Error parsing OpenRouter response structure ({actual_model_name}): {e}."
            if 'response' in locals() and response is not None:
                error_message += f" Raw Response Text: {response.text}"
            else:
                error_message += " No response object available."
            if not quiet:
                print(f"    [API Call ParsingError for {actual_model_name}, Attempt {attempt + 1}/{max_retries}] {error_message}")
            # Generally, parsing errors on a 200 OK response might not benefit from retrying the API call itself.
            # However, if it was a truncated response, a retry *might* help. For now, we let it retry.

        # Common logic for retrying if not a critical non-retry HTTPError
        if attempt < max_retries - 1:
            if not quiet:
                print(f"    [API Call {actual_model_name}] Retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
        else: # Max retries for this call reached
            final_error_message = f"Error: Max retries ({max_retries}) exceeded for API call to {actual_model_name}. Last error: {error_message}"
            if not quiet:
                print(f"    [API Call Failure for {actual_model_name}] {final_error_message}")
            return final_error_message
            
    # Fallback, should not be reached if logic is correct, but as a safeguard:
    return f"Error: API call to {actual_model_name} failed after all attempts and conditions." 