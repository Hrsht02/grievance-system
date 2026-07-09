"""Add phone_number to hospitals table. Run once."""
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / "config" / ".env")
import db

db._request("PATCH", "hospitals?id=neq.00000000-0000-0000-0000-000000000000",
            body={}, extra_headers={"Prefer": "return=minimal"})

# Use raw SQL via RPC isn't available on free tier, so we use a workaround
# Just check if column exists by trying to select it
try:
    db._request("GET", "hospitals?select=phone_number&limit=1")
    print("phone_number column already exists")
except Exception:
    print("Need to add phone_number column manually in Supabase SQL editor:")
    print("ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS phone_number TEXT;")
    print("ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS address TEXT;")
    print("ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS email TEXT;")
