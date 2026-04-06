from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    sample_rate: int = 16000
    channels: int = 1
    frame_ms: int = 20
    transport_chunk_ms: int = 200
    partial_hop_ms: int = 400
    partial_window_ms: int = 2400
    max_segment_ms: int = 5200
    min_segment_ms: int = 1200
    silence_to_commit_ms: int = 480
    whisper_model_size: str = os.getenv("WHISPER_MODEL_SIZE", "small.en")
    diarization_model: str = os.getenv(
        "PYANNOTE_DIARIZATION_MODEL", "pyannote/speaker-diarization-3.1"
    )
    hf_token: str | None = os.getenv("HF_TOKEN")
    device: str = os.getenv("TORCH_DEVICE", "cpu")


settings = Settings()
