import * as vscode from "vscode";
import type { ManifestDiagnostic, BuildProblem } from "@extensionflow/core";

export class DiagnosticsManager {
  private manifestCollection: vscode.DiagnosticCollection;
  private buildCollection: vscode.DiagnosticCollection;
  private runtimeCollection: vscode.DiagnosticCollection;

  constructor() {
    this.manifestCollection = vscode.languages.createDiagnosticCollection("extensionflow-manifest");
    this.buildCollection = vscode.languages.createDiagnosticCollection("extensionflow-build");
    this.runtimeCollection = vscode.languages.createDiagnosticCollection("extensionflow-runtime");
  }

  public updateManifestDiagnostics(manifestPath: string, diagnostics: ManifestDiagnostic[]): void {
    const uri = vscode.Uri.file(manifestPath);
    this.manifestCollection.delete(uri);

    if (!diagnostics || diagnostics.length === 0) return;

    const vscodeDiagnostics: vscode.Diagnostic[] = diagnostics.map((d) => {
      const startLine = Math.max(0, d.line - 1);
      const startChar = Math.max(0, d.column - 1);
      const endChar = startChar + Math.max(1, d.length);

      const range = new vscode.Range(startLine, startChar, startLine, endChar);
      const severity =
        d.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : d.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

      const diag = new vscode.Diagnostic(range, d.message, severity);
      diag.source = "ExtensionFlow: Manifest";
      if (d.code) diag.code = d.code;
      return diag;
    });

    this.manifestCollection.set(uri, vscodeDiagnostics);
  }

  public updateBuildProblems(problems: BuildProblem[]): void {
    this.buildCollection.clear();
    if (!problems || problems.length === 0) return;

    // Group problems by file
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const prob of problems) {
      const uri = vscode.Uri.file(prob.file);
      const line = Math.max(0, prob.line - 1);
      const col = Math.max(0, prob.column - 1);
      const range = new vscode.Range(line, col, line, col + 20);

      const diag = new vscode.Diagnostic(
        range,
        prob.message,
        prob.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning
      );
      diag.source = prob.source || "ExtensionFlow: Build";
      if (prob.code) diag.code = prob.code;

      const list = byFile.get(uri.fsPath) || [];
      list.push(diag);
      byFile.set(uri.fsPath, list);
    }

    for (const [filePath, diags] of byFile) {
      this.buildCollection.set(vscode.Uri.file(filePath), diags);
    }
  }

  public addRuntimeProblem(prob: BuildProblem): void {
    const uri = vscode.Uri.file(prob.file);
    const line = Math.max(0, prob.line - 1);
    const col = Math.max(0, prob.column - 1);
    const range = new vscode.Range(line, col, line, col + 20);

    const diag = new vscode.Diagnostic(
      range,
      prob.message,
      vscode.DiagnosticSeverity.Error
    );
    diag.source = "ExtensionFlow: Runtime";

    const existing = Array.from(this.runtimeCollection.get(uri) || []);
    existing.push(diag);
    this.runtimeCollection.set(uri, existing);
  }

  public clearBuildProblems(): void {
    this.buildCollection.clear();
  }

  public clearRuntimeProblems(): void {
    this.runtimeCollection.clear();
  }

  public clearAll(): void {
    this.manifestCollection.clear();
    this.buildCollection.clear();
    this.runtimeCollection.clear();
  }

  public dispose(): void {
    this.manifestCollection.dispose();
    this.buildCollection.dispose();
    this.runtimeCollection.dispose();
  }
}
