"""
api/main.py — FastAPI backend for the officer and superadmin dashboards.

Auth: JWT tokens (email + password). Officers get role='officer',
superadmins get role='superadmin'. All routes are protected; superadmin
routes reject officer tokens.

Run with: uvicorn api.main:app --reload
"""

import os
import datetime
import logging
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / "config" / ".env")

import psycopg2.extras
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import db
from notifier import (
    notify_complaint_acknowledged,
    notify_complaint_resolved,
    notify_officer_message,
)

logger = logging.getLogger(__name__)

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8  # 8-hour sessions

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

app = FastAPI(title="Grievance System API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to dashboard domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_access_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.datetime.utcnow() + datetime.timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_officer(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        officer_id: str = payload.get("sub")
        if not officer_id:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    officer = db.get_officer_by_id(officer_id)
    if not officer or not officer["is_active"]:
        raise credentials_exc
    return officer


def require_superadmin(officer: dict = Depends(get_current_officer)) -> dict:
    if officer["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required.")
    return officer


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.post("/auth/token")
def login(form: OAuth2PasswordRequestForm = Depends()):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM officers WHERE email = %s AND is_active = true",
                (form.username,),
            )
            row = cur.fetchone()

    if not row or not verify_password(form.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    token = create_access_token({"sub": str(row["id"]), "role": row["role"]})
    return {"access_token": token, "token_type": "bearer", "role": row["role"]}


# ---------------------------------------------------------------------------
# Officer: complaint queue
# ---------------------------------------------------------------------------

@app.get("/officer/complaints")
def list_officer_complaints(
    status_filter: str | None = None,
    officer: dict = Depends(get_current_officer),
):
    """Return complaints assigned to the current officer."""
    with db.get_db() as conn:
        with conn.cursor() as cur:
            query = """
                SELECT c.id, c.complaint_code, c.status, c.urgency, c.category,
                       c.summary_en, c.summary_hi, c.created_at,
                       c.ack_sla_deadline, c.resolution_sla_deadline,
                       c.acknowledged_at, c.is_anonymous,
                       CASE WHEN c.is_anonymous THEN 'Anonymous' ELSE p.name END AS patient_name,
                       h.name AS hospital_name, d.name AS department_name
                FROM complaints c
                JOIN patients p ON p.id = c.patient_id
                JOIN hospitals h ON h.id = c.hospital_id
                LEFT JOIN departments d ON d.id = c.department_id
                WHERE c.assigned_officer_id = %s
            """
            params = [officer["id"]]
            if status_filter:
                query += " AND c.status = %s"
                params.append(status_filter)
            query += " ORDER BY c.urgency DESC, c.created_at ASC"
            cur.execute(query, params)
            return [dict(r) for r in cur.fetchall()]


@app.get("/officer/complaints/{complaint_id}")
def get_complaint_detail(
    complaint_id: str,
    officer: dict = Depends(get_current_officer),
):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*,
                       CASE WHEN c.is_anonymous THEN 'Anonymous' ELSE p.name END AS patient_name,
                       CASE WHEN c.is_anonymous THEN NULL ELSE p.mobile_number END AS patient_mobile,
                       h.name AS hospital_name, d.name AS department_name
                FROM complaints c
                JOIN patients p ON p.id = c.patient_id
                JOIN hospitals h ON h.id = c.hospital_id
                LEFT JOIN departments d ON d.id = c.department_id
                WHERE c.id = %s AND c.assigned_officer_id = %s
                """,
                (complaint_id, officer["id"]),
            )
            complaint = cur.fetchone()
            if not complaint:
                raise HTTPException(status_code=404, detail="Complaint not found.")

            # Also fetch message thread
            cur.execute(
                """
                SELECT * FROM complaint_messages
                WHERE complaint_id = %s ORDER BY created_at ASC
                """,
                (complaint_id,),
            )
            messages = [dict(r) for r in cur.fetchall()]

    return {"complaint": dict(complaint), "messages": messages}


@app.post("/officer/complaints/{complaint_id}/acknowledge")
def acknowledge_complaint(
    complaint_id: str,
    officer: dict = Depends(get_current_officer),
):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, status, complaint_code FROM complaints WHERE id = %s AND assigned_officer_id = %s",
                (complaint_id, officer["id"]),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Complaint not found.")
    if row["status"] not in ("new", "escalated"):
        raise HTTPException(status_code=400, detail=f"Cannot acknowledge — status is '{row['status']}'.")

    db.update_complaint_status(
        complaint_id, "acknowledged",
        acknowledged_at=datetime.datetime.utcnow(),
    )
    db.add_message(complaint_id, "system", "Complaint acknowledged by officer.")

    # Notify patient on Telegram
    chat_id = db.get_patient_chat_id_for_complaint(complaint_id)
    if chat_id:
        notify_complaint_acknowledged(chat_id, row["complaint_code"])

    return {"ok": True, "message": "Complaint acknowledged. Patient notified."}


@app.post("/officer/complaints/{complaint_id}/resolve")
def resolve_complaint(
    complaint_id: str,
    officer: dict = Depends(get_current_officer),
):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, status, complaint_code FROM complaints WHERE id = %s AND assigned_officer_id = %s",
                (complaint_id, officer["id"]),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Complaint not found.")
    if row["status"] not in ("acknowledged", "reopened"):
        raise HTTPException(status_code=400, detail="Complaint must be acknowledged before resolving.")

    # Mark as "resolved" in DB — patient confirmation will finalize or reopen it
    db.update_complaint_status(
        complaint_id, "resolved",
        resolved_at=datetime.datetime.utcnow(),
    )
    db.add_message(complaint_id, "system", "Officer marked as resolved. Awaiting patient confirmation.")

    # Send "Was your issue resolved? Yes/No" to patient on Telegram
    chat_id = db.get_patient_chat_id_for_complaint(complaint_id)
    if chat_id:
        notify_complaint_resolved(chat_id, row["complaint_code"])

    return {"ok": True, "message": "Resolution recorded. Patient asked to confirm."}


class MessageBody(BaseModel):
    text: str


@app.post("/officer/complaints/{complaint_id}/message")
def send_message_to_patient(
    complaint_id: str,
    body: MessageBody,
    officer: dict = Depends(get_current_officer),
):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, complaint_code FROM complaints WHERE id = %s AND assigned_officer_id = %s",
                (complaint_id, officer["id"]),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Complaint not found.")

    db.add_message(complaint_id, "officer", body.text, sender_id=str(officer["id"]))

    # Forward message to patient on Telegram
    chat_id = db.get_patient_chat_id_for_complaint(complaint_id)
    if chat_id:
        notify_officer_message(chat_id, row["complaint_code"], body.text)

    return {"ok": True}


# ---------------------------------------------------------------------------
# Superadmin: overview
# ---------------------------------------------------------------------------

@app.get("/admin/stats")
def admin_stats(admin: dict = Depends(require_superadmin)):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status IN ('new','acknowledged','reopened','escalated')) AS pending,
                    COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
                    AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600)
                        FILTER (WHERE status='resolved') AS avg_resolution_hours
                FROM complaints
                """
            )
            totals = dict(cur.fetchone())

            cur.execute(
                """
                SELECT category, COUNT(*) AS count
                FROM complaints
                GROUP BY category ORDER BY count DESC
                """
            )
            by_category = [dict(r) for r in cur.fetchall()]

            cur.execute(
                """
                SELECT h.name AS hospital, COUNT(*) AS count
                FROM complaints c JOIN hospitals h ON h.id = c.hospital_id
                GROUP BY h.name ORDER BY count DESC
                """
            )
            by_hospital = [dict(r) for r in cur.fetchall()]

    return {
        "totals": totals,
        "by_category": by_category,
        "by_hospital": by_hospital,
    }


@app.get("/admin/officers")
def list_officers(admin: dict = Depends(require_superadmin)):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.id, o.name, o.email, o.assigned_district, o.is_active, o.created_at,
                    COUNT(c.id) AS total_complaints,
                    COUNT(c.id) FILTER (WHERE c.acknowledged_at IS NOT NULL) AS acked,
                    COUNT(c.id) FILTER (WHERE c.status = 'resolved') AS resolved,
                    COUNT(e.id) AS sla_breaches
                FROM officers o
                LEFT JOIN complaints c ON c.assigned_officer_id = o.id
                LEFT JOIN escalations e ON e.escalated_from_officer_id = o.id
                WHERE o.role = 'officer'
                GROUP BY o.id ORDER BY o.name
                """
            )
            return [dict(r) for r in cur.fetchall()]


class NewOfficerBody(BaseModel):
    name: str
    email: EmailStr
    password: str
    assigned_district: str


@app.post("/admin/officers")
def create_officer(body: NewOfficerBody, admin: dict = Depends(require_superadmin)):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO officers (name, email, password_hash, role, assigned_district)
                VALUES (%s, %s, %s, 'officer', %s)
                RETURNING id
                """,
                (body.name, body.email, hash_password(body.password), body.assigned_district),
            )
            row = cur.fetchone()
    return {"ok": True, "officer_id": str(row["id"])}


@app.patch("/admin/officers/{officer_id}/deactivate")
def deactivate_officer(officer_id: str, admin: dict = Depends(require_superadmin)):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE officers SET is_active = false WHERE id = %s AND role = 'officer'",
                (officer_id,),
            )
    return {"ok": True}


@app.patch("/admin/officers/{officer_id}/reassign")
def reassign_officer(
    officer_id: str,
    body: dict,
    admin: dict = Depends(require_superadmin),
):
    district = body.get("assigned_district")
    if not district:
        raise HTTPException(status_code=400, detail="assigned_district is required.")
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE officers SET assigned_district = %s WHERE id = %s AND role = 'officer'",
                (district, officer_id),
            )
    return {"ok": True}


@app.get("/admin/escalations")
def list_escalations(admin: dict = Depends(require_superadmin)):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.id, e.reason, e.escalated_to_role, e.created_at,
                       c.complaint_code, c.urgency, c.category, c.summary_en,
                       c.raw_text, c.status AS complaint_status,
                       CASE WHEN c.is_anonymous THEN 'Anonymous' ELSE p.name END AS patient_name,
                       h.name AS hospital_name,
                       o.name AS officer_name, o.email AS officer_email,
                       (SELECT COUNT(*) FROM escalations e2 WHERE e2.escalated_from_officer_id = o.id)
                           AS officer_total_breaches
                FROM escalations e
                JOIN complaints c ON c.id = e.complaint_id
                JOIN patients p ON p.id = c.patient_id
                JOIN hospitals h ON h.id = c.hospital_id
                LEFT JOIN officers o ON o.id = e.escalated_from_officer_id
                ORDER BY e.created_at DESC
                """
            )
            return [dict(r) for r in cur.fetchall()]


@app.get("/admin/complaints")
def admin_list_complaints(
    status_filter: str | None = None,
    hospital_id: str | None = None,
    admin: dict = Depends(require_superadmin),
):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            query = """
                SELECT c.id, c.complaint_code, c.status, c.urgency, c.category,
                       c.summary_en, c.created_at, c.ack_sla_deadline, c.resolution_sla_deadline,
                       CASE WHEN c.is_anonymous THEN 'Anonymous' ELSE p.name END AS patient_name,
                       h.name AS hospital_name,
                       o.name AS officer_name
                FROM complaints c
                JOIN patients p ON p.id = c.patient_id
                JOIN hospitals h ON h.id = c.hospital_id
                LEFT JOIN officers o ON o.id = c.assigned_officer_id
                WHERE 1=1
            """
            params = []
            if status_filter:
                query += " AND c.status = %s"
                params.append(status_filter)
            if hospital_id:
                query += " AND c.hospital_id = %s"
                params.append(hospital_id)
            query += " ORDER BY c.created_at DESC LIMIT 500"
            cur.execute(query, params)
            return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Pending tag review (superadmin approves or merges AI-proposed tags)
# ---------------------------------------------------------------------------

@app.get("/admin/tags/pending")
def list_pending_tags(admin: dict = Depends(require_superadmin)):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM complaint_tags WHERE status = 'pending_review' ORDER BY created_at"
            )
            return [dict(r) for r in cur.fetchall()]


class TagActionBody(BaseModel):
    action: str          # "approve" or "merge"
    merge_into: str | None = None


@app.post("/admin/tags/{tag}/review")
def review_tag(tag: str, body: TagActionBody, admin: dict = Depends(require_superadmin)):
    with db.get_db() as conn:
        with conn.cursor() as cur:
            if body.action == "approve":
                cur.execute(
                    "UPDATE complaint_tags SET status = 'approved' WHERE tag = %s", (tag,)
                )
            elif body.action == "merge" and body.merge_into:
                cur.execute(
                    "UPDATE complaint_tags SET status = 'merged', merged_into = %s WHERE tag = %s",
                    (body.merge_into, tag),
                )
                # Reclassify existing complaints using the old tag
                cur.execute(
                    "UPDATE complaints SET category = %s WHERE category = %s",
                    (body.merge_into, tag),
                )
            else:
                raise HTTPException(status_code=400, detail="Invalid action.")
    return {"ok": True}
