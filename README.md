# VibeVoice Live Transcription & Diarization

React frontend plus FastAPI backend for:

- live transcription with speaker diarization
- uploaded audio transcription
- document-to-speech generation with VibeVoice voice cloning

## Stack

- React + Vite frontend
- FastAPI WebSocket backend
- `AudioWorklet` microphone capture
- `faster-whisper` for ASR
- `VibeVoice-ASR` adapter for alternate transcription
- `pyannote.audio` for diarization
- `webrtcvad` for speech boundary detection
- VibeVoice long-form TTS adapter for document-to-speech

## Model support

The app includes two ASR paths:

- `Whisper`: default low-latency live transcription path
- `VibeVoice-ASR`: integrated as an alternate ASR provider and wrapped in the same custom live chunking pipeline

Neither model is used as a native live API. The app builds live behavior itself with:

- browser PCM streaming
- backend VAD segmentation
- rolling partial decode windows
- final decode plus diarization on committed windows

For TTS, this app targets the long-form VibeVoice model path for voice cloning. The current official realtime VibeVoice release is optimized for low-latency TTS, but its published preset-based path does not support arbitrary voice cloning.

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
- `VIBEVOICE_ASR_MODEL_ID` controls the Hugging Face checkpoint used for the VibeVoice-ASR adapter.
- `VIBEVOICE_REPO_PATH` and `VIBEVOICE_TTS_MODEL_PATH` are required for VibeVoice TTS voice cloning.
- Supported TTS input documents are `.txt`, `.pdf`, and `.docx`.
- The chunking and transport strategy is documented in `ARCHITECTURE.md`.
