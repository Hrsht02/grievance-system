"""
generate_qr.py — QR code generation utility for patient onboarding.

Generates a QR image for a given patient_token. The QR encodes a
Telegram deep-link URL (or WhatsApp equivalent later). Personal details
(name, mobile, ABHA number) are never embedded in the QR itself — only
the opaque patient_token.

Usage:
    python generate_qr.py --token <patient_token> --out patient_qr.png
    python generate_qr.py --bulk hospital_patients.csv --out-dir ./qr_codes/

CSV format for bulk mode:
    patient_token,patient_name,hospital_name
"""

import argparse
import csv
import os
import sys
import uuid
from pathlib import Path

import qrcode
from qrcode.image.styledpil import StyledPilImage
from PIL import Image, ImageDraw, ImageFont

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / "config" / ".env")

TELEGRAM_BOT_USERNAME = os.environ.get("TELEGRAM_BOT_USERNAME", "GrievanceBot")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "")


def _bot_deep_link(token: str) -> str:
    """
    Telegram deep-link: https://t.me/<BotUsername>?start=<token>
    When scanned, opens Telegram and sends /start <token> automatically.
    """
    return f"https://t.me/{TELEGRAM_BOT_USERNAME}?start={token}"


def generate_qr_image(
    token: str,
    patient_name: str = "",
    hospital_name: str = "",
    output_path: str | None = None,
) -> Image.Image:
    """
    Generate a QR code image for a single patient.
    Returns a PIL Image; optionally saves to output_path.
    """
    url = _bot_deep_link(token)

    qr = qrcode.QRCode(
        version=None,          # auto-size
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)

    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    # Add a label strip below the QR code
    label_height = 60
    total_width = qr_img.width
    total_height = qr_img.height + label_height

    canvas = Image.new("RGB", (total_width, total_height), "white")
    canvas.paste(qr_img, (0, 0))

    draw = ImageDraw.Draw(canvas)
    # Use default font (no external font file required for MVP)
    try:
        font_large = ImageFont.truetype("arial.ttf", 14)
        font_small = ImageFont.truetype("arial.ttf", 11)
    except (IOError, OSError):
        font_large = ImageFont.load_default()
        font_small = font_large

    label_y = qr_img.height + 6
    if patient_name:
        draw.text((total_width // 2, label_y), patient_name, fill="black", font=font_large, anchor="mt")
        label_y += 18
    if hospital_name:
        draw.text((total_width // 2, label_y), hospital_name, fill="#555555", font=font_small, anchor="mt")
        label_y += 16
    draw.text(
        (total_width // 2, label_y),
        "Scan to file a complaint",
        fill="#888888",
        font=font_small,
        anchor="mt",
    )

    if output_path:
        canvas.save(output_path)
        print(f"QR saved: {output_path}")

    return canvas


def generate_bulk_from_csv(csv_path: str, out_dir: str):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            token = row.get("patient_token", "").strip()
            name = row.get("patient_name", "").strip()
            hospital = row.get("hospital_name", "").strip()
            if not token:
                print(f"Skipping row with empty token: {row}")
                continue
            out_file = Path(out_dir) / f"{token}.png"
            generate_qr_image(token, patient_name=name, hospital_name=hospital, output_path=str(out_file))


def generate_new_token() -> str:
    """
    Generate a cryptographically random patient_token (UUID4-based).
    Use this when onboarding a new patient if they don't already have one.
    """
    return uuid.uuid4().hex  # 32-char hex, no dashes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate patient QR codes.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--token", help="Single patient_token")
    group.add_argument("--bulk", metavar="CSV", help="CSV file for bulk generation")
    parser.add_argument("--name", default="", help="Patient name (single mode)")
    parser.add_argument("--hospital", default="", help="Hospital name (single mode)")
    parser.add_argument("--out", default="patient_qr.png", help="Output path (single mode)")
    parser.add_argument("--out-dir", default="./qr_codes", help="Output directory (bulk mode)")
    args = parser.parse_args()

    if args.token:
        generate_qr_image(
            args.token,
            patient_name=args.name,
            hospital_name=args.hospital,
            output_path=args.out,
        )
    else:
        generate_bulk_from_csv(args.bulk, args.out_dir)
