# Backend

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Set `HF_TOKEN` if you want real speaker diarization from `pyannote.audio`. Without it, the backend still runs but labels speakers as `UNKNOWN`.

Set `VIBEVOICE_ASR_MODEL_ID` if you want the VibeVoice-ASR dropdown entry to load a specific Hugging Face checkpoint.

Set these for VibeVoice voice cloning:

```bash
export VIBEVOICE_REPO_PATH=/path/to/VibeVoice
export VIBEVOICE_TTS_MODEL_PATH=/path/to/vibevoice-1_5b
```

## Run

```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```
