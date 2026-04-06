# Live Transcription & Diarization Architecture

## Why this pipeline

The browser sends raw 16 kHz mono PCM instead of `MediaRecorder` blobs because low-latency diarization needs deterministic frame boundaries and avoids Opus encode/decode delay. The backend owns VAD, segmentation, transcription, and diarization so chunking policy can be tuned once and kept consistent.

This design is optimized for:

- low transport latency
- stable partial text
- better speaker attribution on final text
- compatibility with a single shared microphone

## Chunking strategy

### Frontend capture

- Capture with `AudioWorklet` from the browser microphone.
- Downsample to 16 kHz mono PCM.
- Batch into 200 ms packets before sending over WebSocket.

Why 200 ms:

- 20 ms frames are ideal for VAD, but sending each frame individually creates too much WebSocket overhead.
- 500 ms or 1000 ms packets add too much user-visible lag.
- 200 ms is a practical middle point: low enough for quick partials, large enough for efficient transport.

### Backend VAD and segmentation

- Run WebRTC VAD on 20 ms frames.
- Open a speech segment on first voiced frame.
- Emit partial transcription every 400 ms while speech is active.
- Commit the speech segment when either:
  - silence reaches about 480 ms
  - active speech reaches about 5.2 seconds

Why this commit rule:

- waiting for short silence reduces word truncation
- hard-capping long speech turns prevents unbounded buffering
- 1.2 s minimum segment length avoids committing fragments too early

### ASR windowing

- Partial ASR uses the latest 2.4 s window with overlap.
- Final ASR runs on the committed speech segment.

Why overlapping windows:

- Whisper-style models transcribe better with local context than with isolated tiny chunks
- a rolling 2-3 s context keeps latency low while preserving phrase continuity
- final decode on the whole committed segment improves punctuation and lexical accuracy

### Diarization

- Diarization runs on the same committed speech segment as final ASR.
- Each ASR segment is assigned to the diarized speaker whose turn covers the segment midpoint.

Why diarize on committed windows instead of raw packets:

- speaker embeddings and segmentation are much less stable on sub-second audio
- committed windows give enough evidence for speaker separation while still staying near real time
- partial text remains fast, final text becomes speaker-attributed and stable

## Data flow

1. Browser captures microphone audio with `AudioWorklet`.
2. Frontend downsamples to 16 kHz mono PCM and sends 200 ms binary frames to `ws://.../ws/live`.
3. Backend appends PCM frames to a session buffer.
4. WebRTC VAD marks speech boundaries from 20 ms frames.
5. While speech is active, the backend emits rolling partial transcript updates.
6. When a segment is committed, the backend runs:
   - final ASR on the segment
   - diarization on the segment
7. Backend aligns ASR segments to speaker turns and emits final transcript items.
8. Frontend renders speaker A on the left and speaker B on the right.

## Research notes

This implementation follows the same broad real-time principle used by streaming speech systems:

- small capture frames for reliable VAD
- slightly larger transport packets to reduce protocol overhead
- overlapping decode windows for stable incremental ASR
- delayed finalization for speaker attribution quality

The most important practical tradeoff is this:

- lower latency comes from shorter packets and earlier commits
- higher accuracy comes from more overlap and waiting slightly longer before finalizing

The current defaults are a balanced starting point. If you want even lower latency, reduce:

- `transport_chunk_ms` from `200` to `120`
- `partial_hop_ms` from `400` to `240`
- `silence_to_commit_ms` from `480` to `320`

If you want higher accuracy, increase:

- `partial_window_ms` from `2400` to `3200`
- `min_segment_ms` from `1200` to `1600`
- `silence_to_commit_ms` from `480` to `650`
