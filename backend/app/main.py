from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState

from .config import settings
from .pipeline import StreamingPipeline
from .schemas import StartMessage

app = FastAPI(title="Live Transcription & Diarization API")

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


@app.websocket("/ws/live")
async def live_transcription(websocket: WebSocket) -> None:
    await websocket.accept()
    pipeline = StreamingPipeline(websocket, settings)

    try:
        start_message = await websocket.receive_json()
        StartMessage.model_validate(start_message)
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
        await pipeline.flush()
    finally:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.close()
