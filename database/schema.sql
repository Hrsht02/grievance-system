-- Starting schema for the grievance system.
-- Designed for Postgres (e.g. Supabase free tier). Adjust types as needed.

-- Hospitals master data
CREATE TABLE hospitals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,               -- e.g. "AIIMS Patna"
    district TEXT NOT NULL,           -- e.g. "Patna"
    state TEXT NOT NULL DEFAULT 'Bihar',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Departments within a hospital
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES hospitals(id),
    name TEXT NOT NULL                -- e.g. "Cardiology"
);

-- Patients. QR code encodes patient_token, not raw personal data.
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_token TEXT UNIQUE NOT NULL,   -- long random string, embedded in QR
    name TEXT NOT NULL,
    mobile_number TEXT NOT NULL,
    abha_number TEXT,
    hospital_id UUID NOT NULL REFERENCES hospitals(id),
    department_id UUID REFERENCES departments(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Soft, editable taxonomy. AI assigns from here; new proposals sit pending.
CREATE TABLE complaint_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag TEXT UNIQUE NOT NULL,             -- e.g. "doctor_absent"
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending_review', 'merged')),
    merged_into TEXT,                     -- if merged, points to the surviving tag
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Grievance officers (government-appointed, NOT hospital staff).
CREATE TABLE officers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'officer' CHECK (role IN ('officer', 'superadmin')),
    assigned_district TEXT,               -- officers are assigned by district/cluster, not hospital
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- The complaint itself.
CREATE TABLE complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_code TEXT UNIQUE NOT NULL,      -- e.g. BH-AIIMSPAT-20260705-0042
    patient_id UUID NOT NULL REFERENCES patients(id),
    hospital_id UUID NOT NULL REFERENCES hospitals(id),
    department_id UUID REFERENCES departments(id),

    raw_text TEXT NOT NULL,                   -- original complaint text (or STT transcript)
    raw_audio_url TEXT,                       -- original voice note, if any, always kept

    category TEXT REFERENCES complaint_tags(tag),
    is_new_category BOOLEAN DEFAULT false,
    classification_confidence REAL,
    sentiment TEXT,
    urgency TEXT CHECK (urgency IN ('critical', 'high', 'normal', 'low')),
    summary_en TEXT,
    summary_hi TEXT,

    is_anonymous BOOLEAN DEFAULT false,        -- patient can hide identity from officer

    assigned_officer_id UUID REFERENCES officers(id),
    status TEXT NOT NULL DEFAULT 'new' CHECK (
        status IN ('new', 'acknowledged', 'resolved', 'reopened', 'escalated')
    ),

    ack_sla_deadline TIMESTAMPTZ,
    resolution_sla_deadline TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,

    patient_confirmed_resolved BOOLEAN,        -- satisfaction loop: patient's own yes/no

    created_at TIMESTAMPTZ DEFAULT now()
);

-- Every officer<->patient message in the resolution thread, for audit trail.
CREATE TABLE complaint_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id),
    sender_type TEXT NOT NULL CHECK (sender_type IN ('patient', 'officer', 'system')),
    sender_id UUID,                            -- officer id if sender_type = 'officer'
    message_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Escalation trail: every time a complaint moves up the chain, log it here.
CREATE TABLE escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id),
    escalated_from_officer_id UUID REFERENCES officers(id),
    escalated_to_role TEXT NOT NULL,           -- e.g. 'superadmin', 'district_health_authority'
    reason TEXT NOT NULL,                      -- e.g. 'ack_sla_breach', 'resolution_sla_breach', 'patient_reopened'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes worth having from day one.
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_complaints_officer ON complaints(assigned_officer_id);
CREATE INDEX idx_complaints_hospital ON complaints(hospital_id);
CREATE INDEX idx_patients_token ON patients(patient_token);
