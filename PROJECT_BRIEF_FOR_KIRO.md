# Project Brief: Bihar Govt Hospital Grievance Redressal System (paste this into Kiro)

## What this is

A complaint/grievance system for government hospitals in Bihar (pilot
reference: AIIMS Patna). It replaces the current broken flow — where
patients complain at a hospital helpdesk and nothing happens, with no
accountability — with a system where a patient scans a QR code already
present on their hospital file, sends their complaint in one message
(text or voice, no forms, no login), and it goes DIRECTLY to a
government-appointed grievance officer who does not work for that
hospital. If the officer doesn't act in time, it auto-escalates to a
state-level superadmin, with full detail on both the complaint and the
officer's inaction.

Build this as a working MVP using only free-tier tools and APIs. Use
Telegram as the messaging channel for the demo (free, no approval needed);
structure the bot/messaging layer so it can be swapped for WhatsApp Cloud
API later with minimal changes (channel adapter pattern, not a rewrite).

## Core principle: zero extra steps for the patient

The patient should NEVER see a form, a category list, a menu, or a login
screen. The entire interaction is: scan QR -> bot greets them and confirms
identity (auto-fetched) -> patient types or sends a voice note describing
the problem -> done. Everything else (categorization, routing, severity,
SLA timers) happens invisibly in the backend.

## The QR / identity mechanism

- Each patient gets a QR code (already exists at AIIMS-type hospitals or
  can be added onto the same file/card the hospital already prints).
- The QR encodes a link containing a long random `patient_token` — NOT
  raw personal data (name, mobile, ABHA must never be embedded directly
  in the QR itself, only an opaque token).
- The same QR is reused across visits (persistent per patient, not
  regenerated per visit).
- Scanning opens the messaging bot with the token as the start parameter.
  The bot looks up the token in the database, confirms identity back to
  the patient ("Are you Ramesh Kumar, Cardiology, AIIMS Patna? Yes/No"),
  then asks the patient to just describe their problem — no other fields.
- If the token can't identify which specific visit/department the
  complaint is about (patient has visited multiple departments), ask ONE
  short follow-up (buttons, not typing) to disambiguate — but only if
  genuinely necessary.

## Complaint intake flow

1. Patient sends free text or voice note describing the issue in whatever
   language/dialect they use (Hindi, Bhojpuri, Maithili, English, mixed).
2. If voice: transcribe using a free/open speech-to-text option suited to
   Indian languages (prefer AI4Bharat open models — IndicWhisper /
   IndicConformer — self-hosted, free; generic Whisper as fallback).
   ALWAYS keep the original audio file attached to the complaint record
   regardless of transcription quality.
3. Send the transcript (or original text) to an LLM for classification.
   Use Google Gemini's free tier for this (see
   `backend/ai/classify_complaint.py`, already written — reuse it,
   don't rewrite it from scratch).
4. The classifier returns: category (from an editable tag list stored in
   the DB, not hardcoded; new tags can be proposed and later
   approved/merged by a superadmin), confidence, sentiment, urgency
   (critical/high/normal/low), and a one-line summary in both English and
   Hindi.
5. If classification fails or confidence is low, default the complaint's
   urgency to "high" — never silently downgrade or drop it. Raw text and
   raw audio are always stored untouched regardless of what the
   classifier says.
6. Generate a human-readable complaint code, e.g.
   `BH-AIIMSPAT-20260705-0042` (state-hospital-date-serial), and send it
   back to the patient immediately as confirmation, along with the
   AI-assigned category so they get a chance to say "this is wrong" if
   it's badly mislabeled (this correction signal is optional but valuable
   — include it if it doesn't add a mandatory extra step).

## Roles

### Patient
No account, no login. Identified only via the QR token. Can message the
bot again anytime using the same complaint code to check status, or reply
in the same thread if the officer messages them back. Can optionally mark
a complaint as anonymous (identity hidden from the officer's view, but
still fully traceable by the superadmin for audit purposes).

### Grievance Officer (NOT hospital staff — this is critical)
Officers are government-appointed and assigned by district/region cluster
(e.g. "all government hospitals in Patna district"), not employed by or
embedded within any single hospital. This independence is the whole point
— hospital staff must not be able to pressure or influence the officer
handling complaints about that hospital.

Officer dashboard shows:
- A queue of assigned complaints, each showing the category in bold and
  the one-line summary at the top (well-formatted, most important info
  first), with full raw text/audio available on click.
- A single "Mark Received / Acknowledged" toggle per complaint — this
  immediately notifies the patient via the same chat thread.
- An in-thread real-time chat option to message the patient directly
  (like a normal messaging conversation), used if the officer needs more
  info or wants to explain the resolution.
- A "Mark Resolved" action, which notifies the patient and then triggers
  a follow-up "Was your issue actually resolved? Yes/No" message to the
  patient. If "No," the complaint automatically reopens and escalates
  rather than trusting the officer's own resolved-flag blindly.

### Superadmin (state health department level)
- Sees all officers, all hospitals, all complaints across the system.
- Dashboard: total complaints, pending vs resolved counts, average
  resolution time, complaint volume by category and by hospital, and a
  per-officer performance view (acknowledgment rate, resolution time,
  number of SLA breaches). Keep this visually simple — it will be
  presented to a non-technical government official.
- Can create new officer accounts (name, email, auto-generated or
  reset-able password), deactivate/terminate officer accounts, and
  reassign a hospital/district cluster to a different officer.
- Sees every SLA-breach escalation with full context: the original
  complaint, the patient's detail, and the responsible officer's identity
  and prior breach history (so patterns of neglect are visible, not just
  one-off incidents).

## SLA / escalation logic

Two separate clocks, tracked independently:

1. **Acknowledgment SLA**: officer must mark a complaint as
   "acknowledged" within 30 minutes of it being filed (15 minutes for
   complaints classified as "critical" urgency). If missed, immediately
   flag it to the superadmin dashboard as an acknowledgment breach — do
   not wait for the resolution clock to also fail.
2. **Resolution SLA**: officer must resolve within 48 hours of
   acknowledgment (4 hours for "critical" urgency complaints). If missed,
   auto-escalate to the superadmin with: the full complaint, the
   patient's detail, and the officer's identity + their prior SLA-breach
   record.
3. Design the escalation chain as configurable, not hardcoded to just two
   tiers — government may later want additional tiers (e.g. district
   health authority above the superadmin). Model this as an ordered list
   of roles per hospital/district, not a fixed two-step jump.
4. If a patient responds "No" to "was this actually resolved," treat that
   as an automatic reopen + escalation event too, logged the same way as
   an SLA breach.

## Data model

Use `database/schema.sql` (already included in this project) as the
starting schema: hospitals, departments, patients, complaint_tags (soft,
editable taxonomy), officers, complaints, complaint_messages (full
thread/audit trail), and escalations (full escalation history per
complaint). Extend as needed but keep raw complaint text/audio and the
audit trail intact no matter what changes.

## Tech stack (free tier only, for MVP)

- Bot/messaging: Telegram Bot API now, WhatsApp Cloud API later
  (structure as a swappable channel adapter).
- Backend: Node.js or Python (your choice), hosted free (Render/Railway
  free tier).
- Database: Supabase free tier (Postgres + auth + realtime, useful for
  live-updating the officer dashboard without extra infra).
- AI classification: Google Gemini free tier — reuse
  `backend/ai/classify_complaint.py` as-is, wire it into the intake flow.
- Speech-to-text: AI4Bharat open models (self-hosted, free) or open-source
  Whisper as fallback for Indian language/dialect voice notes.
- QR generation: any open-source QR code library.
- Officer/superadmin dashboard: a simple React app, hosted free (Vercel).
- Scheduled SLA-checking jobs: cron job or a free-tier task queue
  (e.g. Upstash) that periodically checks for ack/resolution SLA breaches
  and fires escalation events.

## Things to keep in mind while building

- DPDP Act 2023 (India's data protection law) applies — this handles
  sensitive personal and health data (ABHA numbers, complaint content).
  Capture explicit consent in the flow and avoid storing more than
  necessary. Don't over-engineer this for the MVP, but don't ignore it
  either — a basic consent message and reasonable data minimization is
  enough for a pilot.
- Frame this as complementary to, not a replacement for, Bihar's existing
  Right to Public Grievance Redressal Act framework and the national
  CPGRAMS system — this system is a faster, hospital-specific feeder into
  that larger accountability structure, not a parallel or competing one.
  This framing matters for the government pitch.
- Add basic abuse/spam protection on the intake (e.g. rate-limit
  complaints per token/mobile number) so the officer queue isn't flooded.
- Keep the officer and superadmin dashboards visually simple and
  information-dense at the top (category + summary first, details on
  click) — this will be demoed to non-technical government stakeholders.

## What to build first (suggested order)

1. Database schema (use the provided `schema.sql`, adjust as needed).
2. Telegram bot: QR-token identity resolution -> complaint intake (text +
   voice) -> STT -> AI classification (reuse the provided
   `classify_complaint.py` logic) -> store complaint -> confirm to
   patient with complaint code.
3. Officer dashboard: queue view, acknowledge toggle, resolve action,
   in-thread chat back to patient.
4. SLA scheduler: background job checking ack/resolution deadlines,
   firing escalation events and superadmin notifications.
5. Superadmin dashboard: officer management, cross-hospital analytics,
   escalation view.
6. QR code generation utility for onboarding new patients/hospitals.

Build incrementally and keep each piece testable on its own before wiring
the whole flow end to end.
