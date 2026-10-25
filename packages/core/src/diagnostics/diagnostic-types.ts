export type LogSource =
  | "service_worker"
  | "popup"
  | "options"
  | "content_script"
  | "page"
  | "build";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogStackFrame {
  file: string;
  line: number;
  column: number;
  functionName?: string;
  workspaceFile?: string;
}

export interface BrowserLogEntry {
  source: LogSource;
  level: LogLevel;
  message: string;
  timestamp: number;
  tabUrl?: string;
  rawUrl?: string;
  stack?: LogStackFrame[];
}

export interface BuildProblem {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
  code?: string;
  source: string;
}
