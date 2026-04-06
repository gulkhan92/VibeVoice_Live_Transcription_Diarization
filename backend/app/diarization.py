from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np


@dataclass
class SpeakerTurn:
    speaker: str
    start_s: float
    end_s: float


class SpeakerDiarizer:
    def __init__(self, model_name: str, hf_token: str | None, device: str) -> None:
        self.pipeline = None
        if hf_token:
            from pyannote.audio import Pipeline

            self.pipeline = Pipeline.from_pretrained(model_name, use_auth_token=hf_token)
            self.pipeline.to(device)

    def diarize(self, audio: np.ndarray, sample_rate: int) -> list[SpeakerTurn]:
        if self.pipeline is None:
            return [SpeakerTurn(speaker="UNKNOWN", start_s=0.0, end_s=len(audio) / sample_rate)]

        diarization = self.pipeline({"waveform": audio[None, :], "sample_rate": sample_rate})
        turns: list[SpeakerTurn] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            turns.append(
                SpeakerTurn(speaker=speaker, start_s=float(turn.start), end_s=float(turn.end))
            )
        return turns

    @staticmethod
    def speaker_for_span(turns: Iterable[SpeakerTurn], started_at_s: float, ended_at_s: float) -> str:
        midpoint = (started_at_s + ended_at_s) / 2
        for turn in turns:
            if turn.start_s <= midpoint <= turn.end_s:
                return turn.speaker
        return "UNKNOWN"
