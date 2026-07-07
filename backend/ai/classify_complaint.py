"""
classify_complaint.py

The single piece of "AI backend" this system truly needs at its core:
given a patient's complaint (already converted to text if it came in as
voice), ask an LLM to:
  1. assign it to an existing category tag, OR propose a new one
  2. estimate sentiment / urgency
  3. write a one-line summary (shown in bold at the top of the officer's
     dashboard view)

Design notes for whoever (Kiro) extends this:
- The category tag list is NOT hardcoded into the prompt forever. It lives
  in the database (see database/schema.sql -> complaint_tags table) and is
  fetched fresh each time, so the taxonomy grows from real complaints
  rather than guesswork. New tags proposed by the model land in a
  "pending_review" state until a superadmin approves/merges them.
- This function must NEVER block or discard the original complaint if
  classification fails or is low-confidence. Always store the raw text +
  raw audio regardless of what the AI returns. Classification is a triage
  aid for the dashboard, not a filter.
- Uses Google Gemini's free tier (generativelanguage.googleapis.com).
  Swap MODEL / API call if you move providers later; keep the function
  signature and return shape stable so nothing else has to change.
"""

import json
import os
import urllib.request
import urllib.error

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
)

# Fallback list used only if the database is unreachable when this runs.
# In production this list should come from the complaint_tags table.
DEFAULT_TAGS = [
    "doctor_absent",
    "staff_misbehavior",
    "medicine_unavailable",
    "long_wait_time",
    "cleanliness_issue",
    "billing_issue",
    "equipment_unavailable",
    "wrong_treatment_concern",
    "other",
]

SYSTEM_PROMPT = """You are a triage assistant for a government hospital \
grievance system in Bihar, India. You will be given one patient complaint, \
written in Hindi, English, Bhojpuri, Maithili, or a mix of these \
(code-mixed). You must return ONLY a single valid JSON object, with no \
extra text, no markdown fences, in this exact shape:

{{
  "category": "<one tag from the existing list below, or a new short \
snake_case tag if none fit>",
  "is_new_category": true or false,
  "confidence": <float 0.0 to 1.0>,
  "sentiment": "distressed" | "angry" | "neutral" | "calm",
  "urgency": "critical" | "high" | "normal" | "low",
  "summary_en": "<one short plain-English sentence summarizing the issue>",
  "summary_hi": "<same summary in simple Hindi (Devanagari)>"
}}

Rules:
- "critical" urgency means patient safety could be at immediate risk \
(e.g. no doctor available during an emergency, wrong medicine given, \
patient collapsing and no staff responding). Use this rarely and only when \
clearly warranted.
- If you are unsure between two categories, pick the closest existing tag \
and lower the confidence score rather than inventing a near-duplicate tag.
- Do not add commentary, apology, or explanation outside the JSON object.

Existing tags: {tags}
"""


def classify_complaint(complaint_text: str, existing_tags=None) -> dict:
    """
    Classify a single complaint. Returns a dict matching the JSON shape
    described in SYSTEM_PROMPT. On any failure, returns a safe fallback
    dict with urgency forced to "high" so nothing gets silently dropped
    or under-prioritized.
    """
    tags = existing_tags or DEFAULT_TAGS
    prompt = SYSTEM_PROMPT.format(tags=", ".join(tags))

    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt + "\n\nComplaint:\n" + complaint_text}
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 300,
        },
    }

    try:
        req = urllib.request.Request(
            GEMINI_URL,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
        cleaned = raw_text.strip().strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

        result = json.loads(cleaned)

        # Defensive defaults in case the model omits a field.
        result.setdefault("category", "other")
        result.setdefault("is_new_category", result["category"] not in tags)
        result.setdefault("confidence", 0.5)
        result.setdefault("sentiment", "neutral")
        result.setdefault("urgency", "normal")
        result.setdefault("summary_en", complaint_text[:120])
        result.setdefault("summary_hi", complaint_text[:120])
        return result

    except (urllib.error.URLError, KeyError, json.JSONDecodeError, Exception) as e:
        # Fail-safe: never lose the complaint, never under-prioritize it.
        import logging
        logging.getLogger(__name__).warning(
            "Classification failed (%s: %s) — defaulting to urgency=high", type(e).__name__, e
        )
        return {
            "category": "other",
            "is_new_category": False,
            "confidence": 0.0,
            "sentiment": "neutral",
            "urgency": "high",
            "summary_en": complaint_text[:120],
            "summary_hi": complaint_text[:120],
            "classification_failed": True,
        }


if __name__ == "__main__":
    # Quick manual test (requires GEMINI_API_KEY set in environment).
    sample = "Doctor sahab kal se aaye hi nahi hai, bahut pareshan hain hum log."
    print(json.dumps(classify_complaint(sample), indent=2, ensure_ascii=False))
