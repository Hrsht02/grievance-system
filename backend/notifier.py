"""
notifier.py — Telegram notifications to patients (in Hindi).
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
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return
    try:
        payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
        if reply_markup:
            payload["reply_markup"] = json.dumps(reply_markup)
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{_BASE}/sendMessage", data=data,
            headers={"Content-Type": "application/json"}, method="POST",
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
        f"✅ *आपकी शिकायत स्वीकृत कर ली गई है।*\n\n"
        f"शिकायत ID: `{complaint_code}`\n"
        f"एक शिकायत अधिकारी आपके मामले की समीक्षा कर रहे हैं। "
        f"समाधान होने पर आपको सूचित किया जाएगा।",
    )


def notify_complaint_resolved(chat_id: int, complaint_code: str):
    _send(
        chat_id,
        f"🔔 *अधिकारी ने आपकी शिकायत हल करने का दावा किया है।*\n\n"
        f"शिकायत ID: `{complaint_code}`\n\n"
        f"क्या आपकी समस्या वास्तव में हल हो गई?",
        reply_markup={
            "inline_keyboard": [[
                {"text": "✅ हाँ, हल हो गई", "callback_data": f"resolved:yes:{complaint_code}"},
                {"text": "❌ नहीं, अभी भी समस्या है", "callback_data": f"resolved:no:{complaint_code}"},
            ]]
        },
    )


def notify_officer_message(chat_id: int, complaint_code: str, message: str):
    _send(
        chat_id,
        f"💬 *शिकायत अधिकारी का संदेश* (शिकायत `{complaint_code}`):\n\n{message}\n\n"
        f"_अधिक जानकारी देने के लिए यहाँ उत्तर करें।_",
    )


def notify_escalated(chat_id: int, complaint_code: str):
    _send(
        chat_id,
        f"🚨 *आपकी शिकायत वरिष्ठ अधिकारी को भेजी गई है।*\n\n"
        f"शिकायत ID: `{complaint_code}`\n"
        f"अधिकारी ने समय पर जवाब नहीं दिया। आपकी शिकायत अब वरिष्ठ अधिकारी के पास है "
        f"और जल्द ही कार्रवाई होगी।",
    )
