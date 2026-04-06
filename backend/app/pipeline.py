from __future__ import annotations

from dataclasses import dataclass
import json
import uuid

import numpy as np
import webrtcvad
from fastapi import WebSocket

from .asr import ASRProvider
from .config import Settings
from .diarization import SpeakerDiarizer


@dataclass
class SegmentWindow:
    start_sample: int
    end_sample: int


class StreamingPipeline:
    def __init__(
        self,
        websocket: WebSocket,
        settings: Settings,
        asr_provider: ASRProvider,
    ) -> None:
        self.websocket = websocket
        self.settings = settings
        self.asr_provider = asr_provider
        self.session_id = str(uuid.uuid4())
        self.diarizer = SpeakerDiarizer(
            settings.diarization_model, settings.hf_token, settings.device
        )
        self.vad = webrtcvad.Vad(2)
        self.samples = np.array([], dtype=np.int16)
        self.speech_active = False
        self.segment_start_sample = 0
        self.last_speech_sample = 0
        self.last_partial_emit_sample = 0

    async def start(self) -> None:
        await self.emit({"type": "session.ready", "sessionId": self.session_id})
        await self.emit(
            {
                "type": "status",
                "state": "idle",
                "message": f"Microphone connected. Waiting for speech with {self.asr_provider.name}."
            }
        )

    async def receive_audio(self, chunk: bytes) -> None:
        new_samples = np.frombuffer(chunk, dtype="<i2")
        if new_samples.size == 0:
            return

        offset = len(self.samples)
        self.samples = np.concatenate([self.samples, new_samples])
        frame_size = int(self.settings.sample_rate * self.settings.frame_ms / 1000)

        for frame_start in range(0, len(new_samples) - frame_size + 1, frame_size):
            frame = new_samples[frame_start : frame_start + frame_size]
            absolute_start = offset + frame_start
            if self.vad.is_speech(frame.tobytes(), self.settings.sample_rate):
                if not self.speech_active:
                    self.speech_active = True
                    self.segment_start_sample = absolute_start
                    await self.emit(
                        {
                            "type": "status",
                            "state": "listening",
                            "message": "Speech detected. Streaming partial transcript."
                        }
                    )
                self.last_speech_sample = absolute_start + frame_size

        if self.speech_active:
            await self.maybe_emit_partial()
            await self.maybe_commit_segment()

    async def maybe_emit_partial(self) -> None:
        hop_samples = int(self.settings.sample_rate * self.settings.partial_hop_ms / 1000)
        if len(self.samples) - self.last_partial_emit_sample < hop_samples:
            return

        start = max(
            self.segment_start_sample,
            len(self.samples) - int(self.settings.sample_rate * self.settings.partial_window_ms / 1000),
        )
        window = self.samples[start:]
        if window.size == 0:
            return

        segments = self.asr_provider.transcribe(
            window.astype(np.float32) / 32768.0, self.settings.sample_rate
        )
        text = " ".join(segment.text for segment in segments).strip()
        if not text:
            return

        self.last_partial_emit_sample = len(self.samples)
        await self.emit(
            {
                "type": "partial",
                "speaker": "UNKNOWN",
                "text": text,
                "startedAtMs": int(start * 1000 / self.settings.sample_rate),
                "endedAtMs": int(len(self.samples) * 1000 / self.settings.sample_rate),
            }
        )

    async def maybe_commit_segment(self) -> None:
        silence_samples = int(self.settings.sample_rate * self.settings.silence_to_commit_ms / 1000)
        min_segment_samples = int(self.settings.sample_rate * self.settings.min_segment_ms / 1000)
        max_segment_samples = int(self.settings.sample_rate * self.settings.max_segment_ms / 1000)
        segment_length = len(self.samples) - self.segment_start_sample
        silence_length = len(self.samples) - self.last_speech_sample

        if segment_length < min_segment_samples:
            return

        should_commit = silence_length >= silence_samples or segment_length >= max_segment_samples
        if not should_commit:
            return

        window = SegmentWindow(
            start_sample=self.segment_start_sample,
            end_sample=min(len(self.samples), max(self.last_speech_sample, self.segment_start_sample + 1)),
        )
        self.speech_active = False
        self.segment_start_sample = len(self.samples)

        await self.commit_window(window)
        await self.emit(
            {
                "type": "status",
                "state": "processing",
                "message": "Committed segment. Listening for the next speaker turn."
            }
        )

    async def commit_window(self, window: SegmentWindow) -> None:
        audio = self.samples[window.start_sample : window.end_sample]
        if audio.size == 0:
            return

        waveform = audio.astype(np.float32) / 32768.0
        diarization_turns = self.diarizer.diarize(waveform, self.settings.sample_rate)
        segments = self.asr_provider.transcribe(waveform, self.settings.sample_rate)

        for segment in segments:
            speaker = self.diarizer.speaker_for_span(
                diarization_turns, segment.start_s, segment.end_s
            )
            await self.emit(
                {
                    "type": "final",
                    "id": str(uuid.uuid4()),
                    "speaker": speaker,
                    "text": segment.text,
                    "startedAtMs": int(
                        (window.start_sample / self.settings.sample_rate + segment.start_s) * 1000
                    ),
                    "endedAtMs": int(
                        (window.start_sample / self.settings.sample_rate + segment.end_s) * 1000
                    ),
                }
            )

    async def flush(self) -> None:
        if self.speech_active:
            await self.commit_window(
                SegmentWindow(self.segment_start_sample, len(self.samples))
            )

    async def emit(self, payload: dict) -> None:
        await self.websocket.send_text(json.dumps(payload))
