# Bihar Govt Hospital Grievance Redressal System (MVP)

A QR-code-based, direct-to-government complaint system for patients.
Pilot: AIIMS Patna. Designed to scale statewide.

---

## Project Structure

```
grievance-system/
├── backend/
│   ├── ai/
│   │   └── classify_complaint.py   # AI classification (Gemini free tier)
│   ├── api/
│   │   └── main.py                 # FastAPI — officer & superadmin REST API
│   ├── bot/
│   │   └── bot.py                  # Telegram bot (complaint intake)
│   ├── qr/
│   │   └── generate_qr.py          # QR code generation utility
│   ├── config/
│   │   └── .env.example            # All required environment variables
│   ├── db.py                       # Database helper (all SQL in one place)
│   ├── stt.py                      # Speech-to-text abstraction layer
│   ├── scheduler.py                # SLA checker (APScheduler background job)
│   └── requirements.txt
├── dashboard/                      # React + TypeScript officer/admin UI
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── OfficerDashboard.tsx
│   │   │   ├── ComplaintDetail.tsx
│   │   │   ├── AdminDashboard.tsx
│   │   │   ├── AdminEscalations.tsx
│   │   │   └── AdminOfficers.tsx
│   │   ├── components/
│   │   │   └── Layout.tsx
│   │   ├── api.ts
│   │   └── App.tsx
│   └── package.json
├── database/
│   └── schema.sql                  # Postgres schema (Supabase-ready)
└── docs/
    └── System_Design.pdf
```

---

## Quick Start

### 1. Database

Run `database/schema.sql` against a Postgres instance (Supabase free tier recommended).

```sql
-- Then insert seed data:
INSERT INTO hospitals (name, district) VALUES ('AIIMS Patna', 'Patna');
-- Add departments, a superadmin officer account, etc.
```

Create a superadmin officer directly in the DB (hashed password):
```python
from passlib.context import CryptContext
print(CryptContext(schemes=["bcrypt"]).hash("your-password"))
```

```sql
INSERT INTO officers (name, email, password_hash, role, assigned_district)
VALUES ('Admin Name', 'admin@example.com', '<bcrypt-hash>', 'superadmin', 'Patna');
```

### 2. Backend

```bash
cd backend
cp config/.env.example config/.env
# Fill in: DATABASE_URL, TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, JWT_SECRET_KEY, TELEGRAM_BOT_USERNAME

pip install -r requirements.txt
```

**Start the API server:**
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

**Start the Telegram bot:**
```bash
python bot/bot.py
```

**Start the SLA scheduler:**
```bash
python scheduler.py
```

### 3. Dashboard

```bash
cd dashboard
npm install
npm run dev       # development
npm run build     # production build (deploy to Vercel)
```

Officers log in at `/officer`, superadmins at `/admin`.

---

## QR Code Generation

```bash
# Single patient
cd backend
python qr/generate_qr.py --token <patient_token> --name "Ramesh Kumar" --hospital "AIIMS Patna" --out qr.png

# Bulk from CSV (columns: patient_token, patient_name, hospital_name)
python qr/generate_qr.py --bulk patients.csv --out-dir ./qr_codes/

# Generate a new random token for a new patient
python -c "from qr.generate_qr import generate_new_token; print(generate_new_token())"
```

---

## System Flow

1. **Patient scans QR** on hospital file → Telegram deep-link opens
2. **Bot confirms identity** ("Are you Ramesh Kumar, Cardiology, AIIMS Patna? Yes/No")
3. **Patient describes problem** — text or voice note, any language
4. **Voice → STT** (AI4Bharat / Whisper); original audio always preserved
5. **AI classifies** complaint → category, urgency, sentiment, summary
6. **Complaint stored**, unique ID generated (e.g. `BH-AIIMSPAT-20260705-0042`)
7. **Patient receives confirmation** with complaint ID and AI category
8. **Officer dashboard** shows complaint; officer acknowledges and resolves
9. **Patient confirms resolution** — if "No", complaint auto-reopens and escalates
10. **SLA breaches** auto-escalate to superadmin with full officer breach history

---

## SLA Timelines

| Stage | Standard | Critical |
|---|---|---|
| Acknowledgment | 30 min | 15 min |
| Resolution | 48 hrs from ack | 4 hrs from ack |

Breach → auto-escalate to superadmin with officer identity + breach history.

---

## Environment Variables

See `backend/config/.env.example` for the full list. Key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username for QR deep-links |
| `GEMINI_API_KEY` | Google Gemini free tier |
| `JWT_SECRET_KEY` | Dashboard auth (generate with `secrets.token_hex(32)`) |
| `STT_ENDPOINT_URL` | Local AI4Bharat / Whisper endpoint (optional) |

---

## Deployment (Free Tier)

| Component | Platform |
|---|---|
| API + Bot + Scheduler | Render / Railway free tier |
| Database | Supabase free tier |
| Dashboard | Vercel |
| Object storage (audio) | Supabase Storage or Cloudflare R2 free tier |
