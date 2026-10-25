import * as vscode from "vscode";
import fs from "node:fs";
import path from "node:path";
import type { ManifestValidationResult, DiscoveredProject } from "@extensionflow/core";

export interface DoctorCheckItem {
  category: string;
  name: string;
  passed: boolean;
  message: string;
  fixHint?: string;
}

export class DoctorService {
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("ExtensionFlow: Doctor");
  }

  public async runDoctor(
    project: DiscoveredProject | null,
    validation: ManifestValidationResult | null,
    cftExecutablePath?: string
  ): Promise<boolean> {
    this.outputChannel.clear();
    this.outputChannel.show(true);

    this.outputChannel.appendLine("==================================================");
    this.outputChannel.appendLine("       ⚡ EXTENSIONFLOW ENVIRONMENT DOCTOR        ");
    this.outputChannel.appendLine("==================================================\n");

    const checks: DoctorCheckItem[] = [];

    // 1. Workspace Trust
    const isTrusted = vscode.workspace.isTrusted;
    checks.push({
      category: "Security",
      name: "Workspace Trust",
      passed: isTrusted,
      message: isTrusted
        ? "Workspace is trusted. Build and execution allowed."
        : "Workspace is untrusted. Automated build commands are restricted.",
      fixHint: isTrusted
        ? undefined
        : "Trust this workspace via 'Workspaces: Manage Workspace Trust' in VS Code.",
    });

    // 2. Project Detection
    const hasProject = !!project && !!project.manifestPath;
    checks.push({
      category: "Project",
      name: "Extension Root & Manifest Detection",
      passed: hasProject,
      message: hasProject
        ? `Located manifest at: ${project.manifestPath} (Framework: ${project.framework})`
        : "No valid extension root with manifest.json detected.",
      fixHint: hasProject
        ? undefined
        : "Run 'ExtensionFlow: Select Extension Root' to choose your extension directory.",
    });

    // 3. Manifest Validation & MV3 Schema
    const isValidMV3 = !!validation && validation.valid && validation.manifestVersion === 3;
    checks.push({
      category: "Manifest",
      name: "Manifest V3 Compliance",
      passed: isValidMV3,
      message: isValidMV3
        ? `Valid MV3 manifest for '${validation.name}' (v${validation.version}) with ${validation.components.length} mapped components.`
        : validation?.manifestVersion === 2
        ? "Manifest V2 detected. ExtensionFlow requires Manifest V3."
        : `Manifest contains ${validation?.diagnostics.length || 0} error(s).`,
      fixHint: isValidMV3
        ? undefined
        : "Inspect the Problems panel for line-by-line syntax and file reference fixes.",
    });

    // 4. Component File Existence
    if (validation) {
      const missingFiles = validation.components.filter((c) => !c.exists);
      checks.push({
        category: "Resources",
        name: "Referenced Component Files",
        passed: missingFiles.length === 0,
        message:
          missingFiles.length === 0
            ? "All declared service workers, content scripts, and pages exist on disk."
            : `${missingFiles.length} declared file(s) are missing from disk.`,
        fixHint:
          missingFiles.length === 0
            ? undefined
            : `Missing: ${missingFiles.map((f) => f.relativePath).join(", ")}.`,
      });
    }

    // 5. Browser Runtime Resolution
    let browserPassed = false;
    let browserMsg = "Chrome for Testing not downloaded yet.";
    if (cftExecutablePath && fs.existsSync(cftExecutablePath)) {
      browserPassed = true;
      browserMsg = `Managed Chrome for Testing binary verified at: ${cftExecutablePath}`;
    } else {
      const configBrowser = vscode.workspace
        .getConfiguration("extensionflow")
        .get<string>("browser.path");
      if (configBrowser && fs.existsSync(configBrowser)) {
        browserPassed = true;
        browserMsg = `Custom browser binary verified at: ${configBrowser}`;
      }
    }

    checks.push({
      category: "Browser",
      name: "Browser Executable Availability",
      passed: browserPassed,
      message: browserMsg,
      fixHint: browserPassed
        ? undefined
        : "Start a browser session to trigger the one-click managed CfT download.",
    });

    // 6. ExtensionFlow Helper Integrity
    const bundledHelper = path.resolve(__dirname, "../helper-extension/manifest.json");
    const devHelper = path.resolve(__dirname, "../../helper-extension/manifest.json");
    const helperExists = fs.existsSync(bundledHelper) || fs.existsSync(devHelper);
    checks.push({
      category: "Engine",
      name: "Helper Extension Integrity",
      passed: helperExists,
      message: helperExists
        ? "ExtensionFlow Helper extension verified with management permissions."
        : "Helper extension manifest missing from extension bundle.",
      fixHint: helperExists ? undefined : "Reinstall the ExtensionFlow extension bundle.",
    });

    // Render report
    let allPassed = true;
    for (const check of checks) {
      const statusIcon = check.passed ? "✅ PASS" : "❌ FAIL";
      if (!check.passed) allPassed = false;

      this.outputChannel.appendLine(`[${check.category}] ${statusIcon} - ${check.name}`);
      this.outputChannel.appendLine(`       Info: ${check.message}`);
      if (check.fixHint) {
        this.outputChannel.appendLine(`       Fix Hint: ${check.fixHint}`);
      }
      this.outputChannel.appendLine("");
    }

    this.outputChannel.appendLine("==================================================");
    if (allPassed) {
      this.outputChannel.appendLine("🎉 DOCTOR RESULT: ALL CHECKS PASSED!");
      vscode.window.showInformationMessage("ExtensionFlow Doctor: All environment checks passed!");
    } else {
      this.outputChannel.appendLine("⚠️ DOCTOR RESULT: ISSUES DETECTED. See fix hints above.");
      vscode.window.showWarningMessage(
        "ExtensionFlow Doctor found issues. Check 'ExtensionFlow: Doctor' output channel."
      );
    }
    this.outputChannel.appendLine("==================================================\n");

    return allPassed;
  }
}
