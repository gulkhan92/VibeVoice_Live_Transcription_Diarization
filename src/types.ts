export type ModelInfo = {
  id: string;
  label: string;
  available: boolean;
  kind: string;
  note?: string;
};

export type ServerEvent =
  | {
      type: "session.ready";
      sessionId: string;
    }
  | {
      type: "status";
      state: "idle" | "listening" | "processing";
      message: string;
    }
  | {
      type: "partial";
      speaker: string;
      text: string;
      startedAtMs: number;
      endedAtMs: number;
    }
  | {
      type: "final";
      id: string;
      speaker: string;
      text: string;
      startedAtMs: number;
      endedAtMs: number;
    }
  | {
      type: "error";
      message: string;
    };

export type TranscriptMessage = {
  id: string;
  speaker: string;
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  final: boolean;
};

export type FileTranscriptResponse = {
  model: string;
  text: string;
  segments: Array<{
    speaker: string;
    text: string;
    startedAtMs: number;
    endedAtMs: number;
  }>;
};

export type TtsResponse = {
  speaker: string;
  textPreview: string;
  audioUrl: string;
  downloadUrl: string;
};
