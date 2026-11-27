"""Safe, credit-free configuration checks for the optional ElevenLabs integration.

This module deliberately does not call ElevenLabs. It only reports whether the
server-side environment variables exist; it never returns their values.
"""
import os

from fastapi import APIRouter

router = APIRouter(prefix="/api/elevenlabs", tags=["elevenlabs"])


def get_configuration_status() -> dict:
    """Return presence-only configuration state without contacting ElevenLabs."""
    api_key_configured = bool(os.environ.get("ELEVENLABS_API_KEY", "").strip())
    voice_id_configured = bool(os.environ.get("ELEVENLABS_VOICE_ID", "").strip())

    return {
        "provider": "elevenlabs",
        "mode": "dry_run",
        "dry_run": True,
        "external_requests_enabled": False,
        "api_key_configured": api_key_configured,
        "voice_id_configured": voice_id_configured,
        "ready_for_connection_test": api_key_configured and voice_id_configured,
        "message": (
            "Configuration is present but has not been validated with ElevenLabs."
            if api_key_configured and voice_id_configured
            else "Add the missing server environment variables to prepare the integration."
        ),
    }


@router.get("/status")
async def get_status() -> dict:
    """A local-only status check; no external API call or audio generation occurs."""
    return get_configuration_status()
