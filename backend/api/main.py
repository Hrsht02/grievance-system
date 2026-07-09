"""
api/main.py — FastAPI backend for officer and superadmin dashboards.
All DB access goes through db.py REST helpers — no direct psycopg2 needed.
"""

import os
import datetime
import logging
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / "config" / ".env")

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
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

ALLOWED_ORIGINS = [
    "https://grievance-system-virid.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
]

app = FastAPI(title="Grievance System API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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
    payload["exp"] = datetime.datetime.utcnow() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def get_current_officer(token: str = Depends(oauth2_scheme)) -> dict:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid credentials",
                        headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        officer_id: str = payload.get("sub")
        if not officer_id:
            raise exc
    except JWTError:
        raise exc
    officer = db.get_officer_by_id(officer_id)
    if not officer or not officer["is_active"]:
        raise exc
    return officer

def require_superadmin(officer: dict = Depends(get_current_officer)) -> dict:
    if officer["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required.")
    return officer


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.post("/auth/token")
def login(form: OAuth2PasswordRequestForm = Depends()):
    rows = db._request("GET",
        f"officers?email=eq.{urllib.parse.quote(form.username)}&is_active=eq.true&select=*&limit=1")
    if not rows or not verify_password(form.password, rows[0]["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    row = rows[0]
    token = create_access_token({"sub": str(row["id"]), "role": row["role"]})
    return {"access_token": token, "token_type": "bearer", "role": row["role"]}


# ---------------------------------------------------------------------------
# Officer — complaint queue
# ---------------------------------------------------------------------------

@app.get("/officer/complaints")
def list_officer_complaints(status_filter: str | None = None,
                             officer: dict = Depends(get_current_officer)):
    return db.get_officer_complaints(str(officer["id"]), status_filter)


@app.get("/officer/complaints/{complaint_id}")
def get_complaint_detail(complaint_id: str, officer: dict = Depends(get_current_officer)):
    complaint = db.get_complaint_detail_for_officer(complaint_id, str(officer["id"]))
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found.")
    messages = db.get_complaint_messages(complaint_id)
    return {"complaint": complaint, "messages": messages}


@app.post("/officer/complaints/{complaint_id}/acknowledge")
def acknowledge_complaint(complaint_id: str, officer: dict = Depends(get_current_officer)):
    rows = db._request("GET",
        f"complaints?id=eq.{complaint_id}&assigned_officer_id=eq.{officer['id']}"
        "&select=id,status,complaint_code&limit=1")
    if not rows:
        raise HTTPException(status_code=404, detail="Complaint not found.")
    row = rows[0]
    if row["status"] not in ("new", "escalated"):
        raise HTTPException(status_code=400, detail=f"Cannot acknowledge — status is '{row['status']}'.")

    db.update_complaint_status(complaint_id, "acknowledged",
                               acknowledged_at=datetime.datetime.utcnow())
    db.add_message(complaint_id, "system", "Complaint acknowledged by officer.")

    chat_id = db.get_patient_chat_id_for_complaint(complaint_id)
    if chat_id:
        notify_complaint_acknowledged(chat_id, row["complaint_code"])

    return {"ok": True, "message": "Complaint acknowledged. Patient notified."}


@app.post("/officer/complaints/{complaint_id}/resolve")
def resolve_complaint(complaint_id: str, officer: dict = Depends(get_current_officer)):
    rows = db._request("GET",
        f"complaints?id=eq.{complaint_id}&assigned_officer_id=eq.{officer['id']}"
        "&select=id,status,complaint_code&limit=1")
    if not rows:
        raise HTTPException(status_code=404, detail="Complaint not found.")
    row = rows[0]
    if row["status"] not in ("acknowledged", "reopened"):
        raise HTTPException(status_code=400, detail="Complaint must be acknowledged before resolving.")

    db.update_complaint_status(complaint_id, "resolved",
                               resolved_at=datetime.datetime.utcnow())
    db.add_message(complaint_id, "system", "Officer marked as resolved. Awaiting patient confirmation.")

    chat_id = db.get_patient_chat_id_for_complaint(complaint_id)
    if chat_id:
        notify_complaint_resolved(chat_id, row["complaint_code"])

    return {"ok": True, "message": "Resolution recorded. Patient asked to confirm."}


class MessageBody(BaseModel):
    text: str


@app.post("/officer/complaints/{complaint_id}/message")
def send_message_to_patient(complaint_id: str, body: MessageBody,
                             officer: dict = Depends(get_current_officer)):
    rows = db._request("GET",
        f"complaints?id=eq.{complaint_id}&assigned_officer_id=eq.{officer['id']}"
        "&select=id,complaint_code&limit=1")
    if not rows:
        raise HTTPException(status_code=404, detail="Complaint not found.")

    db.add_message(complaint_id, "officer", body.text, sender_id=str(officer["id"]))

    chat_id = db.get_patient_chat_id_for_complaint(complaint_id)
    if chat_id:
        notify_officer_message(chat_id, rows[0]["complaint_code"], body.text)

    return {"ok": True}


# ---------------------------------------------------------------------------
# Superadmin
# ---------------------------------------------------------------------------

@app.get("/admin/stats")
def admin_stats(admin: dict = Depends(require_superadmin)):
    return db.get_admin_stats()

@app.get("/admin/officers")
def list_officers(admin: dict = Depends(require_superadmin)):
    return db.get_admin_officers_stats()

@app.get("/admin/escalations")
def list_escalations(admin: dict = Depends(require_superadmin)):
    return db.get_admin_escalations()

@app.get("/admin/complaints")
def admin_list_complaints(status_filter: str | None = None,
                           hospital_id: str | None = None,
                           admin: dict = Depends(require_superadmin)):
    return db.get_admin_complaints(status_filter, hospital_id)

@app.get("/admin/tags/pending")
def list_pending_tags(admin: dict = Depends(require_superadmin)):
    return db.get_pending_tags()


class NewOfficerBody(BaseModel):
    name: str
    email: EmailStr
    password: str
    assigned_district: str

@app.post("/admin/officers")
def create_officer(body: NewOfficerBody, admin: dict = Depends(require_superadmin)):
    db._request("POST", "officers", body={
        "name": body.name,
        "email": body.email,
        "password_hash": hash_password(body.password),
        "role": "officer",
        "assigned_district": body.assigned_district,
    })
    return {"ok": True}

@app.patch("/admin/officers/{officer_id}/deactivate")
def deactivate_officer(officer_id: str, admin: dict = Depends(require_superadmin)):
    db._request("PATCH", f"officers?id=eq.{officer_id}&role=eq.officer",
                body={"is_active": False},
                extra_headers={"Prefer": "return=minimal"})
    return {"ok": True}

@app.patch("/admin/officers/{officer_id}/reassign")
def reassign_officer(officer_id: str, body: dict,
                      admin: dict = Depends(require_superadmin)):
    district = body.get("assigned_district")
    if not district:
        raise HTTPException(status_code=400, detail="assigned_district is required.")
    db._request("PATCH", f"officers?id=eq.{officer_id}&role=eq.officer",
                body={"assigned_district": district},
                extra_headers={"Prefer": "return=minimal"})
    return {"ok": True}


class TagActionBody(BaseModel):
    action: str
    merge_into: str | None = None

@app.post("/admin/tags/{tag}/review")
def review_tag(tag: str, body: TagActionBody, admin: dict = Depends(require_superadmin)):
    db.review_tag(tag, body.action, body.merge_into)
    return {"ok": True}
