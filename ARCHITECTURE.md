# Speech Workspace Architecture

## Why this pipeline

The browser sends raw 16 kHz mono PCM instead of `MediaRecorder` blobs because low-latency diarization needs deterministic frame boundaries and avoids Opus encode/decode delay. The backend owns VAD, segmentation, transcription, and diarization so chunking policy can be tuned once and kept consistent.

This design is optimized for:

- low transport latency
- stable partial text
- better speaker attribution on final text
- compatibility with a single shared microphone
- shared logic across Whisper and VibeVoice-ASR

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

### ASR windowing and model selection

- Partial ASR uses the latest 2.4 s window with overlap.
- Final ASR runs on the committed speech segment.
- The same live pipeline is reused for both `whisper` and `vibevoice_asr`.

Why overlapping windows:

- Whisper-style models transcribe better with local context than with isolated tiny chunks
- a rolling 2-3 s context keeps latency low while preserving phrase continuity
- final decode on the whole committed segment improves punctuation and lexical accuracy

Why wrap both models the same way:

- neither model is treated as a native browser-live API
- keeping VAD and commit logic outside the model makes model swaps cheaper
- diarization quality stays consistent because speaker attribution is handled after ASR

### Diarization

- Diarization runs on the same committed speech segment as final ASR.
- Each ASR segment is assigned to the diarized speaker whose turn covers the segment midpoint.

Why diarize on committed windows instead of raw packets:

- speaker embeddings and segmentation are much less stable on sub-second audio
- committed windows give enough evidence for speaker separation while still staying near real time
- partial text remains fast, final text becomes speaker-attributed and stable

## Data flow

1. Browser captures microphone audio with `AudioWorklet`.
2. Frontend lets the user select `Whisper` or `VibeVoice-ASR`.
3. Frontend downsamples to 16 kHz mono PCM and sends 200 ms binary frames to `ws://.../ws/live`.
4. Backend appends PCM frames to a session buffer.
5. WebRTC VAD marks speech boundaries from 20 ms frames.
6. While speech is active, the backend emits rolling partial transcript updates.
7. Partial windows are decoded by the selected ASR provider.
8. When a segment is committed, the backend runs:
   - final ASR on the segment
   - diarization on the segment
9. Backend aligns ASR segments to speaker turns and emits final transcript items.
10. Frontend renders speaker A on the left and speaker B on the right.

## Batch transcription flow

1. User uploads an audio file and chooses `Whisper` or `VibeVoice-ASR`.
2. Backend decodes audio into mono float waveform.
3. Selected ASR provider transcribes the full file.
4. Pyannote diarization runs on the same waveform.
5. Frontend displays both the merged transcript and speaker-attributed segments.

## Document-to-speech flow

1. User uploads `.txt`, `.pdf`, or `.docx` plus a reference voice sample.
2. Backend extracts text from the document.
3. Backend passes extracted text and the reference voice sample to the VibeVoice TTS adapter.
4. Generated WAV audio is stored server-side and returned with playback and download URLs.

Important constraint:

- voice cloning is wired to the long-form VibeVoice path, not the lightweight realtime preset path

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
