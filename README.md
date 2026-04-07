# VibeVoice Live Transcription, Diarization, and Voice Cloning Workspace

This repository is intended to provide a baseline for hands-on practice with live transcription, batch transcription, speaker diarization, voice cloning, and document-to-speech workflows.

It combines a React frontend and a Python backend into a single workspace so you can experiment with:

- live single-microphone transcription with speaker-separated output
- model selection between Whisper and VibeVoice-ASR
- uploaded audio transcription with diarization
- document-to-speech generation with VibeVoice-based voice cloning
- low-latency frontend/backend streaming over WebSockets for live use cases

## What This Repository Provides

The application is organized around three user-facing workflows:

1. Live transcription
   The browser captures microphone audio, streams PCM frames to the backend over WebSockets, and renders live transcript updates in a chat-style UI with speaker attribution.

2. Batch transcription
   The user uploads an audio file over HTTP(S), selects an ASR model, and receives a full transcript plus diarized segments.

3. TTS and voice cloning
   The user uploads a document and a reference voice sample over HTTP(S). The backend extracts text from the document, runs VibeVoice-based speech generation, and returns audio for playback and download.

## Core Stack

- React + Vite frontend
- FastAPI backend
- WebSocket transport for live audio streaming
- HTTP(S) endpoints for file upload and generated asset delivery
- `faster-whisper` for low-latency ASR
- `VibeVoice-ASR` adapter for alternate transcription
- `pyannote.audio` for diarization
- `webrtcvad` for speech activity detection
- VibeVoice long-form TTS adapter for document-to-speech and voice cloning

## Supported Features

### Live transcription and diarization

- single microphone capture in the browser
- backend-side chunking and segmentation
- rolling partial transcript updates
- final speaker-attributed transcript commits
- WhatsApp-style left/right rendering for alternating speakers

### Audio file transcription

- upload an audio file
- choose Whisper or VibeVoice-ASR
- receive merged transcript text
- receive speaker-attributed segments

### TTS with voice cloning

- upload `.txt`, `.pdf`, or `.docx`
- upload a reference voice sample
- generate speech audio with a cloned voice profile
- play generated audio in the frontend
- download generated audio from the backend

## Model Strategy

This repository deliberately does not assume that Whisper or VibeVoice-ASR natively provide a complete browser-live diarization workflow.

Instead, live behavior is built with custom application logic:

- the browser captures raw PCM
- the backend performs VAD-based segmentation
- the backend runs incremental ASR on rolling windows
- the backend finalizes committed segments
- diarization is applied to committed windows and aligned with ASR output

This keeps the live pipeline explicit and lets the same orchestration layer work across multiple ASR backends.

For TTS, the repository uses a VibeVoice-style long-form synthesis path for voice cloning. The lightweight realtime VibeVoice release is not treated here as a generic arbitrary voice-cloning API.

## End-to-End Flow

### 1. Live transcription flow

1. The user opens the frontend and selects an ASR model.
2. The browser captures microphone audio through `AudioWorklet`.
3. Audio is converted to mono 16 kHz PCM.
4. The frontend sends binary PCM chunks to the backend over a WebSocket connection.
5. The backend appends incoming audio to a session buffer.
6. WebRTC VAD detects speech activity on short frames.
7. While speech is active, the backend runs rolling partial ASR on overlapping windows.
8. When the backend decides a speech segment is complete, it runs final ASR plus diarization on that committed window.
9. The backend assigns speaker labels to ASR segments.
10. The frontend renders speaker-separated transcript bubbles in near real time.

### 2. Audio upload transcription flow

1. The user uploads an audio file over HTTP(S).
2. The backend decodes and normalizes audio into a mono waveform.
3. The selected ASR provider transcribes the file.
4. Diarization runs on the same waveform.
5. The backend returns merged text and structured diarized segments as JSON.
6. The frontend displays the results in a readable transcript layout.

### 3. Document-to-speech flow

1. The user uploads a document and a reference voice sample over HTTP(S).
2. The backend extracts text from the document.
3. The backend passes text and the reference sample into the VibeVoice TTS adapter.
4. Generated audio is stored server-side.
5. The backend returns playback and download URLs.
6. The frontend plays the generated audio and exposes a direct download action.

## Transport and Data Flow

### WebSockets for live transcription

WebSockets are used between the frontend and backend for the live microphone workflow because live audio is a bidirectional, low-latency stream.

WebSocket responsibilities in this repository:

- frontend sends raw PCM binary audio chunks
- backend sends session-ready events
- backend sends live status updates
- backend sends partial transcript events
- backend sends final speaker-attributed transcript events

Why WebSockets are used for live mode:

- lower overhead than repeated HTTP requests
- natural fit for continuous audio streaming
- immediate server-to-client partial transcript updates
- easier stateful session management for ongoing live transcription

### HTTP(S) for batch and asset workflows

HTTP(S) is used for non-live workflows:

- uploading audio files for transcription
- uploading documents and reference audio for TTS
- returning JSON results
- serving generated audio files for playback and download

Why HTTP(S) is used here:

- uploads are request/response oriented
- browser form handling is straightforward
- generated assets map naturally to URL-based retrieval
- these operations are not latency-critical in the same way as live audio streaming

## Chunking and Segmentation Logic

The live pipeline is tuned around a practical balance between latency and recognition quality.

### Frontend chunking

- microphone audio is captured continuously
- audio is downsampled to 16 kHz mono PCM
- the frontend batches outbound audio into 200 ms packets

Why 200 ms:

- 20 ms packets are too chatty for transport
- 500 ms or larger packets add user-visible lag
- 200 ms is a workable middle point for live UI responsiveness

### Backend VAD logic

- backend VAD runs on 20 ms frames
- the backend opens a speech segment on the first voiced frame
- the backend tracks silence and voiced duration to decide when to commit a segment

### Partial transcript logic

- partial ASR runs every 400 ms while speech remains active
- the partial decode uses an overlapping rolling window of about 2.4 seconds

Why overlapping windows matter:

- tiny isolated chunks lose too much context
- overlapping windows stabilize partial text
- phrase continuity improves without waiting for full utterances

### Final commit logic

The backend finalizes a segment when one of these conditions is met:

- silence crosses the configured commit threshold
- active speech grows beyond the configured maximum segment duration

This prevents:

- excessive buffering on long turns
- repeated truncation of sentence endings
- unstable diarization on windows that are too small

## Considerations and Tradeoffs

### Latency vs accuracy

This repository is intentionally built around a tradeoff:

- shorter chunks and earlier commits reduce latency
- larger context windows and later commits improve accuracy

The current defaults aim for a balanced baseline rather than an extreme optimization in one direction.

### Diarization quality

Speaker diarization is more stable when applied to committed speech windows rather than tiny live packets. That is why partial transcript text may appear before final speaker assignment is fully stabilized.

### Model abstraction

Whisper and VibeVoice-ASR are routed through a shared adapter layer so the rest of the application does not depend on one model’s exact API shape. This makes experiments easier and keeps the orchestration logic reusable.

### TTS constraints

Voice cloning depends on the availability of a compatible VibeVoice repository path and model path in the local environment. The exact cloning quality depends heavily on:

- the quality of the reference sample
- the underlying model checkpoint
- the document length and text cleanliness

## Repository Structure

```text
src/                   React frontend
public/                Browser audio worklet
backend/app/           FastAPI app, ASR adapters, streaming pipeline, utilities
backend/requirements.txt
ARCHITECTURE.md        Additional notes on chunking and flow
```

## Local Setup

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

## Environment Configuration

### Diarization

Set `HF_TOKEN` if you want real pyannote diarization. Without it, the app can still transcribe, but speaker labels may fall back to `UNKNOWN`.

### VibeVoice-ASR

Set `VIBEVOICE_ASR_MODEL_ID` to the Hugging Face checkpoint or compatible model identifier you want the VibeVoice-ASR adapter to load.

### VibeVoice TTS

Set these variables for the document-to-speech and voice cloning flow:

```bash
export VIBEVOICE_REPO_PATH=/path/to/VibeVoice
export VIBEVOICE_TTS_MODEL_PATH=/path/to/vibevoice-1_5b
```

## Operational Notes

- Live transcription uses WebSockets. File transcription and TTS use HTTP(S).
- Generated TTS files are stored on the backend and served back to the client.
- Supported document types for TTS input are `.txt`, `.pdf`, and `.docx`.
- This repository is a baseline and is intended to be extended, tuned, and hardened for your own workloads.

## Recommended Next Steps

- install frontend and backend dependencies
- configure the required model environment variables
- validate the VibeVoice-ASR checkpoint you want to use
- validate the VibeVoice TTS repository and checkpoint pair
- tune chunking parameters for your actual latency and accuracy target
