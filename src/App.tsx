import { useEffect, useMemo, useRef, useState } from "react";
import { startMicrophoneStream, type AudioStreamController } from "./audio/workletClient";
import type {
  FileTranscriptResponse,
  ModelInfo,
  ServerEvent,
  TranscriptMessage,
  TtsResponse,
} from "./types";

const API_URL = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws/live";

const speakerPalette: Record<string, { side: "left" | "right"; label: string }> = {
  SPEAKER_00: { side: "left", label: "Speaker A" },
  SPEAKER_01: { side: "right", label: "Speaker B" },
  UNKNOWN: { side: "left", label: "Detecting" }
};

type ViewMode = "live" | "transcribe" | "tts";

function formatClock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

function speakerView(speakerId: string) {
  return speakerPalette[speakerId] ?? { side: "left" as const, label: speakerId };
}

export default function App() {
  const [mode, setMode] = useState<ViewMode>("live");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [liveModel, setLiveModel] = useState("whisper");
  const [fileModel, setFileModel] = useState("whisper");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [partial, setPartial] = useState<TranscriptMessage | null>(null);
  const [status, setStatus] = useState("Ready");
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileTranscript, setFileTranscript] = useState<FileTranscriptResponse | null>(null);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsResult, setTtsResult] = useState<TtsResponse | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<AudioStreamController | null>(null);

  const transcriptFeed = useMemo(
    () => (partial ? [...messages, partial] : messages),
    [messages, partial],
  );

  const asrModels = models.filter((model) => model.kind === "asr");

  useEffect(() => {
    void fetch(`${API_URL}/api/models`)
      .then((response) => response.json())
      .then((payload: { models: ModelInfo[] }) => {
        setModels(payload.models);
      })
      .catch(() => {
        setError("Could not load model registry from the backend.");
      });

    return () => {
      socketRef.current?.close();
      void streamRef.current?.stop();
    };
  }, []);

  async function startSession() {
    setError(null);
    setMessages([]);
    setPartial(null);

    const socket = new WebSocket(WS_URL);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    socket.onopen = async () => {
      setConnected(true);
      socket.send(
        JSON.stringify({
          type: "start",
          format: "pcm_s16le",
          sampleRate: 16000,
          channels: 1,
          model: liveModel
        }),
      );

      try {
        streamRef.current = await startMicrophoneStream((chunk) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(chunk);
          }
        });
        setRecording(true);
      } catch (micError) {
        socket.close();
        setError(micError instanceof Error ? micError.message : "Microphone access failed.");
      }
    };

    socket.onclose = () => {
      setConnected(false);
      setRecording(false);
      setStatus("Disconnected");
    };

    socket.onerror = () => {
      setError("WebSocket connection failed.");
    };

    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ServerEvent;
      if (payload.type === "session.ready") {
        setStatus(`Live session ${payload.sessionId.slice(0, 8)}`);
        return;
      }

      if (payload.type === "status") {
        setStatus(payload.message);
        return;
      }

      if (payload.type === "partial") {
        setPartial({
          id: "partial",
          speaker: payload.speaker,
          text: payload.text,
          startedAtMs: payload.startedAtMs,
          endedAtMs: payload.endedAtMs,
          final: false
        });
        return;
      }

      if (payload.type === "final") {
        setPartial(null);
        setMessages((current) => [
          ...current,
          {
            id: payload.id,
            speaker: payload.speaker,
            text: payload.text,
            startedAtMs: payload.startedAtMs,
            endedAtMs: payload.endedAtMs,
            final: true
          }
        ]);
        return;
      }

      if (payload.type === "error") {
        setError(payload.message);
      }
    };
  }

  async function stopSession() {
    if (streamRef.current) {
      await streamRef.current.stop();
      streamRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.send(JSON.stringify({ type: "stop" }));
      window.setTimeout(() => socketRef.current?.close(), 150);
      socketRef.current = null;
    }

    setRecording(false);
    setConnected(false);
    setStatus("Stopped");
  }

  async function submitFileTranscription(formData: FormData) {
    setTranscribeBusy(true);
    setError(null);
    setFileTranscript(null);
    try {
      const response = await fetch(`${API_URL}/api/transcribe`, {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as FileTranscriptResponse | { detail: string };
      if (!response.ok) {
        throw new Error("detail" in payload ? payload.detail : "File transcription failed.");
      }
      setFileTranscript(payload as FileTranscriptResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "File transcription failed.");
    } finally {
      setTranscribeBusy(false);
    }
  }

  async function submitTts(formData: FormData) {
    setTtsBusy(true);
    setError(null);
    setTtsResult(null);
    try {
      const response = await fetch(`${API_URL}/api/tts`, {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as TtsResponse | { detail: string };
      if (!response.ok) {
        throw new Error("detail" in payload ? payload.detail : "TTS generation failed.");
      }
      const ttsPayload = payload as TtsResponse;
      setTtsResult({
        ...ttsPayload,
        audioUrl: `${API_URL}${ttsPayload.audioUrl}`,
        downloadUrl: `${API_URL}${ttsPayload.downloadUrl}`
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "TTS generation failed.");
    } finally {
      setTtsBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Speech Workspace</p>
          <h1>Live diarization, batch transcription, and VibeVoice document speech.</h1>
          <p className="hero-text">
            Whisper and VibeVoice-ASR both run through the same custom chunking pipeline for live
            mode. Batch upload and VibeVoice voice-cloned TTS are exposed as separate workflows.
          </p>
          <div className="hero-actions">
            <div className="status-pill live">{status}</div>
            <div className="status-pill">{asrModels.length} ASR models wired</div>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <div className="metrics-grid">
          <article>
            <span>Live transport</span>
            <strong>200 ms PCM</strong>
          </article>
          <article>
            <span>ASR options</span>
            <strong>Whisper / VibeVoice</strong>
          </article>
          <article>
            <span>TTS output</span>
            <strong>Clone + download</strong>
          </article>
        </div>
      </section>

      <nav className="mode-tabs">
        <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>
          Live
        </button>
        <button
          className={mode === "transcribe" ? "active" : ""}
          onClick={() => setMode("transcribe")}
        >
          File Transcription
        </button>
        <button className={mode === "tts" ? "active" : ""} onClick={() => setMode("tts")}>
          TTS + Voice Clone
        </button>
      </nav>

      {mode === "live" ? (
        <section className="workspace-grid">
          <section className="panel controls-panel">
            <div className="panel-heading">
              <p className="eyebrow">Live Console</p>
              <h2>Single-mic transcription with speaker separation</h2>
            </div>
            <label className="field">
              <span>ASR model</span>
              <select value={liveModel} onChange={(event) => setLiveModel(event.target.value)}>
                {asrModels.map((model) => (
                  <option key={model.id} value={model.id} disabled={!model.available}>
                    {model.label}{model.available ? "" : " (Unavailable)"}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              Both ASR models use backend VAD, overlap windows, and final diarization commits.
            </p>
            {!recording ? (
              <button className="record-button" onClick={() => void startSession()}>
                Start Recording
              </button>
            ) : (
              <button className="record-button stop" onClick={() => void stopSession()}>
                Stop Recording
              </button>
            )}
          </section>

          <section className="panel transcript-panel">
            <div className="conversation-header">
              <div>
                <p className="eyebrow">Transcript</p>
                <h2>Speaker-separated live feed</h2>
              </div>
            </div>
            <div className="conversation-stream">
              {transcriptFeed.length === 0 ? (
                <div className="empty-state">
                  <p>Press record and start speaking near the microphone.</p>
                  <span>Final speaker-labeled segments will land left and right.</span>
                </div>
              ) : null}

              {transcriptFeed.map((entry) => {
                const speaker = speakerView(entry.speaker);
                return (
                  <article
                    className={`bubble-row ${speaker.side} ${entry.final ? "final" : "partial"}`}
                    key={`${entry.id}-${entry.endedAtMs}`}
                  >
                    <div className="bubble-meta">
                      <span>{speaker.label}</span>
                      <span>{formatClock(entry.startedAtMs)}</span>
                    </div>
                    <div className="bubble">{entry.text}</div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      ) : null}

      {mode === "transcribe" ? (
        <section className="workspace-grid">
          <section className="panel controls-panel">
            <div className="panel-heading">
              <p className="eyebrow">Upload Audio</p>
              <h2>Batch transcription with diarization</h2>
            </div>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                form.set("model", fileModel);
                void submitFileTranscription(form);
              }}
            >
              <label className="field">
                <span>ASR model</span>
                <select value={fileModel} onChange={(event) => setFileModel(event.target.value)}>
                  {asrModels.map((model) => (
                    <option key={model.id} value={model.id} disabled={!model.available}>
                      {model.label}{model.available ? "" : " (Unavailable)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Audio file</span>
                <input type="file" name="file" accept="audio/*" required />
              </label>
              <button className="record-button" disabled={transcribeBusy}>
                {transcribeBusy ? "Transcribing..." : "Transcribe File"}
              </button>
            </form>
          </section>

          <section className="panel transcript-panel">
            <div className="conversation-header">
              <div>
                <p className="eyebrow">Transcript Output</p>
                <h2>Uploaded file result</h2>
              </div>
            </div>
            {fileTranscript ? (
              <div className="stack">
                <div className="summary-card">
                  <span>Model</span>
                  <strong>{fileTranscript.model}</strong>
                  <p>{fileTranscript.text}</p>
                </div>
                <div className="conversation-stream compact">
                  {fileTranscript.segments.map((segment, index) => {
                    const speaker = speakerView(segment.speaker);
                    return (
                      <article
                        className={`bubble-row ${speaker.side} final`}
                        key={`${segment.startedAtMs}-${index}`}
                      >
                        <div className="bubble-meta">
                          <span>{speaker.label}</span>
                          <span>{formatClock(segment.startedAtMs)}</span>
                        </div>
                        <div className="bubble">{segment.text}</div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <p>Upload an audio file to run full transcription and diarization.</p>
                <span>The backend returns both the merged text and speaker-attributed segments.</span>
              </div>
            )}
          </section>
        </section>
      ) : null}

      {mode === "tts" ? (
        <section className="workspace-grid">
          <section className="panel controls-panel">
            <div className="panel-heading">
              <p className="eyebrow">Document To Speech</p>
              <h2>VibeVoice TTS with reference voice cloning</h2>
            </div>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void submitTts(new FormData(event.currentTarget));
              }}
            >
              <label className="field">
                <span>Document</span>
                <input type="file" name="document" accept=".txt,.pdf,.docx" required />
              </label>
              <label className="field">
                <span>Voice sample</span>
                <input type="file" name="voice_sample" accept="audio/*" required />
              </label>
              <label className="field">
                <span>Speaker label</span>
                <input type="text" name="speaker_name" placeholder="Narrator" defaultValue="Narrator" />
              </label>
              <button className="record-button" disabled={ttsBusy}>
                {ttsBusy ? "Generating..." : "Generate TTS Audio"}
              </button>
            </form>
          </section>

          <section className="panel transcript-panel">
            <div className="conversation-header">
              <div>
                <p className="eyebrow">Synthesis Output</p>
                <h2>Preview, play, and download</h2>
              </div>
            </div>
            {ttsResult ? (
              <div className="stack">
                <div className="summary-card">
                  <span>Speaker</span>
                  <strong>{ttsResult.speaker}</strong>
                  <p>{ttsResult.textPreview}</p>
                </div>
                <audio controls src={ttsResult.audioUrl} className="audio-player" />
                <a className="download-link" href={ttsResult.downloadUrl}>
                  Download WAV
                </a>
              </div>
            ) : (
              <div className="empty-state">
                <p>Upload a document and a reference voice sample.</p>
                <span>The backend extracts text, calls VibeVoice TTS, and returns a playable WAV.</span>
              </div>
            )}
          </section>
        </section>
      ) : null}
    </main>
  );
}
