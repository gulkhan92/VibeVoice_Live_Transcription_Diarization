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
