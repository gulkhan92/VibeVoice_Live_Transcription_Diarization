# Backend

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Set `HF_TOKEN` if you want real speaker diarization from `pyannote.audio`. Without it, the backend still runs but labels speakers as `UNKNOWN`.

## Run

```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```
