import type { BrowserSessionInfo } from "../browser/browser-types.js";

export type SessionState =
  | "Idle"
  | "Starting"
  | "Running"
  | "Building"
  | "Reloading"
  | "Stopping"
  | "Error";

export interface SessionEvents {
  stateChanged: (state: SessionState, previousState: SessionState) => void;
  browserStarted: (sessionInfo: BrowserSessionInfo) => void;
  browserStopped: () => void;
  error: (error: Error) => void;
  log: (message: string, level: "info" | "warn" | "error") => void;
}
