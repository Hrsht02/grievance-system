"""
seed_tags.py — One-time script to populate complaint_tags with the default taxonomy.
Run once: python seed_tags.py
"""
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / "config" / ".env")

import db

DEFAULT_TAGS = [
    "doctor_absent",
    "staff_misbehavior",
    "medicine_unavailable",
    "long_wait_time",
    "cleanliness_issue",
    "billing_issue",
    "equipment_unavailable",
    "wrong_treatment_concern",
    "other",
]

with db.get_db() as conn:
    with conn.cursor() as cur:
        for tag in DEFAULT_TAGS:
            cur.execute(
                """
                INSERT INTO complaint_tags (tag, status)
                VALUES (%s, 'approved')
                ON CONFLICT (tag) DO NOTHING
                """,
                (tag,),
            )
        cur.execute("SELECT tag FROM complaint_tags ORDER BY tag")
        rows = cur.fetchall()

print("complaint_tags table now contains:")
for r in rows:
    print(f"  {r['tag']}")
