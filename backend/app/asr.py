from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from faster_whisper import WhisperModel


@dataclass
class ASRSegment:
    start_s: float
    end_s: float
    text: str


class WhisperStreamingASR:
    def __init__(self, model_size: str, device: str) -> None:
        compute_type = "int8" if device == "cpu" else "float16"
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)

    def transcribe(self, audio: np.ndarray, sample_rate: int) -> list[ASRSegment]:
        segments, _ = self.model.transcribe(
            audio,
            beam_size=1,
            best_of=1,
            language="en",
            vad_filter=False,
            condition_on_previous_text=False,
            word_timestamps=False,
        )
        return [
            ASRSegment(start_s=float(segment.start), end_s=float(segment.end), text=segment.text.strip())
            for segment in segments
            if segment.text.strip()
        ]
