"""
notifier.py — Send Telegram notifications to patients.

Used by:
  - api/main.py  (when officer acknowledges, resolves, or sends a message)
  - scheduler.py (when SLA is breached and complaint is escalated)

Keeps all Telegram-specific notification logic in one place so it's easy
to add WhatsApp or SMS later.
"""

import os
import logging
import urllib.request
import urllib.parse
import json

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
_BASE = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


def _send(chat_id: int, text: str, reply_markup: dict | None = None):
    """Low-level send. Swallow errors so a notification failure never crashes the main flow."""
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return
    try:
        payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
        if reply_markup:
            payload["reply_markup"] = json.dumps(reply_markup)
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{_BASE}/sendMessage",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            if not result.get("ok"):
                logger.warning("Telegram sendMessage not ok: %s", result)
    except Exception as e:
        logger.warning("Telegram notification failed (chat_id=%s): %s", chat_id, e)


def notify_complaint_acknowledged(chat_id: int, complaint_code: str):
    _send(
        chat_id,
        f"✅ *Your complaint has been acknowledged.*\n\n"
        f"Complaint ID: `{complaint_code}`\n"
        f"A grievance officer is now reviewing your case. "
        f"You will be notified when it is resolved.",
    )


def notify_complaint_resolved(chat_id: int, complaint_code: str):
    """Send resolution notification with Yes/No confirmation buttons."""
    _send(
        chat_id,
        f"🔔 *The officer has marked your complaint as resolved.*\n\n"
        f"Complaint ID: `{complaint_code}`\n\n"
        f"Was your issue actually resolved?",
        reply_markup={
            "inline_keyboard": [[
                {"text": "✅ Yes, resolved", "callback_data": f"resolved:yes:{complaint_code}"},
                {"text": "❌ No, still a problem", "callback_data": f"resolved:no:{complaint_code}"},
            ]]
        },
    )


def notify_officer_message(chat_id: int, complaint_code: str, message: str):
    """Forward an officer's message to the patient."""
    _send(
        chat_id,
        f"💬 *Message from the grievance officer* (Complaint `{complaint_code}`):\n\n{message}\n\n"
        f"_Reply here if you have more information to add._",
    )


def notify_escalated(chat_id: int, complaint_code: str):
    _send(
        chat_id,
        f"🚨 *Your complaint has been escalated.*\n\n"
        f"Complaint ID: `{complaint_code}`\n"
        f"The officer did not respond in time. Your complaint has been escalated "
        f"to a senior authority and will be addressed urgently.",
    )
