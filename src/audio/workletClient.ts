const TARGET_SAMPLE_RATE = 16000;
const FRAME_MS = 200;

export type AudioStreamController = {
  stop: () => Promise<void>;
};

function downsampleBuffer(input: Float32Array, sourceSampleRate: number): Int16Array {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) {
    const exact = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      exact[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return exact;
  }

  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.round(input.length / ratio);
  const output = new Int16Array(outputLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < outputLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accum += input[i];
      count += 1;
    }

    const sample = Math.max(-1, Math.min(1, accum / Math.max(1, count)));
    output[offsetResult] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return output;
}

export async function startMicrophoneStream(
  onChunk: (chunk: ArrayBuffer) => void,
): Promise<AudioStreamController> {
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  const audioContext = new AudioContext({ sampleRate: 48000 });
  await audioContext.audioWorklet.addModule("/audio-processor.js");

  const source = audioContext.createMediaStreamSource(mediaStream);
  const worklet = new AudioWorkletNode(audioContext, "pcm-capture-processor");
  const sink = audioContext.createGain();
  sink.gain.value = 0;
  const frameSamples = (TARGET_SAMPLE_RATE * FRAME_MS) / 1000;
  let queued = new Int16Array(0);

  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const samples = downsampleBuffer(event.data, audioContext.sampleRate);
    const combined = new Int16Array(queued.length + samples.length);
    combined.set(queued);
    combined.set(samples, queued.length);
    queued = combined;

    while (queued.length >= frameSamples) {
      const payload = queued.slice(0, frameSamples);
      queued = queued.slice(frameSamples);
      onChunk(payload.buffer);
    }
  };

  source.connect(worklet);
  worklet.connect(sink);
  sink.connect(audioContext.destination);

  return {
    async stop() {
      sink.disconnect();
      worklet.disconnect();
      source.disconnect();
      mediaStream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
    }
  };
}
