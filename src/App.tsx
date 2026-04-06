import { useEffect, useMemo, useRef, useState } from "react";
import { startMicrophoneStream, type AudioStreamController } from "./audio/workletClient";
import type { ServerEvent, TranscriptMessage } from "./types";

const WS_URL = "ws://127.0.0.1:8000/ws/live";

const speakerPalette: Record<string, { side: "left" | "right"; label: string }> = {
  SPEAKER_00: { side: "left", label: "Speaker A" },
  SPEAKER_01: { side: "right", label: "Speaker B" },
  UNKNOWN: { side: "left", label: "Detecting" }
};

function formatClock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

export default function App() {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [partial, setPartial] = useState<TranscriptMessage | null>(null);
  const [status, setStatus] = useState("Ready");
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<AudioStreamController | null>(null);

  const transcriptFeed = useMemo(
    () => (partial ? [...messages, partial] : messages),
    [messages, partial],
  );

  useEffect(() => {
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
          channels: 1
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
    socketRef.current?.send(JSON.stringify({ type: "stop" }));
    socketRef.current?.close();
    socketRef.current = null;

    if (streamRef.current) {
      await streamRef.current.stop();
      streamRef.current = null;
    }

    setRecording(false);
    setConnected(false);
    setStatus("Stopped");
  }

  return (
    <main className="shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Live AI Transcript Console</p>
          <h1>Single-mic speaker diarization with low-latency streaming.</h1>
          <p className="hero-text">
            PCM audio is streamed in 200 ms packets, decoded incrementally on the backend,
            and committed into left/right speaker threads as confidence stabilizes.
          </p>
          <div className="hero-actions">
            {!recording ? (
              <button className="record-button" onClick={() => void startSession()}>
                Start Recording
              </button>
            ) : (
              <button className="record-button stop" onClick={() => void stopSession()}>
                Stop Recording
              </button>
            )}
            <div className={`status-pill ${connected ? "live" : ""}`}>{status}</div>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <div className="metrics-grid">
          <article>
            <span>Transport</span>
            <strong>200 ms PCM</strong>
          </article>
          <article>
            <span>Partial hop</span>
            <strong>400 ms</strong>
          </article>
          <article>
            <span>Commit rule</span>
            <strong>Silence + overlap</strong>
          </article>
        </div>
      </section>

      <section className="conversation-card">
        <div className="conversation-header">
          <div>
            <p className="eyebrow">Transcript</p>
            <h2>Speaker-separated live feed</h2>
          </div>
          <p className="conversation-note">
            Speaker A renders left. Speaker B renders right. Interim text stays translucent
            until the backend commits a final segment.
          </p>
        </div>

        <div className="conversation-stream">
          {transcriptFeed.length === 0 ? (
            <div className="empty-state">
              <p>Press record and start speaking near the microphone.</p>
              <span>The feed will populate as partial and final transcript segments arrive.</span>
            </div>
          ) : null}

          {transcriptFeed.map((entry) => {
            const speaker = speakerPalette[entry.speaker] ?? {
              side: "left" as const,
              label: entry.speaker
            };

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
    </main>
  );
}
