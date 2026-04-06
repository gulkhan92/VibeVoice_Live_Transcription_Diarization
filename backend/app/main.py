from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.websockets import WebSocketState

from .asr import ModelRegistry, VibeVoiceTTSProvider
from .audio import load_audio_bytes
from .config import settings
from .documents import extract_text_from_document
from .diarization import SpeakerDiarizer
from .pipeline import StreamingPipeline
from .schemas import StartMessage
from .storage import GENERATED_DIR, UPLOADS_DIR, ensure_storage, unique_path

ensure_storage()

app = FastAPI(title="Live Transcription & Diarization API")
registry = ModelRegistry(settings.whisper_model_size, settings.vibevoice_asr_model_id, settings.device)
diarizer = SpeakerDiarizer(settings.diarization_model, settings.hf_token, settings.device)
tts_provider = VibeVoiceTTSProvider(
    settings.vibevoice_repo_path,
    settings.vibevoice_tts_model_path,
    settings.python_bin,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/models")
def list_models() -> dict[str, list[dict[str, str | bool]]]:
    return {"models": registry.list_models()}


@app.post("/api/transcribe")
async def transcribe_file(
    file: UploadFile = File(...),
    model: str = Form("whisper"),
) -> dict:
    provider = registry.get(model)
    content = await file.read()
    audio = load_audio_bytes(content, settings.sample_rate)
    segments = provider.transcribe(audio, settings.sample_rate)
    turns = diarizer.diarize(audio, settings.sample_rate)

    items = []
    for segment in segments:
        speaker = diarizer.speaker_for_span(turns, segment.start_s, segment.end_s)
        items.append(
            {
                "speaker": speaker,
                "text": segment.text,
                "startedAtMs": int(segment.start_s * 1000),
                "endedAtMs": int(segment.end_s * 1000),
            }
        )

    return {
        "model": provider.name,
        "text": " ".join(item["text"] for item in items).strip(),
        "segments": items,
    }


@app.post("/api/tts")
async def generate_tts(
    document: UploadFile = File(...),
    voice_sample: UploadFile = File(...),
    speaker_name: str = Form("Narrator"),
) -> dict:
    document_path = unique_path(UPLOADS_DIR, Path(document.filename or "document.txt").suffix or ".txt")
    voice_path = unique_path(UPLOADS_DIR, Path(voice_sample.filename or "voice.wav").suffix or ".wav")
    output_path = unique_path(GENERATED_DIR, ".wav")

    document_path.write_bytes(await document.read())
    voice_path.write_bytes(await voice_sample.read())

    text = extract_text_from_document(document_path)
    if not text.strip():
        raise HTTPException(status_code=400, detail="The uploaded document did not contain readable text.")

    try:
        tts_provider.synthesize(text, voice_path, output_path, speaker_name=speaker_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "speaker": speaker_name,
        "textPreview": text[:1000],
        "audioUrl": f"/api/media/{output_path.name}",
        "downloadUrl": f"/api/media/{output_path.name}?download=1",
    }


@app.get("/api/media/{file_name}")
def get_media(file_name: str, download: int = 0):
    path = GENERATED_DIR / file_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    media_type = "audio/wav"
    filename = path.name if download else None
    return FileResponse(path, media_type=media_type, filename=filename)


@app.websocket("/ws/live")
async def live_transcription(websocket: WebSocket) -> None:
    await websocket.accept()
    pipeline: StreamingPipeline | None = None

    try:
        start_message = await websocket.receive_json()
        parsed = StartMessage.model_validate(start_message)
        provider = registry.get(parsed.model)
        pipeline = StreamingPipeline(websocket, settings, provider)
        await pipeline.start()

        while True:
            message = await websocket.receive()
            payload = message.get("bytes")
            if payload:
                await pipeline.receive_audio(payload)
                continue

            text = message.get("text")
            if text and '"type":"stop"' in text.replace(" ", ""):
                await pipeline.flush()
                break
    except WebSocketDisconnect:
        if pipeline:
            await pipeline.flush()
    except RuntimeError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
    finally:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.close()
