import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Download, LoaderCircle, LockKeyhole, Upload, X } from 'lucide-react';
import { convertWithElevenLabs, fetchElevenLabsStatus, fetchElevenLabsVoices } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/format';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 5 * 60;
const RATE_PER_MINUTE = 0.12;

export default function ElevenLabsVoiceChanger() {
  const [status, setStatus] = useState(null);
  const [accessCode, setAccessCode] = useState('');
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState('');
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(0);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    fetchElevenLabsStatus().then(setStatus).catch(() => setStatus(null));
    return () => {
      abortRef.current?.abort();
      if (result?.url) URL.revokeObjectURL(result.url);
    };
    // Result URL is cleaned when the component unmounts; this is intentionally
    // a mount-only cleanup to avoid revoking a still-visible preview on updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedVoice = voices.find((voice) => voice.voice_id === voiceId);
  const estimatedCost = useMemo(
    () => (duration > 0 ? (duration / 60) * RATE_PER_MINUTE : 0),
    [duration]
  );

  const loadVoices = async () => {
    if (!accessCode.trim()) {
      setError('Enter the voice-conversion access code configured by the app owner.');
      return;
    }
    setLoadingVoices(true);
    setError('');
    try {
      const data = await fetchElevenLabsVoices(accessCode.trim());
      const available = data.voices || [];
      setVoices(available);
      const preferred = available.find((voice) =>
        /nichalia schwartz/i.test(voice.name)
        && /female/i.test(voice.labels?.gender || '')
        && /american|genam/i.test(voice.labels?.accent || '')
      );
      const firstAmericanFemale = available.find((voice) =>
        /female/i.test(voice.labels?.gender || '')
        && /american|genam/i.test(voice.labels?.accent || '')
      );
      const nextVoice = preferred || firstAmericanFemale || available[0];
      setVoiceId(nextVoice?.voice_id || '');
      if (!available.length) setError('No voices were returned for this ElevenLabs account.');
    } catch (err) {
      setError(err.message || 'Could not load account voices.');
    } finally {
      setLoadingVoices(false);
    }
  };

  const chooseFile = (candidate) => {
    if (!candidate) return;
    if (candidate.size > MAX_BYTES) {
      setError('The recording must be 50 MB or smaller.');
      return;
    }
    setFile(candidate);
    setDuration(0);
    setResult((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
    setError('');
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const seconds = Number(probe.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        setError('Could not read the recording duration. Try a standard WAV or MP3 file.');
        setFile(null);
      } else if (seconds > MAX_SECONDS) {
        setError('Recordings must be 5 minutes or shorter for one request.');
        setFile(null);
      } else {
        setDuration(seconds);
      }
      URL.revokeObjectURL(probe.src);
    };
    probe.onerror = () => {
      setError('Could not read this audio file. Try WAV, MP3, M4A, AAC, OGG, WEBM, or FLAC.');
      setFile(null);
      URL.revokeObjectURL(probe.src);
    };
    probe.src = URL.createObjectURL(candidate);
  };

  const handleConvert = async () => {
    if (!file || !voiceId || !duration || converting) return;
    const cost = estimatedCost.toFixed(3);
    const confirmed = window.confirm(
      `Send "${file.name}" (${formatDuration(duration)}) to ElevenLabs for paid voice conversion?\\n\\nEstimated cost: $${cost} USD before taxes at $0.12 per audio minute.\\n\\nYour audio will be uploaded to ElevenLabs. Continue?`
    );
    if (!confirmed) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setConverting(true);
    setError('');
    try {
      const blob = await convertWithElevenLabs(file, voiceId, accessCode.trim(), controller.signal);
      const url = URL.createObjectURL(blob);
      setResult((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { url, name: `${file.name.replace(/\.[^.]+$/, '')}_american_voice.mp3`, size: blob.size };
      });
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message || 'Voice conversion failed.');
    } finally {
      abortRef.current = null;
      setConverting(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setDuration(0);
    setResult((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="panel-kicker">AI Voice Changer · Paid per use</p>
          <h2 className="panel-title">American female voice</h2>
          <p className="mt-1 text-xs text-fg-subtle">Preserves the original words, timing, emotion, and delivery while changing the speaker voice.</p>
        </div>
        <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted">$0.12 / audio minute</span>
      </div>

      {!status?.ready && (
        <div className="mt-4 rounded-lg border border-line bg-raised p-3 text-xs text-fg-secondary">
          <p className="font-semibold text-fg">Protected setup required</p>
          <p className="mt-1">The app owner must add ELEVENLABS_API_KEY and ELEVENLABS_ACCESS_CODE to the server environment. The API key is never entered here.</p>
          {status?.api_key_configured && !status?.access_code_configured && <p className="mt-1 text-warn-fg">The server API key is present; the access code still needs to be configured.</p>}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <label className="block text-xs font-medium text-fg-muted" htmlFor="elevenlabs-access-code">Voice conversion access code</label>
        <div className="flex gap-2">
          <input id="elevenlabs-access-code" type="password" autoComplete="off" value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)} placeholder="Enter server access code"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-input px-3 py-2.5 text-sm text-fg" />
          <button type="button" disabled={!status?.ready || !accessCode.trim() || loadingVoices || converting}
            onClick={loadVoices} className="chip-button inline-flex shrink-0 items-center gap-2">
            {loadingVoices ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            Load voices
          </button>
        </div>
        {voices.length > 0 && (
          <>
            <label className="block text-xs font-medium text-fg-muted" htmlFor="elevenlabs-voice">Target voice</label>
            <select id="elevenlabs-voice" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}
              disabled={converting} className="native-select-safe w-full rounded-lg border border-line-strong bg-input px-3 py-2.5 text-sm text-fg">
              {voices.map((voice) => (
                <option key={voice.voice_id} value={voice.voice_id}>
                  {voice.name} {voice.labels?.gender ? `· ${voice.labels.gender}` : ''} {voice.labels?.accent ? `· ${voice.labels.accent}` : ''}
                </option>
              ))}
            </select>
            {selectedVoice && <p className="text-xs text-fg-subtle">{selectedVoice.description || 'Account voice selected.'}</p>}
          </>
        )}

        <div className="rounded-lg border border-dashed border-line-strong bg-raised p-4">
          <input ref={inputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.webm,.flac"
            className="hidden" onChange={(event) => chooseFile(event.target.files?.[0])} />
          {!file ? (
            <button type="button" disabled={converting} onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 py-3 text-center">
              <Upload className="h-6 w-6 text-fg-subtle" />
              <span className="text-sm font-medium text-fg-secondary">Choose your voice recording</span>
              <span className="text-xs text-fg-faint">Maximum 5 minutes · 50 MB · audio stays local until you confirm</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <AudioLines className="h-6 w-6 shrink-0 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium text-fg">{file.name}</p>
                <p className="text-xs text-fg-subtle">{formatDuration(duration)} · {formatBytes(file.size)}</p>
              </div>
              <button type="button" disabled={converting} onClick={clearFile} aria-label="Remove selected recording" className="chip-button !p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {duration > 0 && <p className="text-xs text-fg-secondary">Estimated conversion: <strong>${estimatedCost.toFixed(3)} USD</strong> before taxes. Final billing is determined by ElevenLabs.</p>}

        {converting ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="frost-control inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-sm font-semibold" data-tone="danger">
            <X className="h-4 w-4" /> Cancel conversion
          </button>
        ) : (
          <button type="button" onClick={handleConvert} disabled={!status?.ready || !voices.length || !file || !duration || !voiceId}
            className="frost-control inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-sm font-semibold disabled:opacity-50" data-tone="primary">
            <AudioLines className="h-4 w-4" /> Convert voice · paid
          </button>
        )}
        {converting && <p role="status" className="flex items-center gap-2 text-xs text-fg-subtle"><LoaderCircle className="h-4 w-4 animate-spin" /> Sending recording for conversion…</p>}
        {error && <p role="alert" className="text-xs text-danger-fg">{error}</p>}
        {result && (
          <div className="rounded-lg border border-line bg-raised p-3">
            <p className="break-all text-sm font-medium text-fg">{result.name} · {formatBytes(result.size)}</p>
            <audio controls src={result.url} className="mt-2 h-10 w-full" />
            <a href={result.url} download={result.name} className="chip-button mt-3 inline-flex items-center gap-2">
              <Download className="h-4 w-4" /> Download converted audio
            </a>
          </div>
        )}
        <p className="text-[11px] leading-5 text-fg-faint">Each confirmed conversion sends the selected audio to ElevenLabs. This feature does not clone or train a voice model. Free DSP effects remain available without this service.</p>
      </div>
    </section>
  );
}
