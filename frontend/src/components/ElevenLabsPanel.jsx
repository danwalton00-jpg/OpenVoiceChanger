import React, { useCallback, useEffect, useState } from 'react';
import { fetchElevenLabsStatus } from '../lib/api';

function StatusRow({ label, ready }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-2.5">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className={`text-xs font-medium ${ready ? 'text-ok-fg' : 'text-fg-subtle'}`}>
        {ready ? 'Configured' : 'Not configured'}
      </span>
    </div>
  );
}

export default function ElevenLabsPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // This calls only our own backend's local status route. It never calls
      // ElevenLabs and cannot upload audio, train a voice, or spend credits.
      setStatus(await fetchElevenLabsStatus());
    } catch (err) {
      setError(err?.message || 'Could not read the local integration status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="mt-6 rounded-xl border border-line-strong bg-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">ElevenLabs personal voice</p>
          <p className="mt-1 text-xs text-fg-subtle">Safe setup check · no audio or credits used</p>
        </div>
        <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-fg-muted">
          Dry-run only
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-fg-subtle">
        This check reads configuration on the OpenVoiceChanger server only. It does not contact ElevenLabs,
        validate the API key, upload recordings, train a voice, or generate audio.
      </p>

      {status ? (
        <div className="mt-3">
          <StatusRow label="ELEVENLABS_API_KEY" ready={status.api_key_configured} />
          <StatusRow label="ELEVENLABS_VOICE_ID" ready={status.voice_id_configured} />
          <p className="mt-3 text-xs leading-5 text-fg-muted">
            {status.message}
          </p>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-xs text-warn-fg">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="chip-button disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Run safe configuration check'}
        </button>
        <span className="text-[11px] text-fg-faint">
          Server secrets are never sent to this page.
        </span>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-sunken p-3">
        <p className="text-xs font-semibold text-fg-secondary">Where to add the settings</p>
        <p className="mt-1 text-xs leading-5 text-fg-subtle">
          In the OpenVoiceChanger Render service, add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
          under Environment. Never put the API key in browser code or chat.
        </p>
      </div>
    </section>
  );
}
