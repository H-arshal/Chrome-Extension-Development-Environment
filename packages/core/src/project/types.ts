export type DiagnosticSeverity = "error" | "warning" | "info";

export interface ManifestDiagnostic {
  line: number;
  column: number;
  offset: number;
  length: number;
  message: string;
  severity: DiagnosticSeverity;
  code?: string;
  file?: string;
}

export type ComponentType =
  | "service_worker"
  | "content_script"
  | "popup"
  | "options"
  | "side_panel"
  | "new_tab"
  | "declarative_net_request"
  | "icon"
  | "locale"
  | "web_accessible_resource";

export interface ExtensionComponent {
  id: string;
  type: ComponentType;
  name: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  matches?: string[];
  extraFiles?: Array<{ relativePath: string; absolutePath: string; exists: boolean; kind: "js" | "css" }>;
}

export interface ManifestValidationResult {
  valid: boolean;
  manifestVersion?: number;
  name: string;
  version: string;
  components: ExtensionComponent[];
  diagnostics: ManifestDiagnostic[];
  manifestPath: string;
  extensionRoot: string;
  rawJson?: Record<string, unknown>;
}

export interface DiscoveredProject {
  extensionRoot: string;
  manifestPath: string;
  name: string;
  version: string;
  manifestVersion: number;
  framework: "plain" | "vite" | "webpack" | "wxt" | "plasmo" | "crxjs";
}
