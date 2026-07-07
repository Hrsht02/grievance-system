"""
scheduler.py — Background SLA checker.

Runs as a standalone process (or embedded in the API server).
Uses APScheduler to check every minute for:
  - Complaints past their acknowledgment SLA → flag to superadmin
  - Complaints past their resolution SLA → escalate to superadmin

Each breach is recorded in the escalations table so patterns of neglect
are visible on the superadmin dashboard, not just individual events.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / "config" / ".env")

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

from db import (
    get_overdue_ack_complaints,
    get_overdue_resolution_complaints,
    update_complaint_status,
    create_escalation,
    add_message,
    get_patient_chat_id_for_complaint,
)
from notifier import notify_escalated

logger = logging.getLogger(__name__)


def check_ack_sla():
    """Flag complaints whose acknowledgment window has expired."""
    overdue = get_overdue_ack_complaints()
    for c in overdue:
        logger.info("ACK SLA breach: %s (officer: %s)", c["complaint_code"], c.get("officer_name"))
        # Mark as escalated
        update_complaint_status(c["id"], "escalated")
        create_escalation(
            complaint_id=c["id"],
            from_officer_id=c.get("assigned_officer_id"),
            to_role="superadmin",
            reason="ack_sla_breach",
        )
        add_message(
            complaint_id=c["id"],
            sender_type="system",
            text=(
                f"Acknowledgment SLA breached. Complaint escalated to superadmin. "
                f"Officer: {c.get('officer_name', 'unassigned')}."
            ),
        )
        chat_id = get_patient_chat_id_for_complaint(c["id"])
        if chat_id:
            notify_escalated(chat_id, c["complaint_code"])


def check_resolution_sla():
    """Auto-escalate complaints whose resolution window has expired."""
    overdue = get_overdue_resolution_complaints()
    for c in overdue:
        logger.info(
            "RESOLUTION SLA breach: %s (officer: %s)", c["complaint_code"], c.get("officer_name")
        )
        update_complaint_status(c["id"], "escalated")
        create_escalation(
            complaint_id=c["id"],
            from_officer_id=c.get("assigned_officer_id"),
            to_role="superadmin",
            reason="resolution_sla_breach",
        )
        add_message(
            complaint_id=c["id"],
            sender_type="system",
            text=(
                f"Resolution SLA breached. Complaint auto-escalated to superadmin. "
                f"Officer: {c.get('officer_name', 'unassigned')}."
            ),
        )
        chat_id = get_patient_chat_id_for_complaint(c["id"])
        if chat_id:
            notify_escalated(chat_id, c["complaint_code"])


def run_scheduler():
    scheduler = BlockingScheduler()
    # Check every minute — fine-grained enough for 15-minute critical SLA
    scheduler.add_job(check_ack_sla, IntervalTrigger(minutes=1), id="ack_sla_check")
    scheduler.add_job(check_resolution_sla, IntervalTrigger(minutes=1), id="res_sla_check")

    logger.info("SLA scheduler started.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped.")


if __name__ == "__main__":
    logging.basicConfig(
        format="%(asctime)s - %(levelname)s - %(message)s", level=logging.INFO
    )
    run_scheduler()
