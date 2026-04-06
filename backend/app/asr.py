from __future__ import annotations

from dataclasses import dataclass
import importlib
import tempfile
from pathlib import Path
import subprocess
from typing import Protocol

import numpy as np
from faster_whisper import WhisperModel


@dataclass
class ASRSegment:
    start_s: float
    end_s: float
    text: str


class ASRProvider(Protocol):
    name: str

    def transcribe(self, audio: np.ndarray, sample_rate: int) -> list[ASRSegment]:
        ...


class WhisperASRProvider:
    name = "whisper"

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


class VibeVoiceASRProvider:
    name = "vibevoice_asr"

    def __init__(self, model_id: str, device: str) -> None:
        self.model_id = model_id
        self.device = device
        self.pipeline = self._load_pipeline()

    def _load_pipeline(self):
        try:
            transformers = importlib.import_module("transformers")
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "transformers is required for VibeVoice-ASR. Install backend requirements first."
            ) from exc

        device = 0 if self.device != "cpu" else -1
        try:
            return transformers.pipeline(
                task="automatic-speech-recognition",
                model=self.model_id,
                device=device,
                return_timestamps=True,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Unable to load VibeVoice-ASR model '{self.model_id}'. Set VIBEVOICE_ASR_MODEL_ID "
                "to a compatible checkpoint or install the matching inference package."
            ) from exc

    def transcribe(self, audio: np.ndarray, sample_rate: int) -> list[ASRSegment]:
        result = self.pipeline({"raw": audio.astype(np.float32), "sampling_rate": sample_rate})
        chunks = result.get("chunks")
        if not chunks:
            text = str(result.get("text", "")).strip()
            if not text:
                return []
            return [ASRSegment(start_s=0.0, end_s=len(audio) / sample_rate, text=text)]

        output: list[ASRSegment] = []
        for chunk in chunks:
            timestamp = chunk.get("timestamp") or (0.0, len(audio) / sample_rate)
            text = str(chunk.get("text", "")).strip()
            if not text:
                continue
            start_s = float(timestamp[0] or 0.0)
            end_s = float(timestamp[1] or start_s)
            output.append(ASRSegment(start_s=start_s, end_s=end_s, text=text))
        return output


class VibeVoiceTTSProvider:
    def __init__(self, repo_path: str | None, model_path: str | None, python_bin: str) -> None:
        self.repo_path = Path(repo_path).expanduser() if repo_path else None
        self.model_path = model_path
        self.python_bin = python_bin

    def synthesize(
        self,
        text: str,
        voice_sample_path: Path,
        output_path: Path,
        speaker_name: str,
    ) -> None:
        if not self.repo_path or not self.model_path:
            raise RuntimeError(
                "VibeVoice TTS requires VIBEVOICE_REPO_PATH and VIBEVOICE_TTS_MODEL_PATH. "
                "Use the long-form 1.5B/7B VibeVoice model for voice cloning."
            )

        script_path = self.repo_path / "demo" / "inference_from_file.py"
        if not script_path.exists():
            raise RuntimeError(
                f"Cannot find VibeVoice inference script at {script_path}. "
                "Point VIBEVOICE_REPO_PATH at a compatible VibeVoice repository."
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            txt_path = temp_root / "prompt.txt"
            txt_path.write_text(f"{speaker_name}: {text}", encoding="utf-8")
            command = [
                self.python_bin,
                str(script_path),
                "--model_path",
                self.model_path,
                "--txt_path",
                str(txt_path),
                "--speaker_names",
                speaker_name,
                "--ref_audio_paths",
                str(voice_sample_path),
                "--output_path",
                str(output_path),
            ]
            try:
                subprocess.run(
                    command,
                    cwd=str(self.repo_path),
                    check=True,
                    capture_output=True,
                    text=True,
                )
            except subprocess.CalledProcessError as exc:
                raise RuntimeError(exc.stderr.strip() or exc.stdout.strip() or "VibeVoice TTS failed.") from exc


class ModelRegistry:
    def __init__(self, whisper_model_size: str, vibevoice_asr_model_id: str, device: str) -> None:
        self.providers: dict[str, ASRProvider] = {
            "whisper": WhisperASRProvider(whisper_model_size, device),
        }
        self.vibevoice_error: str | None = None
        try:
            self.providers["vibevoice_asr"] = VibeVoiceASRProvider(vibevoice_asr_model_id, device)
        except Exception as exc:
            self.vibevoice_error = str(exc)

    def get(self, model_name: str) -> ASRProvider:
        provider = self.providers.get(model_name)
        if provider is None:
            if model_name == "vibevoice_asr" and self.vibevoice_error:
                raise RuntimeError(self.vibevoice_error)
            raise RuntimeError(f"Unknown ASR model '{model_name}'.")
        return provider

    def list_models(self) -> list[dict[str, str | bool]]:
        return [
            {"id": "whisper", "label": "Whisper", "available": True, "kind": "asr"},
            {
                "id": "vibevoice_asr",
                "label": "VibeVoice-ASR",
                "available": "vibevoice_asr" in self.providers,
                "kind": "asr",
                "note": self.vibevoice_error or "Loaded",
            },
        ]
