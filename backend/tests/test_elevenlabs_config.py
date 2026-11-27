from backend.routers.elevenlabs import get_configuration_status


def test_status_reports_missing_configuration_without_external_calls(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_VOICE_ID", raising=False)

    result = get_configuration_status()

    assert result["mode"] == "dry_run"
    assert result["dry_run"] is True
    assert result["external_requests_enabled"] is False
    assert result["api_key_configured"] is False
    assert result["voice_id_configured"] is False
    assert result["ready_for_connection_test"] is False


def test_status_only_reports_secret_presence(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "secret-test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "private-test-voice-id")

    result = get_configuration_status()

    assert result["api_key_configured"] is True
    assert result["voice_id_configured"] is True
    assert result["ready_for_connection_test"] is True
    assert "secret-test-key" not in repr(result)
    assert "private-test-voice-id" not in repr(result)
