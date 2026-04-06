from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import soundfile as sf


def load_audio_bytes(content: bytes, target_sample_rate: int) -> np.ndarray:
    audio, sample_rate = sf.read(io.BytesIO(content), always_2d=False, dtype="float32")
    return normalize_audio(audio, sample_rate, target_sample_rate)


def load_audio_path(path: Path, target_sample_rate: int) -> np.ndarray:
    audio, sample_rate = sf.read(str(path), always_2d=False, dtype="float32")
    return normalize_audio(audio, sample_rate, target_sample_rate)


def normalize_audio(audio: np.ndarray, sample_rate: int, target_sample_rate: int) -> np.ndarray:
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sample_rate == target_sample_rate:
        return audio.astype(np.float32)
    duration = len(audio) / sample_rate
    old_times = np.linspace(0, duration, num=len(audio), endpoint=False)
    new_length = int(duration * target_sample_rate)
    new_times = np.linspace(0, duration, num=new_length, endpoint=False)
    return np.interp(new_times, old_times, audio).astype(np.float32)
