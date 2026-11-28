"""Opt-in ElevenLabs Voice Changer integration.

No provider request is made by /status. Paid conversion requires a server-side
API key, a server-side access code, a valid account voice ID, and an explicit
user action in the frontend.
"""
import asyncio
import hmac
import os
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response

router = APIRouter(prefix="/api/elevenlabs", tags=["elevenlabs"])

ELEVENLABS_API = "https://api.elevenlabs.io/v1"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_REQUESTS_PER_HOUR = 3
_rate_events: dict[str, deque[float]] = defaultdict(deque)


def _configuration() -> tuple[str, str]:
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    access_code = os.environ.get("ELEVENLABS_ACCESS_CODE", "").strip()
    return api_key, access_code


def get_configuration_status() -> dict:
    api_key, access_code = _configuration()
    return {
        "provider": "elevenlabs",
        "mode": "opt_in_voice_changer",
        "dry_run": True,
        "external_requests_enabled": bool(api_key and access_code),
        "api_key_configured": bool(api_key),
        "access_code_configured": bool(access_code),
        "voice_id_configured": bool(os.environ.get("ELEVENLABS_VOICE_ID", "").strip()),
        "ready": bool(api_key and access_code),
        "rate_limit_per_hour": MAX_REQUESTS_PER_HOUR,
        "price_usd_per_audio_minute": 0.12,
        "message": (
            "Ready. A paid request is made only after the user confirms conversion."
            if api_key and access_code
            else "Set ELEVENLABS_API_KEY and ELEVENLABS_ACCESS_CODE on the server to enable protected conversion."
        ),
    }


def _require_access_code(provided: str | None) -> tuple[str, str]:
    api_key, expected = _configuration()
    if not api_key or not expected:
        raise HTTPException(
            status_code=503,
            detail="Paid voice conversion is not configured. Set the server-side ElevenLabs API key and access code.",
        )
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Enter the correct voice-conversion access code.")
    return api_key, expected


def _check_rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    events = _rate_events[client_ip]
    while events and now - events[0] > 3600:
        events.popleft()
    if len(events) >= MAX_REQUESTS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Conversion limit reached: maximum 3 paid conversions per hour.")
    events.append(now)


async def _elevenlabs_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
        detail = payload.get("detail", payload)
        if isinstance(detail, dict):
            return str(detail.get("message") or detail.get("status") or detail)
        return str(detail)
    except Exception:
        return f"ElevenLabs returned HTTP {response.status_code}."


@router.get("/status")
async def get_status() -> dict:
    """Local-only configuration status; does not contact ElevenLabs."""
    return get_configuration_status()


@router.get("/voices")
async def list_voices(
    x_ovc_voice_access: str | None = Header(default=None),
) -> dict:
    """List voices available to this API account; this does not generate audio."""
    api_key, _ = _require_access_code(x_ovc_voice_access)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{ELEVENLABS_API}/voices",
                headers={"xi-api-key": api_key},
                params={"page_size": 100},
            )
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=await _elevenlabs_error(response))
        payload = response.json()
        voices = []
        for voice in payload.get("voices", []):
            labels = voice.get("labels") or {}
            voices.append({
                "voice_id": voice.get("voice_id"),
                "name": voice.get("name") or "Unnamed voice",
                "labels": {
                    "accent": labels.get("accent", ""),
                    "gender": labels.get("gender", ""),
                    "age": labels.get("age", ""),
                },
                "description": voice.get("description") or "",
                "preview_url": voice.get("preview_url") or "",
            })
        return {"voices": voices}
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach ElevenLabs. Try again later.")


@router.post("/convert")
async def convert_voice(
    request: Request,
    audio: UploadFile = File(...),
    voice_id: str = Form(...),
    x_ovc_voice_access: str | None = Header(default=None),
) -> Response:
    """Convert one user-selected recording. This is the only paid endpoint."""
    api_key, _ = _require_access_code(x_ovc_voice_access)
    _check_rate_limit(request)

    configured_voice = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
    if configured_voice and voice_id != configured_voice:
        # A configured server-side voice is an allowlist, not a browser override.
        raise HTTPException(status_code=400, detail="The selected voice does not match the server-approved voice ID.")

    filename = (audio.filename or "").lower()
    allowed_extensions = (".wav", ".mp3", ".m4a", ".aac", ".ogg", ".webm", ".flac")
    if not filename.endswith(allowed_extensions):
        raise HTTPException(status_code=415, detail="Choose a WAV, MP3, M4A, AAC, OGG, WEBM, or FLAC recording.")

    content = await audio.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The selected audio file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio files must be 50 MB or smaller.")

    # Confirm the voice is available to this account before sending billable audio.
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            voice_response = await client.get(
                f"{ELEVENLABS_API}/voices/{voice_id}",
                headers={"xi-api-key": api_key},
            )
            if voice_response.status_code >= 400:
                raise HTTPException(status_code=400, detail="That voice is not available to this ElevenLabs account.")
            voice_payload = voice_response.json()
            if voice_payload.get("voice_id") != voice_id:
                raise HTTPException(status_code=400, detail="ElevenLabs did not confirm the selected voice.")

            response = await client.post(
                f"{ELEVENLABS_API}/voice-changer/{voice_id}",
                headers={"xi-api-key": api_key},
                params={"output_format": "mp3_44100_128"},
                data={"model_id": "eleven_multilingual_sts_v2"},
                files={"audio": (audio.filename or "recording.wav", content, audio.content_type or "application/octet-stream")},
                timeout=180,
            )
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=await _elevenlabs_error(response))
        return Response(
            content=response.content,
            media_type=response.headers.get("content-type", "audio/mpeg"),
            headers={"Content-Disposition": 'attachment; filename="voice-converted.mp3"', "Cache-Control": "no-store"},
        )
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not complete the ElevenLabs request. No converted file was returned.")
