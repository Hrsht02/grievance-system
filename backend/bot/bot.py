"""
bot.py — Telegram bot for complaint intake.

Flow per patient interaction:
  1. Patient scans QR → Telegram deep-link opens with token as /start payload
  2. Bot looks up token → confirms identity (Yes / No inline buttons)
  3. If multiple departments on file, ask which department (buttons only)
  4. Bot asks patient to describe problem (text or voice note)
  5. Voice note → speech-to-text (Whisper via local endpoint or fallback)
  6. Text → AI classification (reuse classify_complaint.py)
  7. Store complaint, generate complaint code, notify patient
  8. Optional: patient can flag AI category as wrong

Status checks: patient sends their complaint code at any time to get status.
"""

import logging
import os
import datetime
import tempfile
from pathlib import Path

from dotenv import load_dotenv

# Support running from repo root OR from backend/ directory
_this_dir = Path(__file__).parent
_backend_dir = _this_dir.parent if _this_dir.name == "bot" else _this_dir
load_dotenv(_backend_dir / "config" / ".env")

import sys
sys.path.insert(0, str(_backend_dir))

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardRemove,
)
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)

from db import (
    get_patient_by_token,
    update_patient_chat_id,
    get_approved_tags,
    ensure_tag_exists,
    generate_complaint_code,
    create_complaint,
    get_complaint_by_code,
    update_complaint_status,
    add_message,
    get_officer_for_hospital,
    create_escalation,
)
from ai.classify_complaint import classify_complaint
from stt import transcribe_audio

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

ACK_SLA_MINUTES = int(os.environ.get("DEFAULT_ACK_SLA_MINUTES", "30"))
RESOLUTION_SLA_HOURS = int(os.environ.get("DEFAULT_RESOLUTION_SLA_HOURS", "48"))
CRITICAL_ACK_SLA_MINUTES = int(os.environ.get("CRITICAL_ACK_SLA_MINUTES", "15"))
CRITICAL_RESOLUTION_SLA_HOURS = int(os.environ.get("CRITICAL_RESOLUTION_SLA_HOURS", "4"))

# In-memory session state per Telegram chat_id.
# In production move this to Redis.
sessions: dict[int, dict] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sla_deadlines(urgency: str):
    now = datetime.datetime.utcnow()
    if urgency == "critical":
        ack = now + datetime.timedelta(minutes=CRITICAL_ACK_SLA_MINUTES)
        res = now + datetime.timedelta(hours=CRITICAL_RESOLUTION_SLA_HOURS)
    else:
        ack = now + datetime.timedelta(minutes=ACK_SLA_MINUTES)
        res = now + datetime.timedelta(hours=RESOLUTION_SLA_HOURS)
    return ack, res


def _yes_no_keyboard(yes_data: str, no_data: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("✅ Yes", callback_data=yes_data),
          InlineKeyboardButton("❌ No", callback_data=no_data)]]
    )


def _department_keyboard(departments: list[dict]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(d["name"], callback_data=f"dept:{d['id']}:{d['name']}")]
        for d in departments
    ]
    rows.append([InlineKeyboardButton("Other / Not listed", callback_data="dept:none:Other")])
    return InlineKeyboardMarkup(rows)


def _format_status(complaint: dict) -> str:
    status_emoji = {
        "new": "🟡",
        "acknowledged": "🔵",
        "resolved": "✅",
        "reopened": "🔴",
        "escalated": "🚨",
    }
    emoji = status_emoji.get(complaint["status"], "⚪")
    created = complaint.get("created_at", "")
    if hasattr(created, "strftime"):
        created = created.strftime("%d %b %Y, %H:%M")
    lines = [
        f"*Complaint {complaint['complaint_code']}*",
        f"Status: {emoji} {complaint['status'].upper()}",
        f"Category: {complaint.get('category', 'N/A')}",
        f"Summary: {complaint.get('summary_en', '')}",
        f"Filed: {created}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# /start — QR token entry point
# ---------------------------------------------------------------------------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    args = context.args

    if not args:
        await update.message.reply_text(
            "👋 Welcome to the Bihar Government Hospital Grievance System.\n\n"
            "Please scan the QR code on your hospital file to get started."
        )
        return

    token = args[0].strip()
    logger.info("Token received: %s (chat_id=%s)", token, chat_id)
    patient = get_patient_by_token(token)

    if not patient:
        await update.message.reply_text(
            "Sorry, we couldn't find a patient record for this QR code. "
            "Please contact the hospital reception for assistance."
        )
        return

    # Save this Telegram chat_id so we can push notifications to the patient later
    update_patient_chat_id(str(patient["id"]), chat_id)

    sessions[chat_id] = {
        "state": "awaiting_identity_confirm",
        "patient": patient,
        "token": token,
    }

    dept = patient.get("department_name") or "your department"
    hospital = patient.get("hospital_name", "your hospital")
    await update.message.reply_text(
        f"Are you *{patient['name']}*, {dept}, {hospital}?",
        parse_mode="Markdown",
        reply_markup=_yes_no_keyboard("identity:yes", "identity:no"),
    )


# ---------------------------------------------------------------------------
# Inline button handler
# ---------------------------------------------------------------------------

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = query.message.chat_id
    data = query.data
    session = sessions.get(chat_id, {})

    # Identity confirmation
    if data == "identity:yes":
        if session.get("state") != "awaiting_identity_confirm":
            return
        session["state"] = "awaiting_complaint"
        await query.edit_message_text(
            "Thank you. Please describe your problem — type it or send a voice note.\n"
            "You can write in Hindi, English, Bhojpuri, or any language.",
        )

    elif data == "identity:no":
        sessions.pop(chat_id, None)
        await query.edit_message_text(
            "Sorry about that. Please scan your own QR code, "
            "or contact the hospital reception for help."
        )

    # Department selection
    elif data.startswith("dept:"):
        if session.get("state") != "awaiting_department":
            return
        parts = data.split(":", 2)
        dept_id = parts[1] if parts[1] != "none" else None
        dept_name = parts[2] if len(parts) > 2 else "Other"
        session["selected_department_id"] = dept_id
        session["selected_department_name"] = dept_name
        session["state"] = "awaiting_complaint"
        await query.edit_message_text(f"Got it — {dept_name}. Now please describe your problem.")

    # Category feedback from patient
    elif data == "category:correct":
        code = session.get("complaint_code", "")
        await query.edit_message_text(
            f"Thank you — your complaint has been filed.\nComplaint ID: *{code}*",
            parse_mode="Markdown",
        )

    elif data == "category:wrong":
        complaint_id = session.get("complaint_id")
        if complaint_id:
            add_message(complaint_id, "system", "Patient flagged AI category as incorrect.")
        code = session.get("complaint_code", "")
        await query.edit_message_text(
            f"Noted — flagged for manual review.\nYour complaint ID: *{code}*",
            parse_mode="Markdown",
        )

    # Post-resolution satisfaction check
    elif data.startswith("resolved:yes:") or data.startswith("resolved:no:"):
        action, _, code = data.partition(":")
        _, _, code = data.split(":", 2)   # "resolved:yes:BH-..." → code
        action = "yes" if ":yes:" in data else "no"
        complaint = get_complaint_by_code(code)
        if complaint:
            if action == "yes":
                update_complaint_status(
                    complaint["id"], "resolved",
                    resolved_at=datetime.datetime.utcnow(),
                    patient_confirmed_resolved=True,
                )
                add_message(complaint["id"], "system", "Patient confirmed resolution.")
                await query.edit_message_text(
                    "Thank you for confirming. We're glad your issue was resolved. 🙏"
                )
            else:
                update_complaint_status(complaint["id"], "reopened", patient_confirmed_resolved=False)
                add_message(complaint["id"], "system",
                            "Patient indicated issue NOT resolved. Reopened and escalated.")
                create_escalation(complaint["id"], complaint.get("assigned_officer_id"),
                                  "superadmin", "patient_reopened")
                await query.edit_message_text(
                    "We're sorry the issue wasn't resolved. Your complaint has been reopened "
                    "and escalated to a senior officer. You will be contacted shortly."
                )
        else:
            await query.edit_message_text("Could not find your complaint. Please contact reception.")

    # Legacy callbacks (session-based, kept for backward compat)
    elif data == "resolved:yes":
        await query.edit_message_text("Thank you for confirming. 🙏")
    elif data == "resolved:no":
        await query.edit_message_text(
            "Your complaint has been reopened and escalated. You will be contacted shortly."
        )


# ---------------------------------------------------------------------------
# Text message handler
# ---------------------------------------------------------------------------

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    text = update.message.text.strip()

    # Status check — patient sends their complaint ID (works always, no session needed)
    if text.upper().startswith("BH-") and len(text) > 8:
        complaint = get_complaint_by_code(text.upper())
        if complaint:
            await update.message.reply_text(_format_status(complaint), parse_mode="Markdown")
        else:
            await update.message.reply_text("No complaint found with that ID. Please check and try again.")
        return

    session = sessions.get(chat_id)

    if not session:
        await update.message.reply_text(
            "Please scan your QR code to start filing a complaint. Type /start if you need help."
        )
        return

    if session.get("state") == "awaiting_complaint":
        await _process_complaint_text(update, session, text)
    elif session.get("state") == "filed":
        # After filing, user is free to send anything — treat it as a new complaint if they want
        await update.message.reply_text(
            "Your complaint has been filed. If you want to file a new complaint, scan your QR code again.\n\n"
            "To check your complaint status, just send your complaint ID (e.g. BH-AIIMSPAT-...)."
        )
    else:
        await update.message.reply_text(
            "Please use the buttons above to respond, or send your complaint as text or voice note."
        )


# ---------------------------------------------------------------------------
# Voice message handler
# ---------------------------------------------------------------------------

async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    session = sessions.get(chat_id)

    if not session or session.get("state") != "awaiting_complaint":
        await update.message.reply_text("Please scan your QR code first before sending a complaint.")
        return

    await update.message.reply_text("🎙️ Voice note received. Transcribing…")

    voice = update.message.voice
    voice_file = await context.bot.get_file(voice.file_id)

    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
        await voice_file.download_to_drive(tmp.name)
        audio_path = tmp.name

    transcribed = transcribe_audio(audio_path)
    if not transcribed:
        transcribed = "[Voice complaint — transcription unavailable]"

    raw_audio_url = f"local:{audio_path}"
    await _process_complaint_text(update, session, transcribed, raw_audio_url=raw_audio_url)


# ---------------------------------------------------------------------------
# Core: classify + store complaint
# ---------------------------------------------------------------------------

async def _process_complaint_text(
    update: Update,
    session: dict,
    text: str,
    raw_audio_url: str | None = None,
):
    """Classify, store, and confirm a complaint. Catches all errors so patient always gets a reply."""
    patient = session["patient"]

    await update.message.reply_text("⏳ Filing your complaint…")

    try:
        await _do_file_complaint(update, session, text, raw_audio_url, patient)
    except Exception as e:
        logger.exception("Error filing complaint for patient %s: %s", patient.get("id"), e)
        await update.message.reply_text(
            "⚠️ Something went wrong while filing your complaint. "
            "Please try sending your message again, or contact the hospital reception."
        )


async def _do_file_complaint(
    update: Update,
    session: dict,
    text: str,
    raw_audio_url: str | None,
    patient: dict,
):
    """All the actual work — errors bubble up to _process_complaint_text."""

    department_id = session.get("selected_department_id") or patient.get("department_id")

    # Step 1: AI classification
    logger.info("Classifying complaint for patient %s", patient.get("id"))
    tags = get_approved_tags()
    classification = classify_complaint(text, existing_tags=tags if tags else None)
    logger.info("Classification: category=%s urgency=%s confidence=%s",
                classification.get("category"),
                classification.get("urgency"),
                classification.get("confidence"))

    # Persist any newly proposed tag
    if classification.get("is_new_category"):
        ensure_tag_exists(classification["category"], True)

    # Step 2: SLA deadlines
    urgency = classification.get("urgency", "high")
    ack_deadline, res_deadline = _sla_deadlines(urgency)

    # Step 3: Find officer for this hospital's district
    logger.info("Finding officer for hospital_id=%s", patient["hospital_id"])
    officer = get_officer_for_hospital(str(patient["hospital_id"]))
    officer_id = str(officer["id"]) if officer else None
    logger.info("Assigned officer_id=%s", officer_id)

    # Step 4: Generate code and insert complaint
    complaint_code = generate_complaint_code(patient["hospital_name"])
    logger.info("Complaint code: %s", complaint_code)

    complaint = create_complaint(
        patient_id=str(patient["id"]),
        hospital_id=str(patient["hospital_id"]),
        department_id=str(department_id) if department_id else None,
        raw_text=text,
        raw_audio_url=raw_audio_url,
        classification=classification,
        complaint_code=complaint_code,
        is_anonymous=session.get("is_anonymous", False),
        assigned_officer_id=officer_id,
        ack_deadline=ack_deadline,
        resolution_deadline=res_deadline,
    )
    logger.info("Complaint stored: id=%s", complaint["id"])

    # Step 5: Audit trail
    add_message(str(complaint["id"]), "patient", text)

    # Update session
    session["complaint_code"] = complaint_code
    session["complaint_id"] = str(complaint["id"])
    session["state"] = "filed"

    # Step 6: Confirm to patient
    category_display = (classification.get("category") or "other").replace("_", " ").title()
    summary = classification.get("summary_en") or text[:120]

    confirm_text = (
        f"✅ *Complaint filed successfully\\!*\n\n"
        f"Your complaint ID: `{complaint_code}`\n"
        f"Category: *{category_display}*\n"
        f"Summary: _{summary}_\n\n"
        f"Send your complaint ID here anytime to check its status\\.\n\n"
        f"Does this category seem correct?"
    )

    await update.message.reply_text(
        confirm_text,
        parse_mode="MarkdownV2",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ Yes, correct", callback_data="category:correct"),
                InlineKeyboardButton("❌ No, wrong category", callback_data="category:wrong"),
            ]
        ]),
    )


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logger.error("Unhandled exception:", exc_info=context.error)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_bot():
    if not TELEGRAM_BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set in environment.")

    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button_handler))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_error_handler(error_handler)

    logger.info("Bot starting — token ends in ...%s", TELEGRAM_BOT_TOKEN[-6:])
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    logging.basicConfig(
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
        level=logging.INFO,
    )
    run_bot()
