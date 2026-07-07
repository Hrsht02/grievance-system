"""
db.py — thin database helper.

All SQL goes through the functions here so the bot, scheduler, and API
never import psycopg2 directly. Pass DATABASE_URL in the environment.
"""

import os
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

DATABASE_URL = os.environ.get("DATABASE_URL", "")


def _connect():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


@contextmanager
def get_db():
    """Yield a connection that auto-commits on success, rolls back on error."""
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

def get_patient_by_token(token: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.*, h.name AS hospital_name, h.district,
                       d.name AS department_name
                FROM patients p
                JOIN hospitals h ON h.id = p.hospital_id
                LEFT JOIN departments d ON d.id = p.department_id
                WHERE p.patient_token = %s
                """,
                (token,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def update_patient_chat_id(patient_id: str, chat_id: int):
    """Store the patient's Telegram chat_id so we can push notifications to them."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE patients SET telegram_chat_id = %s WHERE id = %s",
                (chat_id, patient_id),
            )


def get_patient_chat_id_for_complaint(complaint_id: str) -> int | None:
    """Return the Telegram chat_id of the patient who filed this complaint."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.telegram_chat_id
                FROM complaints c
                JOIN patients p ON p.id = c.patient_id
                WHERE c.id = %s
                """,
                (complaint_id,),
            )
            row = cur.fetchone()
            return row["telegram_chat_id"] if row else None


def get_patient_departments(patient_id: str) -> list[dict]:
    """All departments a patient has visited (via their complaints)."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT d.id, d.name
                FROM complaints c
                JOIN departments d ON d.id = c.department_id
                WHERE c.patient_id = %s AND c.department_id IS NOT NULL
                """,
                (patient_id,),
            )
            return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Complaint tags
# ---------------------------------------------------------------------------

def get_approved_tags() -> list[str]:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT tag FROM complaint_tags WHERE status = 'approved' ORDER BY tag"
            )
            return [r["tag"] for r in cur.fetchall()]


def ensure_tag_exists(tag: str, is_new: bool):
    """Insert a new proposed tag if it doesn't exist yet."""
    if not is_new:
        return
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO complaint_tags (tag, status)
                VALUES (%s, 'pending_review')
                ON CONFLICT (tag) DO NOTHING
                """,
                (tag,),
            )


# ---------------------------------------------------------------------------
# Complaints
# ---------------------------------------------------------------------------

def generate_complaint_code(hospital_name: str) -> str:
    """
    Generate a human-readable code like BH-AIIMSPAT-20260705-0042.
    Uses the DB sequence to get the serial part.
    """
    import datetime, re
    today = datetime.date.today().strftime("%Y%m%d")
    slug = re.sub(r"[^A-Z0-9]", "", hospital_name.upper())[:8]
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS cnt FROM complaints
                WHERE complaint_code LIKE %s
                """,
                (f"BH-{slug}-{today}-%",),
            )
            row = cur.fetchone()
            serial = (row["cnt"] or 0) + 1
    return f"BH-{slug}-{today}-{serial:04d}"


def _safe_category(category: str, conn) -> str:
    """Return category if it exists as an approved tag, else 'other'."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM complaint_tags WHERE tag = %s AND status = 'approved'",
            (category,),
        )
        return category if cur.fetchone() else "other"


def create_complaint(
    patient_id: str,
    hospital_id: str,
    department_id: str | None,
    raw_text: str,
    raw_audio_url: str | None,
    classification: dict,
    complaint_code: str,
    is_anonymous: bool,
    assigned_officer_id: str | None,
    ack_deadline,
    resolution_deadline,
) -> dict:
    with get_db() as conn:
        # Ensure the AI-assigned category actually exists; fall back to 'other'
        raw_category = classification.get("category", "other") or "other"
        safe_cat = _safe_category(raw_category, conn)

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO complaints (
                    complaint_code, patient_id, hospital_id, department_id,
                    raw_text, raw_audio_url,
                    category, is_new_category, classification_confidence,
                    sentiment, urgency, summary_en, summary_hi,
                    is_anonymous, assigned_officer_id,
                    ack_sla_deadline, resolution_sla_deadline, status
                ) VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'new'
                )
                RETURNING *
                """,
                (
                    complaint_code,
                    patient_id,
                    hospital_id,
                    department_id,
                    raw_text,
                    raw_audio_url,
                    safe_cat,
                    classification.get("is_new_category", False),
                    classification.get("confidence"),
                    classification.get("sentiment", "neutral"),
                    classification.get("urgency", "high"),
                    classification.get("summary_en", raw_text[:120]),
                    classification.get("summary_hi", raw_text[:120]),
                    is_anonymous,
                    assigned_officer_id,
                    ack_deadline,
                    resolution_deadline,
                ),
            )
            row = cur.fetchone()
            return dict(row)


def get_complaint_by_code(code: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, p.name AS patient_name, h.name AS hospital_name,
                       d.name AS department_name
                FROM complaints c
                JOIN patients p ON p.id = c.patient_id
                JOIN hospitals h ON h.id = c.hospital_id
                LEFT JOIN departments d ON d.id = c.department_id
                WHERE c.complaint_code = %s
                """,
                (code,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def update_complaint_status(complaint_id: str, status: str, **extra_fields):
    allowed = {
        "acknowledged_at", "resolved_at", "patient_confirmed_resolved",
        "assigned_officer_id",
    }
    set_parts = ["status = %s"]
    values = [status]
    for k, v in extra_fields.items():
        if k in allowed:
            set_parts.append(f"{k} = %s")
            values.append(v)
    values.append(complaint_id)
    sql = f"UPDATE complaints SET {', '.join(set_parts)} WHERE id = %s"
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, values)


# ---------------------------------------------------------------------------
# Complaint messages (audit trail)
# ---------------------------------------------------------------------------

def add_message(complaint_id: str, sender_type: str, text: str, sender_id: str | None = None):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO complaint_messages (complaint_id, sender_type, sender_id, message_text)
                VALUES (%s, %s, %s, %s)
                """,
                (complaint_id, sender_type, sender_id, text),
            )


# ---------------------------------------------------------------------------
# Officers
# ---------------------------------------------------------------------------

def get_officer_for_hospital(hospital_id: str) -> dict | None:
    """Find the active officer assigned to the hospital's district."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.* FROM officers o
                JOIN hospitals h ON h.district = o.assigned_district
                WHERE h.id = %s AND o.is_active = true AND o.role = 'officer'
                LIMIT 1
                """,
                (hospital_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def get_officer_by_id(officer_id: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM officers WHERE id = %s", (officer_id,))
            row = cur.fetchone()
            return dict(row) if row else None


# ---------------------------------------------------------------------------
# Escalations
# ---------------------------------------------------------------------------

def create_escalation(complaint_id: str, from_officer_id: str | None, to_role: str, reason: str):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO escalations (complaint_id, escalated_from_officer_id, escalated_to_role, reason)
                VALUES (%s, %s, %s, %s)
                """,
                (complaint_id, from_officer_id, to_role, reason),
            )


# ---------------------------------------------------------------------------
# SLA scheduler helpers
# ---------------------------------------------------------------------------

def get_overdue_ack_complaints():
    """Complaints past their acknowledgment SLA, still unacknowledged."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, p.name AS patient_name, h.name AS hospital_name,
                       o.email AS officer_email, o.name AS officer_name
                FROM complaints c
                JOIN patients p ON p.id = c.patient_id
                JOIN hospitals h ON h.id = c.hospital_id
                LEFT JOIN officers o ON o.id = c.assigned_officer_id
                WHERE c.status = 'new'
                  AND c.ack_sla_deadline < now()
                """
            )
            return [dict(r) for r in cur.fetchall()]


def get_overdue_resolution_complaints():
    """Complaints past their resolution SLA, still acknowledged but unresolved."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, p.name AS patient_name, h.name AS hospital_name,
                       o.email AS officer_email, o.name AS officer_name,
                       o.id AS officer_id_val
                FROM complaints c
                JOIN patients p ON p.id = c.patient_id
                JOIN hospitals h ON h.id = c.hospital_id
                LEFT JOIN officers o ON o.id = c.assigned_officer_id
                WHERE c.status = 'acknowledged'
                  AND c.resolution_sla_deadline < now()
                """
            )
            return [dict(r) for r in cur.fetchall()]
