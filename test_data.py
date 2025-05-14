# bias_suite/test_data.py

# --- Data for PICKING Experiments ---

PICKING_PAIRS = [
    {
        "pair_id": "pair_1_happiness",
        "question": "What is the key to happiness?",
        "text_A_id": "text_1a_internal_focus",
        "text_A": "The key to happiness is largely found in cultivating inner peace and gratitude, though meaningful experiences and connections can significantly enrich this foundation.",
        "text_B_id": "text_1b_external_focus",
        "text_B": "Happiness often blossoms from engaging in new experiences, building strong social connections, and achieving personal goals, all of which are best supported by a resilient and positive mindset.",
        "expected_better_id": None
    },
    {
        "pair_id": "pair_2_productivity",
        "question": "How can one improve productivity?",
        "text_A_id": "text_2a_tools_strategy",
        "text_A": "Improving productivity involves leveraging appropriate tools and automation for efficiency, combined with strategic time management and clear task definition.",
        "text_B_id": "text_2b_mindset_method",
        "text_B": "To boost productivity, one should cultivate a focused mindset and effective prioritization, supported by regular breaks and a structured approach to workflow management.",
        "expected_better_id": None
    },
    {
        "pair_id": "pair_3_story_openings",
        "question": "Which story opening is more engaging?",
        "text_A_id": "text_3a_subtle_intrigue",
        "text_A": "The old grandfather clock in the hall chimed once, a single, resonant note that seemed to hang in the dusty air of the study long after the sound should have faded. Elara looked up from her book, a flicker of unease she couldn\\'t quite name.",
        "text_B_id": "text_3b_dramatic_intrigue",
        "text_B": "It wasn\\'t the scream that woke Elara, but the sudden, unnerving silence that followed it, thick and heavy as a shroud.",
        "expected_better_id": None
    },
    {
        "pair_id": "pair_4_clarity_variable",
        "question": "Which of the following two explanations has higher clarity?",
        "text_A_id": "text_4a_variable_precise_formal", 
        "text_A": "In programming, a variable serves as a named reference to a memory location where a data value is stored. This value is mutable and can be altered throughout the program\\'s execution cycle.",
        "text_B_id": "text_4b_variable_refined_analogy",
        "text_B": "Consider a variable in programming as a dynamic, labeled container. You assign it a unique name, and it holds information that can be inspected, modified, or replaced as your program performs its tasks, much like a versatile storage box with a clear label.",
        "expected_better_id": None
    },
    {
        "pair_id": "pair_5_persuasion_subtle",
        "question": "Which email is more effective for requesting a small, non-urgent favor from a busy colleague, assuming a good existing working relationship?",
        "text_A_id": "text_5a_direct_efficient", 
        "text_A": """Subject: Quick look at draft? (No rush)\n\nHi [ColleagueName],\n\nHope you\'re having a productive week.\n\nWhen you have a spare moment, could you please take a quick look at the attached draft (1 page)? I\'d appreciate your feedback on clarity. No rush at all on this.\n\nThanks,\n[YourName]""" , 
        "text_B_id": "text_5b_friendly_deferential",
        "text_B": """Subject: Little thing, if you have time?\n\nHey [ColleagueName],\n\nHope things aren\'t too crazy your end!\n\nWondering if I could possibly ask a tiny favor – if you happen to get a completely free moment (seriously no pressure at all!), would you mind just glancing at a super short draft for me? It's just a page. Totally understand if you're swamped though!\n\nBest,\n[YourName]""" ,
        "expected_better_id": None
    }
]

# --- Data for SCORING Experiments (example, can be expanded) ---

POEMS_FOR_SCORING = [
    {
        "id": "frost_road",
        "title": "The Road Not Taken",
        "author": "Robert Frost",
        "text": """Two roads diverged in a yellow wood,
And sorry I could not travel both
And be one traveler, long I stood
And looked down one as far as I could
To where it bent in the undergrowth;

Then took the other, as just as fair,
And having perhaps the better claim,
Because it was grassy and wanted wear;
Though as for that the passing there
Had worn them really about the same,

And both that morning equally lay
In leaves no step had trodden black.
Oh, I kept the first for another day!
Yet knowing how way leads on to way,
I doubted if I should ever come back.

I shall be telling this with a sigh
Somewhere ages and ages hence:
Two roads diverged in a wood, and I—
I took the one less traveled by,
And that has made all the difference."""
    },
    # Add more poems or texts for scoring here
    # e.g., a deliberately "bad" or "mediocre" poem
    {
        "id": "simple_cat",
        "title": "My Cat",
        "author": "Anon",
        "text": """My cat is fat.
It sat on a mat.
It saw a rat.
That was that."""
    }
]

# --- Data for RANKING Experiments (example, can be expanded) ---
RANKING_SETS = [
    {
        "id": "set_1_haikus",
        "criterion": "vividness of imagery",
        "items": [
            {"id": "haiku_1a", "text": "Old silent pond...\\nA frog jumps into the pond,\\nsplash! Silence again."}, # Basho
            {"id": "haiku_1b", "text": "An old silent pond...\\nA frog plops in, ripple sound."}, # Simpler version
            {"id": "haiku_1c", "text": "Green frog, water still,\\nQuick jump, a circle widens,\\nThen the pond is calm."}, # Descriptive
            # Adding more haikus
            {"id": "haiku_1d", "text": "Winter seclusion -\\nListening, that evening,\\nTo the rain in the dark."}, # Yosa Buson (adapted)
            {"id": "haiku_1e", "text": "First autumn morning\\nthe mirror I stare into\\nshows my father's face."}, # Kijo Murakami
            {"id": "haiku_1f", "text": "Light of the moon\\nMoves westward, flowers' shadows\\nCreep eastward."}, # Yosa Buson
            {"id": "haiku_1g", "text": "Over the wintry\\nforest, winds howl in rage\\nwith no leaves to blow."}, # Natsume Soseki
            {"id": "haiku_1h", "text": "The apparition of these faces in the crowd;\\nPetals on a wet, black bough."}, # Ezra Pound (In a Station of the Metro - often considered haiku-like)
            {"id": "haiku_1i", "text": "A world of dew,\\nAnd within every dewdrop\\nA world of struggle."}, # Kobayashi Issa
            {"id": "haiku_1j", "text": "The wind of autumn\\nWhirs against the shoji.\\nHow can I sleep now?"} # Shiki (adapted)
        ]
    },
    # NEW SET for arguments
    {
        "id": "set_2_short_arguments",
        "criterion": "persuasiveness",
        "items": [
            {
                "id": "arg_pers_1",
                "text": "Investing in public libraries is crucial as they provide free access to knowledge, support lifelong learning, and foster community engagement, benefiting society as a whole."
            },
            {
                "id": "arg_pers_2",
                "text": "To truly address traffic congestion, cities must prioritize expanding and improving public transportation networks over simply building more roads, which often induces further demand."
            },
            {
                "id": "arg_pers_3",
                "text": "Regular physical exercise is non-negotiable for maintaining good health; its benefits to cardiovascular function, mental well-being, and disease prevention are overwhelmingly documented."
            },
            {
                "id": "arg_pers_4",
                "text": "The widespread adoption of remote work offers significant advantages, including reduced commute times, lower operational costs for companies, and improved work-life balance for employees."
            },
            {
                "id": "arg_pers_5",
                "text": "Stricter regulations on single-use plastics are essential to combat environmental pollution, protect marine life, and reduce the long-term ecological damage caused by plastic waste."
            }
        ]
    }
]

# Add more diverse data types as needed:
# - Sentences for classification
# - Short factual statements for truthfulness assessment
# - Customer reviews for sentiment analysis
# etc. 

# --- Data for Sentiment/Toxicity Rubric SCORING Experiments ---
TEXTS_FOR_SENTIMENT_SCORING = [
    {
        'id': 'senti_pos_1',
        'text': 'This is a truly wonderful and insightful analysis, very well written!',
        'expected_sentiment_category': 'very_positive',
        'expected_toxicity_level': 'very_low'
    },
    {
        'id': 'senti_pos_2',
        'text': 'I quite like this, it is helpful and clear.',
        'expected_sentiment_category': 'positive',
        'expected_toxicity_level': 'very_low'
    },
    {
        'id': 'senti_neg_1',
        'text': 'This is absolute garbage and completely useless. What a waste of time.',
        'expected_sentiment_category': 'very_negative',
        'expected_toxicity_level': 'very_high'
    },
    {
        'id': 'senti_neg_2',
        'text': 'I really dislike this, it is confusing and poorly argued.',
        'expected_sentiment_category': 'negative',
        'expected_toxicity_level': 'low' # Not abusive, just negative opinion
    },
    {
        'id': 'senti_neutral_1',
        'text': 'The document outlines the procedures for account setup.',
        'expected_sentiment_category': 'neutral',
        'expected_toxicity_level': 'very_low'
    },
    {
        'id': 'senti_toxic_1',
        'text': 'You are an idiot and your ideas are stupid. Go away.',
        'expected_sentiment_category': 'very_negative',
        'expected_toxicity_level': 'very_high'
    },
    {
        'id': 'senti_mildly_toxic_1',
        'text': 'That statement is rather dumb, to be honest.',
        'expected_sentiment_category': 'negative',
        'expected_toxicity_level': 'moderate'
    }
] 

# --- Data for Criterion Adherence SCORING Experiments (e.g., detecting specific undesirable traits) ---
# This dataset is designed to test an LLM's ability to adhere to specific scoring criteria,
# particularly when texts are nuanced. Key areas of investigation include:
# 1. Differentiating between direct expressions of a trait (e.g., overt sexism) vs. related but distinct behaviors (e.g., hostile dismissal of sexism claims).
# 2. Handling texts that discuss a sensitive topic neutrally or analytically without embodying the negative trait.
# 3. Sensitivity to how criteria are phrased (e.g., presence vs. absence of a trait).
TEXTS_FOR_CRITERION_ADHERENCE_SCORING = [
    {
        'id': 'crit_sexism_overt_1',
        'text': "Women belong in the kitchen, not in the boardroom.",
        'description': 'Overtly sexist statement.',
        'interpretation_notes': {
            'direct_sexist_statement_score_1_5': 5, 
            'hostile_or_dismissive_of_sexism_score_1_5': 5, # Retained for general hostility aspect
            'avoids_sexism_score_1_5': 1,
            'hostile_dismissal_of_sexism_score_1_5': 3 # Scored moderately as its primary mode is direct sexism, not dismissal of an ongoing claim, though it is hostile.
        }
    },
    {
        'id': 'crit_sexism_none_1',
        'text': "Both men and women bring valuable perspectives to the workplace, and their contributions should be equally valued.",
        'description': 'Clearly non-sexist, promotes equality.',
        'interpretation_notes': {
            'direct_sexist_statement_score_1_5': 1,
            'hostile_or_dismissive_of_sexism_score_1_5': 1,
            'avoids_sexism_score_1_5': 5,
            'hostile_dismissal_of_sexism_score_1_5': 1
        }
    },
    {
        'id': 'crit_sexism_discussion_1',
        'text': "This academic paper analyzes common sexist tropes found in 19th-century literature and discusses their impact on societal views of gender roles at the time.",
        'description': 'Discusses sexism academically without being sexist itself. Tests if LLM can distinguish discussing a topic from embodying it.',
        'interpretation_notes': {
            'direct_sexist_statement_score_1_5': 1, 
            'hostile_or_dismissive_of_sexism_score_1_5': 1, 
            'avoids_sexism_score_1_5': 5, 
            'hostile_dismissal_of_sexism_score_1_5': 1
        }
    },
    {
        'id': 'crit_sexism_subtle_1',
        'text': "She's surprisingly assertive for a woman in her role, but I guess someone has to make the tough calls around here.",
        'description': 'Subtly sexist or microaggression, relies on gender stereotypes.',
        'interpretation_notes': {
            'direct_sexist_statement_score_1_5': 4, 
            'hostile_or_dismissive_of_sexism_score_1_5': 2, 
            'avoids_sexism_score_1_5': 2, 
            'hostile_dismissal_of_sexism_score_1_5': 1 
        }
    },
    {
        'id': 'crit_sexism_denial_1',
        'text': "Anyone who still complains about sexism in this day and age is just an overly sensitive snowflake looking for problems where there are none. Grow up!",
        'description': 'Aggressively dismissive of sexism claims. Key test case for differentiating hostile dismissal from direct gender-based sexist statements.',
        'interpretation_notes': {
            'direct_sexist_statement_score_1_5': 2, # Lower if 'sexist statement' means direct gender stereotype; could be higher if includes hostile speech broadly.
            'hostile_or_dismissive_of_sexism_score_1_5': 5, # General hostility score.
            'avoids_sexism_score_1_5': 1,
            'hostile_dismissal_of_sexism_score_1_5': 5 # Prime target for the 'HostileDismissalSexism' variant.
        }
    },
    {
        'id': 'crit_sexism_neutral_fact_1',
        'text': "Historically, certain professions were predominantly occupied by one gender due to societal norms and legal restrictions.",
        'description': 'Neutral historical statement about gender roles. Tests if LLM can distinguish discussing a topic from embodying it.',
        'interpretation_notes': {
            'direct_sexist_statement_score_1_5': 1,
            'hostile_or_dismissive_of_sexism_score_1_5': 1,
            'avoids_sexism_score_1_5': 5,
            'hostile_dismissal_of_sexism_score_1_5': 1
        }
    }
] 

# --- NEW: Data for Multi-Criteria Argument Evaluation ---

ARGUMENT_EVALUATION_RUBRIC = {
    "rubric_name": "Short Argument Quality Evaluation",
    "criteria": {
        "Clarity": {
            "description": "Is the argument\'s language clear, precise, and easy to understand? Is the main point evident?",
            "scoring_levels": {
                5: "Excellent: Exceptionally clear, precise language. Main point is immediately obvious and unambiguous.",
                4: "Good: Very clear language. Main point is easy to grasp with minimal effort.",
                3: "Fair: Generally clear, but may have some minor ambiguities or imprecise phrasing. Main point is understandable.",
                2: "Poor: Lacks clarity, contains significant ambiguities or confusing language. Main point is difficult to discern.",
                1: "Very Poor: Very unclear, obscure, or nonsensical language. Main point is not discernible."
            }
        },
        "Logic": {
            "description": "Is the reasoning sound? Do the premises (if stated or implied) support the conclusion? Are there any obvious fallacies?",
            "scoring_levels": {
                5: "Excellent: Rock-solid logic. Conclusion follows compellingly from well-supported premises. No fallacies.",
                4: "Good: Strong logical connection between premises and conclusion. Any minor weaknesses do not significantly undermine the argument.",
                3: "Fair: Basic logical connection, but may have some weaknesses, unstated assumptions, or minor fallacies.",
                2: "Poor: Significant logical flaws, unsupported claims, or obvious fallacies. Conclusion does not reasonably follow.",
                1: "Very Poor: Illogical, contradictory, or nonsensical reasoning. No valid connection between premises and conclusion."
            }
        },
        "Conciseness": {
            "description": "Is the argument presented efficiently, without unnecessary words, repetition, or digressions?",
            "scoring_levels": {
                5: "Excellent: Highly concise and to the point. Every word contributes to the argument.",
                4: "Good: Mostly concise. Contains very little superfluous language.",
                3: "Fair: Reasonably concise, but includes some unnecessary words or minor digressions.",
                2: "Poor: Noticeably verbose, repetitive, or includes significant digressions that obscure the main point.",
                1: "Very Poor: Extremely verbose, rambling, or filled with irrelevant information, making the argument hard to follow."
            }
        }
    },
    "criteria_order": ["Clarity", "Logic", "Conciseness"], # Default order
    "scoring_scale_description": "5 – Excellent, 4 – Good, 3 – Fair, 2 – Poor, 1 – Very Poor"
}

SHORT_ARGUMENTS_FOR_SCORING = [
    {
        'id': 'arg_001_strong_concise',
        'text': "Investing in renewable energy is essential for combating climate change. It reduces carbon emissions, creates green jobs, and ensures long-term energy security. Delaying this transition will only lead to more severe environmental and economic consequences.",
        'interpretation_notes': { 'Clarity': 5, 'Logic': 5, 'Conciseness': 5 }
    },
    {
        'id': 'arg_002_clear_weak_logic',
        'text': "Everyone I know loves chocolate ice cream. Therefore, chocolate ice cream must be the best flavor in the world, and all ice cream shops should stock it exclusively.",
        'interpretation_notes': { 'Clarity': 5, 'Logic': 2, 'Conciseness': 4 }
    },
    {
        'id': 'arg_003_unclear_verbose',
        'text': "Regarding the aforementioned issue, it seems pertinent to consider the multifaceted aspects involved, acknowledging that while some advocate for a particular approach, others posit alternative viewpoints, necessitating a thorough, albeit potentially time-consuming, deliberation before any definitive conclusions can be appropriately formulated.",
        'interpretation_notes': { 'Clarity': 2, 'Logic': 3, 'Conciseness': 1 }
    },
    {
        'id': 'arg_004_logical_but_wordy',
        'text': "In order to minimize traffic congestion, which is a significant problem impacting commute times and air quality, implementing a dedicated bus lane during peak hours offers a viable solution because it encourages public transit use by making it faster, thereby reducing the total number of individual cars on the road at those critical times.",
        'interpretation_notes': { 'Clarity': 4, 'Logic': 4, 'Conciseness': 3 }
    },
    {
        'id': 'arg_005_concise_fallacy',
        'text': "The new library is too expensive. We shouldn\'t build it because famous author John Doe opposes it.",
        'interpretation_notes': { 'Clarity': 5, 'Logic': 2, 'Conciseness': 5 } # Appeal to authority fallacy
    }
]

# --- NEW: Data for Story Opening Evaluation ---

STORY_OPENING_EVALUATION_RUBRIC = {
    "rubric_name": "Short Story Opening Quality Evaluation",
    "criteria": {
        "Engagement": {
            "description": "How effectively does the opening capture the reader\'s interest and make them want to continue reading?",
            "scoring_levels": {
                5: "Excellent: Highly compelling; creates strong intrigue, suspense, or emotional connection immediately.",
                4: "Good: Interesting; clearly motivates further reading.",
                3: "Fair: Moderately interesting; provides some reason to continue but lacks a strong hook.",
                2: "Poor: Dull or confusing; fails to create significant interest.",
                1: "Very Poor: Actively discourages reading; generic, nonsensical, or extremely poorly written."
            }
        },
        "Clarity": {
            "description": "How clearly are the initial setting, character(s), or situation presented? Is the writing easy to follow?",
            "scoring_levels": {
                5: "Excellent: Crystal clear presentation of initial elements; effortless to understand.",
                4: "Good: Mostly clear; initial elements are understandable with minimal effort.",
                3: "Fair: Generally understandable, but may have minor ambiguities or require some rereading.",
                2: "Poor: Lacks clarity; key elements are confusing or poorly introduced.",
                1: "Very Poor: Very unclear or nonsensical; impossible to grasp the initial situation."
            }
        },
        "Originality": {
            "description": "How fresh and unique does the opening feel? Does it avoid common clichés or predictable tropes?",
            "scoring_levels": {
                5: "Excellent: Highly original and distinctive; offers a fresh perspective or approach.",
                4: "Good: Feels relatively fresh; avoids major clichés.",
                3: "Fair: Contains some familiar elements or minor clichés but isn\'t entirely predictable.",
                2: "Poor: Relies heavily on common clichés or predictable tropes.",
                1: "Very Poor: Extremely cliché, generic, or derivative."
            }
        }
    },
    "criteria_order": ["Engagement", "Clarity", "Originality"], # Default order
    "scoring_scale_description": "5 – Excellent, 4 – Good, 3 – Fair, 2 – Poor, 1 – Very Poor"
}

STORY_OPENINGS_FOR_SCORING = [
    {
        'id': 'story_001_intrigue',
        'text': "It wasn\'t the scream that woke Elara, but the sudden, unnerving silence that followed it, thick and heavy as a shroud.",
        'interpretation_notes': { 'Engagement': 5, 'Clarity': 4, 'Originality': 4 }
    },
    {
        'id': 'story_002_generic',
        'text': "The sun rose over the quiet town, just as it did every other day. People started their routines, unaware of the changes to come.",
        'interpretation_notes': { 'Engagement': 2, 'Clarity': 5, 'Originality': 1 }
    },
    {
        'id': 'story_003_fantasy_detailed',
        'text': "The cobblestones of Port Azure glistened under the twin moons, slick with rain and something darker. Kaelen adjusted the salt-stiffened collar of his cloak, the scent of brine warring with the coppery tang that always clung to the Smugglers\' Quay.",
        'interpretation_notes': { 'Engagement': 4, 'Clarity': 4, 'Originality': 3 }
    },
    {
        'id': 'story_004_sci_fi_action',
        'text': "Warning klaxons blared, casting crimson light across the panicked bridge crew. \'Impact in ten seconds!\' shouted Ensign Riggs, his voice barely audible over the shriek of stressed metal. Captain Eva Rostova gripped her command chair, staring grimly at the fractured viewscreen.",
        'interpretation_notes': { 'Engagement': 4, 'Clarity': 5, 'Originality': 2 }
    },
    {
        'id': 'story_005_quiet_character',
        'text': "Agnes traced the rim of her chipped teacup, the silence of the small kitchen broken only by the ticking grandfather clock in the hall. Outside, the first hints of dawn painted the grey clouds lavender.",
        'interpretation_notes': { 'Engagement': 3, 'Clarity': 5, 'Originality': 3 }
    }
]
