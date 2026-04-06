# VibeVoice Live Transcription & Diarization

React frontend plus FastAPI backend for live transcription and single-microphone speaker diarization.

## Stack

- React + Vite frontend
- FastAPI WebSocket backend
- `AudioWorklet` microphone capture
- `faster-whisper` for ASR
- `pyannote.audio` for diarization
- `webrtcvad` for speech boundary detection

## VibeVoice note

Microsoft's repository now includes `VibeVoice-ASR`, which targets long-form structured ASR with speaker attribution. This app is implemented with a streaming-oriented backend (`faster-whisper` + `pyannote.audio`) because the browser live transcription path needs incremental partial decoding, short rolling windows, and low-latency WebSocket updates.

The backend is structured so you can later replace the ASR layer with VibeVoice-ASR if you want to build a custom incremental wrapper around its inference API.

## Run

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Notes

- Real diarization requires a Hugging Face token with access to the pyannote model.
- If `HF_TOKEN` is not set, the app still transcribes live audio but speaker labels fall back to `UNKNOWN`.
- The chunking and transport strategy is documented in `ARCHITECTURE.md`.
