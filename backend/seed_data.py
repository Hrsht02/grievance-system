"""
seed_data.py — Seeds hospitals (with phone numbers) and patients with Hindi names.
Run once: python seed_data.py
"""
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / "config" / ".env")

import db
import uuid

# ---------------------------------------------------------------------------
# 1. Add phone_number / address columns if not already present
#    (run SQL in Supabase if this fails)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 2. Hospitals across different districts of Bihar
# ---------------------------------------------------------------------------

HOSPITALS = [
    {
        "name": "AIIMS Patna",
        "district": "Patna",
        "phone_number": "0612-2451070",
        "address": "Phulwarisharif, Patna, Bihar 801507",
        "email": "info@aiimspatna.org",
    },
    {
        "name": "NMCH Patna (Nalanda Medical College)",
        "district": "Patna",
        "phone_number": "0612-2636665",
        "address": "Agamkuan, Patna, Bihar 800007",
        "email": "nmch.patna@gov.in",
    },
    {
        "name": "PMCH Patna (Patna Medical College)",
        "district": "Patna",
        "phone_number": "0612-2300090",
        "address": "Ashok Raj Path, Patna, Bihar 800004",
        "email": "pmch.patna@gov.in",
    },
    {
        "name": "Darbhanga Medical College & Hospital",
        "district": "Darbhanga",
        "phone_number": "06272-222551",
        "address": "Laheriasarai, Darbhanga, Bihar 846003",
        "email": "dmch.darbhanga@gov.in",
    },
    {
        "name": "SKMCH Muzaffarpur (Sri Krishna Medical College)",
        "district": "Muzaffarpur",
        "phone_number": "0621-2241555",
        "address": "Umanagar, Muzaffarpur, Bihar 842004",
        "email": "skmch.mzp@gov.in",
    },
    {
        "name": "Anugrah Narayan Magadh Medical College, Gaya",
        "district": "Gaya",
        "phone_number": "0631-2220350",
        "address": "Old Ware House Road, Gaya, Bihar 823001",
        "email": "anmmc.gaya@gov.in",
    },
    {
        "name": "Bhagalpur Medical College & Hospital",
        "district": "Bhagalpur",
        "phone_number": "0641-2400481",
        "address": "Mayaganj, Bhagalpur, Bihar 812001",
        "email": "jlnmch.bgp@gov.in",
    },
    {
        "name": "Sadar Hospital Munger",
        "district": "Munger",
        "phone_number": "06344-222345",
        "address": "Hospital Road, Munger, Bihar 811201",
        "email": "sadar.munger@gov.in",
    },
    {
        "name": "Sadar Hospital Chapra",
        "district": "Saran",
        "phone_number": "06152-232100",
        "address": "Station Road, Chapra, Bihar 841301",
        "email": "sadar.chapra@gov.in",
    },
    {
        "name": "Sadar Hospital Motihari",
        "district": "East Champaran",
        "phone_number": "06252-242200",
        "address": "Hospital Chowk, Motihari, Bihar 845401",
        "email": "sadar.motihari@gov.in",
    },
]

# ---------------------------------------------------------------------------
# 3. Departments (common across hospitals)
# ---------------------------------------------------------------------------

DEPARTMENTS = [
    "Cardiology", "Orthopaedics", "General Medicine",
    "Gynaecology", "Paediatrics", "Surgery", "Emergency",
    "Radiology", "Pathology", "ENT",
]

# ---------------------------------------------------------------------------
# 4. Patients with Hindi names
# ---------------------------------------------------------------------------

PATIENTS = [
    {"name": "रमेश कुमार",     "mobile": "9876543210", "abha": "12-3456-7890-0001"},
    {"name": "सुनीता देवी",    "mobile": "9876543211", "abha": "12-3456-7890-0002"},
    {"name": "मोहन लाल",      "mobile": "9876543212", "abha": "12-3456-7890-0003"},
    {"name": "अनिता सिंह",    "mobile": "9876543213", "abha": "12-3456-7890-0004"},
    {"name": "राजेश यादव",    "mobile": "9876543214", "abha": "12-3456-7890-0005"},
    {"name": "प्रिया कुमारी",  "mobile": "9876543215", "abha": "12-3456-7890-0006"},
    {"name": "सुरेश पासवान",  "mobile": "9876543216", "abha": "12-3456-7890-0007"},
    {"name": "ललिता देवी",    "mobile": "9876543217", "abha": "12-3456-7890-0008"},
    {"name": "विजय कुमार",    "mobile": "9876543218", "abha": "12-3456-7890-0009"},
    {"name": "शांति देवी",    "mobile": "9876543219", "abha": "12-3456-7890-0010"},
    {"name": "अमित शर्मा",    "mobile": "9876543220", "abha": "12-3456-7890-0011"},
    {"name": "रीता कुमारी",   "mobile": "9876543221", "abha": "12-3456-7890-0012"},
    {"name": "दिनेश राम",     "mobile": "9876543222", "abha": "12-3456-7890-0013"},
    {"name": "कमला देवी",     "mobile": "9876543223", "abha": "12-3456-7890-0014"},
    {"name": "संजय झा",      "mobile": "9876543224", "abha": "12-3456-7890-0015"},
    {"name": "मीरा सिन्हा",   "mobile": "9876543225", "abha": "12-3456-7890-0016"},
    {"name": "रामप्रसाद गुप्ता","mobile": "9876543226", "abha": "12-3456-7890-0017"},
    {"name": "उषा रानी",      "mobile": "9876543227", "abha": "12-3456-7890-0018"},
    {"name": "नरेश महतो",     "mobile": "9876543228", "abha": "12-3456-7890-0019"},
    {"name": "गीता सिंह",     "mobile": "9876543229", "abha": "12-3456-7890-0020"},
]

# ---------------------------------------------------------------------------
# Main seeding logic
# ---------------------------------------------------------------------------

def seed():
    print("=== Seeding hospitals ===")
    hospital_ids = {}
    existing_hospitals = db._request("GET", "hospitals?select=id,name")
    existing_names = {h["name"] for h in existing_hospitals}

    for h in HOSPITALS:
        if h["name"] in existing_names:
            row = next(x for x in existing_hospitals if x["name"] == h["name"])
            # Update phone/address even if exists
            db._request("PATCH", f"hospitals?id=eq.{row['id']}",
                        body={k: v for k, v in h.items() if k != "name"},
                        extra_headers={"Prefer": "return=minimal"})
            hospital_ids[h["name"]] = row["id"]
            print(f"  Updated: {h['name']}")
        else:
            rows = db._request("POST", "hospitals",
                               body={**h, "state": "Bihar"})
            hid = rows[0]["id"] if isinstance(rows, list) else rows["id"]
            hospital_ids[h["name"]] = hid
            print(f"  Created: {h['name']} ({hid})")

    print("\n=== Seeding departments ===")
    dept_ids = {}  # (hospital_id, dept_name) -> dept_id
    existing_depts = db._request("GET", "departments?select=id,hospital_id,name")

    for hname, hid in hospital_ids.items():
        for dept in DEPARTMENTS:
            existing = next((d for d in existing_depts
                             if d["hospital_id"] == hid and d["name"] == dept), None)
            if existing:
                dept_ids[(hid, dept)] = existing["id"]
            else:
                rows = db._request("POST", "departments",
                                   body={"hospital_id": hid, "name": dept})
                did = rows[0]["id"] if isinstance(rows, list) else rows["id"]
                dept_ids[(hid, dept)] = did
        print(f"  Departments ready for {hname}")

    print("\n=== Seeding patients ===")
    existing_patients = db._request("GET", "patients?select=mobile_number,name")
    existing_mobiles = {p["mobile_number"] for p in existing_patients}

    hospital_list = list(hospital_ids.items())
    dept_list = list(dept_ids.items())

    created = 0
    for i, p in enumerate(PATIENTS):
        if p["mobile"] in existing_mobiles:
            print(f"  Skip (exists): {p['name']}")
            continue

        # Distribute patients across hospitals
        hname, hid = hospital_list[i % len(hospital_list)]
        # Assign to a department of that hospital
        hosp_depts = [(key, did) for key, did in dept_ids.items() if key[0] == hid]
        _, dept_id = hosp_depts[i % len(hosp_depts)]

        token = uuid.uuid4().hex  # unique QR token

        db._request("POST", "patients", body={
            "patient_token": token,
            "name": p["name"],
            "mobile_number": p["mobile"],
            "abha_number": p["abha"],
            "hospital_id": hid,
            "department_id": dept_id,
        })
        print(f"  Created: {p['name']} → {hname} (token: {token})")
        created += 1

    print(f"\n✅ Done. {len(hospital_ids)} hospitals, {created} new patients seeded.")
    print("\nPatient tokens for testing:")
    all_patients = db._request("GET", "patients?select=name,patient_token,mobile_number&order=name")
    for p in all_patients[:5]:
        print(f"  {p['name']} → token: {p['patient_token']}")
        print(f"    QR link: https://t.me/BiharSwasthyaSuvidhaBot?start={p['patient_token']}")


if __name__ == "__main__":
    seed()
