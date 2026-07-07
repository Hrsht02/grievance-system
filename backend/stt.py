"""
stt.py — Speech-to-text abstraction layer.

Priority order:
  1. Local endpoint (AI4Bharat IndicWhisper / IndicConformer) — set STT_ENDPOINT_URL
  2. OpenAI-compatible Whisper endpoint — set STT_API_KEY + STT_ENDPOINT_URL
  3. Returns None if all methods fail (caller must handle gracefully)

The bot always stores the original audio regardless of transcription success.
"""

import os
import json
import logging
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

STT_ENDPOINT_URL = os.environ.get("STT_ENDPOINT_URL", "")
STT_API_KEY = os.environ.get("STT_API_KEY", "")


def transcribe_audio(audio_path: str) -> str | None:
    """
    Attempt to transcribe an audio file.
    Returns the transcribed string, or None on failure.
    """
    if STT_ENDPOINT_URL:
        result = _transcribe_via_endpoint(audio_path)
        if result:
            return result

    # Fallback: try local Whisper if available as a Python package
    result = _transcribe_via_local_whisper(audio_path)
    if result:
        return result

    logger.warning("All STT methods failed for %s", audio_path)
    return None


def _transcribe_via_endpoint(audio_path: str) -> str | None:
    """
    POST the audio file to a local or remote STT endpoint.
    Expected response: {"text": "transcribed string"} (Whisper-compatible format).
    """
    try:
        with open(audio_path, "rb") as f:
            audio_bytes = f.read()

        boundary = "----GrievanceBotBoundary"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="audio.ogg"\r\n'
            f"Content-Type: audio/ogg\r\n\r\n"
        ).encode() + audio_bytes + f"\r\n--{boundary}--\r\n".encode()

        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        if STT_API_KEY:
            headers["Authorization"] = f"Bearer {STT_API_KEY}"

        req = urllib.request.Request(
            STT_ENDPOINT_URL, data=body, headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("text") or data.get("transcript")

    except Exception as e:
        logger.warning("STT endpoint error: %s", e)
        return None


def _transcribe_via_local_whisper(audio_path: str) -> str | None:
    """
    Try to use the 'whisper' Python package if it is installed locally.
    This keeps the system functional even without a remote STT endpoint.
    """
    try:
        import whisper  # type: ignore
        model = whisper.load_model("base")
        result = model.transcribe(audio_path)
        return result.get("text", "").strip() or None
    except ImportError:
        logger.debug("whisper package not installed; skipping local STT")
        return None
    except Exception as e:
        logger.warning("Local Whisper error: %s", e)
        return None
