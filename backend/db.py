"""
db.py — Database helper using Supabase REST API.

Uses the Supabase PostgREST endpoint so no direct TCP connection to Postgres
is needed — works on any network, no IPv6 required.

For complex queries (JOINs, CTEs) we fall back to Supabase's /rpc endpoint
or compose the queries using PostgREST's embedded resource syntax.
"""

import os
import json
import logging
import urllib.request
import urllib.parse
import urllib.error
from contextlib import contextmanager

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

_headers = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def _request(method: str, path: str, body=None, extra_headers: dict | None = None) -> list | dict:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {**_headers}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else []
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        logger.error("Supabase %s %s → %s: %s", method, path, e.code, body_text)
        raise RuntimeError(f"Supabase error {e.code}: {body_text}") from e


def _rpc(func_name: str, params: dict) -> list | dict:
    """Call a Postgres function via RPC."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{func_name}"
    data = json.dumps(params).encode()
    req = urllib.request.Request(url, data=data, headers=_headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# psycopg2 direct connection — used only if SUPABASE_URL not set
# ---------------------------------------------------------------------------

def _psycopg2_available() -> bool:
    try:
        import psycopg2
        return bool(DATABASE_URL)
    except ImportError:
        return False


@contextmanager
def get_db():
    """Stub kept for compatibility — raises clearly if called."""
    raise RuntimeError(
        "get_db() is disabled. All DB access uses Supabase REST API. "
        "Use db._request() or the helper functions instead."
    )
    yield  # make it a generator


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

def get_patient_by_token(token: str) -> dict | None:
    rows = _request("GET", f"patients?patient_token=eq.{urllib.parse.quote(token)}"
                    "&select=*,hospitals(name,district),departments(name)&limit=1")
    if not rows:
        return None
    r = rows[0]
    hosp = r.pop("hospitals", {}) or {}
    dept = r.pop("departments", {}) or {}
    r["hospital_name"] = hosp.get("name", "")
    r["district"] = hosp.get("district", "")
    r["department_name"] = dept.get("name", "")
    return r


def update_patient_chat_id(patient_id: str, chat_id: int):
    _request("PATCH", f"patients?id=eq.{patient_id}",
             body={"telegram_chat_id": chat_id})


def get_patient_chat_id_for_complaint(complaint_id: str) -> int | None:
    rows = _request("GET",
        f"complaints?id=eq.{complaint_id}&select=patients(telegram_chat_id)&limit=1")
    if not rows:
        return None
    patient = rows[0].get("patients") or {}
    return patient.get("telegram_chat_id")


def get_patient_departments(patient_id: str) -> list[dict]:
    rows = _request("GET",
        f"complaints?patient_id=eq.{patient_id}"
        "&department_id=not.is.null&select=departments(id,name)")
    seen, result = set(), []
    for r in rows:
        d = r.get("departments") or {}
        if d.get("id") and d["id"] not in seen:
            seen.add(d["id"])
            result.append(d)
    return result


# ---------------------------------------------------------------------------
# Complaint tags
# ---------------------------------------------------------------------------

def get_approved_tags() -> list[str]:
    rows = _request("GET", "complaint_tags?status=eq.approved&select=tag&order=tag")
    return [r["tag"] for r in rows]


def ensure_tag_exists(tag: str, is_new: bool):
    if not is_new:
        return
    try:
        _request("POST", "complaint_tags",
                 body={"tag": tag, "status": "pending_review"},
                 extra_headers={"Prefer": "resolution=ignore-duplicates,return=minimal"})
    except Exception:
        pass  # already exists — ignore


# ---------------------------------------------------------------------------
# Complaints
# ---------------------------------------------------------------------------

def generate_complaint_code(hospital_name: str) -> str:
    import datetime, re
    today = datetime.date.today().strftime("%Y%m%d")
    slug = re.sub(r"[^A-Z0-9]", "", hospital_name.upper())[:8]
    prefix = f"BH-{slug}-{today}-"
    rows = _request("GET",
        f"complaints?complaint_code=like.{urllib.parse.quote(prefix + '%')}"
        "&select=complaint_code")
    serial = len(rows) + 1
    return f"{prefix}{serial:04d}"


def _safe_category_rest(category: str) -> str:
    rows = _request("GET",
        f"complaint_tags?tag=eq.{urllib.parse.quote(category)}&status=eq.approved&select=tag&limit=1")
    return category if rows else "other"


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
    safe_cat = _safe_category_rest(classification.get("category", "other") or "other")

    def _fmt(dt):
        if dt is None:
            return None
        if hasattr(dt, "isoformat"):
            return dt.isoformat()
        return str(dt)

    body = {
        "complaint_code": complaint_code,
        "patient_id": patient_id,
        "hospital_id": hospital_id,
        "department_id": department_id,
        "raw_text": raw_text,
        "raw_audio_url": raw_audio_url,
        "category": safe_cat,
        "is_new_category": classification.get("is_new_category", False),
        "classification_confidence": classification.get("confidence"),
        "sentiment": classification.get("sentiment", "neutral"),
        "urgency": classification.get("urgency", "high"),
        "summary_en": classification.get("summary_en", raw_text[:120]),
        "summary_hi": classification.get("summary_hi", raw_text[:120]),
        "is_anonymous": is_anonymous,
        "assigned_officer_id": assigned_officer_id,
        "ack_sla_deadline": _fmt(ack_deadline),
        "resolution_sla_deadline": _fmt(resolution_deadline),
        "status": "new",
    }
    rows = _request("POST", "complaints", body=body)
    return rows[0] if isinstance(rows, list) else rows


def get_complaint_by_code(code: str) -> dict | None:
    rows = _request("GET",
        f"complaints?complaint_code=eq.{urllib.parse.quote(code)}"
        "&select=*,patients(name),hospitals(name),departments(name)&limit=1")
    if not rows:
        return None
    r = rows[0]
    r["patient_name"] = (r.pop("patients", {}) or {}).get("name", "")
    r["hospital_name"] = (r.pop("hospitals", {}) or {}).get("name", "")
    r["department_name"] = (r.pop("departments", {}) or {}).get("name", "")
    return r


def update_complaint_status(complaint_id: str, status: str, **extra_fields):
    allowed = {"acknowledged_at", "resolved_at", "patient_confirmed_resolved", "assigned_officer_id"}
    body = {"status": status}
    for k, v in extra_fields.items():
        if k in allowed:
            body[k] = v.isoformat() if hasattr(v, "isoformat") else v
    _request("PATCH", f"complaints?id=eq.{complaint_id}", body=body,
             extra_headers={"Prefer": "return=minimal"})


# ---------------------------------------------------------------------------
# Complaint messages
# ---------------------------------------------------------------------------

def add_message(complaint_id: str, sender_type: str, text: str, sender_id: str | None = None):
    body = {
        "complaint_id": complaint_id,
        "sender_type": sender_type,
        "sender_id": sender_id,
        "message_text": text,
    }
    _request("POST", "complaint_messages", body=body,
             extra_headers={"Prefer": "return=minimal"})


# ---------------------------------------------------------------------------
# Officers
# ---------------------------------------------------------------------------

def get_officer_for_hospital(hospital_id: str) -> dict | None:
    # Get district for this hospital
    hosp_rows = _request("GET", f"hospitals?id=eq.{hospital_id}&select=district&limit=1")
    if not hosp_rows:
        return None
    district = hosp_rows[0]["district"]
    # Find active officer for that district
    rows = _request("GET",
        f"officers?assigned_district=eq.{urllib.parse.quote(district)}"
        "&is_active=eq.true&role=eq.officer&select=*&limit=1")
    return rows[0] if rows else None


def get_officer_by_id(officer_id: str) -> dict | None:
    rows = _request("GET", f"officers?id=eq.{officer_id}&select=*&limit=1")
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Escalations
# ---------------------------------------------------------------------------

def create_escalation(complaint_id: str, from_officer_id: str | None, to_role: str, reason: str):
    body = {
        "complaint_id": complaint_id,
        "escalated_from_officer_id": from_officer_id,
        "escalated_to_role": to_role,
        "reason": reason,
    }
    _request("POST", "escalations", body=body,
             extra_headers={"Prefer": "return=minimal"})


# ---------------------------------------------------------------------------
# API helpers — used by api/main.py for dashboard queries
# ---------------------------------------------------------------------------

def get_officer_complaints(officer_id: str, status_filter: str | None = None) -> list[dict]:
    qs = (f"complaints?assigned_officer_id=eq.{officer_id}"
          "&select=id,complaint_code,status,urgency,category,summary_en,summary_hi,"
          "created_at,ack_sla_deadline,resolution_sla_deadline,acknowledged_at,is_anonymous,"
          "patients(name),hospitals(name),departments(name)"
          "&order=created_at.asc")
    if status_filter:
        qs += f"&status=eq.{status_filter}"
    rows = _request("GET", qs)
    result = []
    for r in rows:
        r["patient_name"] = ("Anonymous" if r.get("is_anonymous")
                             else (r.pop("patients", {}) or {}).get("name", ""))
        r["hospital_name"] = (r.pop("hospitals", {}) or {}).get("name", "")
        r["department_name"] = (r.pop("departments", {}) or {}).get("name", "")
        result.append(r)
    return result


def get_complaint_detail_for_officer(complaint_id: str, officer_id: str) -> dict | None:
    rows = _request("GET",
        f"complaints?id=eq.{complaint_id}&assigned_officer_id=eq.{officer_id}"
        "&select=*,patients(name,mobile_number),hospitals(name),departments(name)&limit=1")
    if not rows:
        return None
    r = rows[0]
    is_anon = r.get("is_anonymous", False)
    pat = r.pop("patients", {}) or {}
    r["patient_name"] = "Anonymous" if is_anon else pat.get("name", "")
    r["patient_mobile"] = None if is_anon else pat.get("mobile_number", "")
    r["hospital_name"] = (r.pop("hospitals", {}) or {}).get("name", "")
    r["department_name"] = (r.pop("departments", {}) or {}).get("name", "")
    return r


def get_complaint_messages(complaint_id: str) -> list[dict]:
    return _request("GET",
        f"complaint_messages?complaint_id=eq.{complaint_id}&select=*&order=created_at.asc")


def get_admin_stats() -> dict:
    complaints = _request("GET", "complaints?select=status,urgency,resolved_at,created_at")
    total = len(complaints)
    pending = sum(1 for c in complaints if c["status"] in ("new","acknowledged","reopened","escalated"))
    resolved = sum(1 for c in complaints if c["status"] == "resolved")
    res_times = []
    for c in complaints:
        if c["status"] == "resolved" and c.get("resolved_at") and c.get("created_at"):
            try:
                from datetime import datetime
                fmt = "%Y-%m-%dT%H:%M:%S"
                t1 = datetime.fromisoformat(c["created_at"].replace("Z",""))
                t2 = datetime.fromisoformat(c["resolved_at"].replace("Z",""))
                res_times.append((t2 - t1).total_seconds() / 3600)
            except Exception:
                pass
    avg_hrs = round(sum(res_times) / len(res_times), 1) if res_times else None

    # By category
    cat_counts: dict = {}
    for c in complaints:
        cat = c.get("category") or "uncategorized"
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
    by_category = [{"category": k, "count": v}
                   for k, v in sorted(cat_counts.items(), key=lambda x: -x[1])]

    # By hospital
    hosp_rows = _request("GET",
        "complaints?select=hospitals(name)")
    hosp_counts: dict = {}
    for r in hosp_rows:
        name = (r.get("hospitals") or {}).get("name", "Unknown")
        hosp_counts[name] = hosp_counts.get(name, 0) + 1
    by_hospital = [{"hospital": k, "count": v}
                   for k, v in sorted(hosp_counts.items(), key=lambda x: -x[1])]

    return {
        "totals": {"total": total, "pending": pending, "resolved": resolved,
                   "avg_resolution_hours": avg_hrs},
        "by_category": by_category,
        "by_hospital": by_hospital,
    }


def get_admin_officers_stats() -> list[dict]:
    officers = _request("GET",
        "officers?role=eq.officer&select=id,name,email,assigned_district,is_active,created_at")
    result = []
    for o in officers:
        oid = o["id"]
        complaints = _request("GET",
            f"complaints?assigned_officer_id=eq.{oid}&select=id,status,acknowledged_at")
        escalations = _request("GET",
            f"escalations?escalated_from_officer_id=eq.{oid}&select=id")
        o["total_complaints"] = len(complaints)
        o["acked"] = sum(1 for c in complaints if c.get("acknowledged_at"))
        o["resolved"] = sum(1 for c in complaints if c.get("status") == "resolved")
        o["sla_breaches"] = len(escalations)
        result.append(o)
    return result


def get_admin_escalations() -> list[dict]:
    rows = _request("GET",
        "escalations?select=*,"
        "complaints(complaint_code,urgency,category,summary_en,raw_text,status,is_anonymous,"
        "patients(name),hospitals(name)),"
        "officers(name,email)"
        "&order=created_at.desc")
    result = []
    for r in rows:
        c = r.pop("complaints", {}) or {}
        o = r.pop("officers", {}) or {}
        pat = c.pop("patients", {}) or {}
        hosp = c.pop("hospitals", {}) or {}
        is_anon = c.get("is_anonymous", False)

        # Count total breaches for this officer
        breaches = 0
        if o.get("id") or r.get("escalated_from_officer_id"):
            oid = r.get("escalated_from_officer_id")
            if oid:
                b = _request("GET", f"escalations?escalated_from_officer_id=eq.{oid}&select=id")
                breaches = len(b)

        r.update({
            "complaint_code": c.get("complaint_code"),
            "urgency": c.get("urgency"),
            "category": c.get("category"),
            "summary_en": c.get("summary_en"),
            "raw_text": c.get("raw_text"),
            "complaint_status": c.get("status"),
            "patient_name": "Anonymous" if is_anon else pat.get("name", ""),
            "hospital_name": hosp.get("name", ""),
            "officer_name": o.get("name"),
            "officer_email": o.get("email"),
            "officer_total_breaches": breaches,
        })
        result.append(r)
    return result


def get_admin_complaints(status_filter: str | None = None, hospital_id: str | None = None) -> list[dict]:
    qs = ("complaints?select=id,complaint_code,status,urgency,category,summary_en,"
          "created_at,ack_sla_deadline,resolution_sla_deadline,is_anonymous,"
          "patients(name),hospitals(id,name),officers(name)&order=created_at.desc&limit=500")
    if status_filter:
        qs += f"&status=eq.{status_filter}"
    if hospital_id:
        qs += f"&hospital_id=eq.{hospital_id}"
    rows = _request("GET", qs)
    result = []
    for r in rows:
        is_anon = r.get("is_anonymous", False)
        r["patient_name"] = "Anonymous" if is_anon else (r.pop("patients", {}) or {}).get("name", "")
        hosp = r.pop("hospitals", {}) or {}
        r["hospital_name"] = hosp.get("name", "")
        r["officer_name"] = (r.pop("officers", {}) or {}).get("name", "")
        result.append(r)
    return result


def get_pending_tags() -> list[dict]:
    return _request("GET", "complaint_tags?status=eq.pending_review&select=*&order=created_at")


def review_tag(tag: str, action: str, merge_into: str | None = None):
    if action == "approve":
        _request("PATCH", f"complaint_tags?tag=eq.{urllib.parse.quote(tag)}",
                 body={"status": "approved"}, extra_headers={"Prefer": "return=minimal"})
    elif action == "merge" and merge_into:
        _request("PATCH", f"complaint_tags?tag=eq.{urllib.parse.quote(tag)}",
                 body={"status": "merged", "merged_into": merge_into},
                 extra_headers={"Prefer": "return=minimal"})
        _request("PATCH", f"complaints?category=eq.{urllib.parse.quote(tag)}",
                 body={"category": merge_into}, extra_headers={"Prefer": "return=minimal"})


# ---------------------------------------------------------------------------
# SLA scheduler helpers
# ---------------------------------------------------------------------------

def get_overdue_ack_complaints() -> list[dict]:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    rows = _request("GET",
        f"complaints?status=eq.new&ack_sla_deadline=lt.{urllib.parse.quote(now)}"
        "&select=*,patients(name),hospitals(name),officers(name,email)")
    result = []
    for r in rows:
        r["patient_name"] = (r.pop("patients", {}) or {}).get("name", "")
        r["hospital_name"] = (r.pop("hospitals", {}) or {}).get("name", "")
        o = r.pop("officers", {}) or {}
        r["officer_name"] = o.get("name", "")
        r["officer_email"] = o.get("email", "")
        result.append(r)
    return result


def get_overdue_resolution_complaints() -> list[dict]:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    rows = _request("GET",
        f"complaints?status=eq.acknowledged&resolution_sla_deadline=lt.{urllib.parse.quote(now)}"
        "&select=*,patients(name),hospitals(name),officers(id,name,email)")
    result = []
    for r in rows:
        r["patient_name"] = (r.pop("patients", {}) or {}).get("name", "")
        r["hospital_name"] = (r.pop("hospitals", {}) or {}).get("name", "")
        o = r.pop("officers", {}) or {}
        r["officer_name"] = o.get("name", "")
        r["officer_email"] = o.get("email", "")
        r["officer_id_val"] = o.get("id", "")
        result.append(r)
    return result
