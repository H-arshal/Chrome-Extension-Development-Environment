export type ReloadActionType =
  | "reload_extension_and_tabs"
  | "reload_extension"
  | "refresh_popup"
  | "refresh_page"
  | "noop";

export interface ReloadPlan {
  action: ReloadActionType;
  reasons: string[];
  affectedFiles: string[];
  matchingPatterns: string[];
  targetPageUrl?: string;
  isFallback: boolean;
}

export type ReloadMethod = "A" | "D";

export interface ReloadResult {
  success: boolean;
  methodUsed: ReloadMethod;
  durationMs: number;
  plan: ReloadPlan;
  error?: string;
  refreshedTabs: string[];
}
