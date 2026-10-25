import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs";
import {
  ManifestService,
  ProjectDetector,
  SessionManager,
  BrowserProcess,
  FileWatcher,
  ChangeClassifier,
  ReloadExecutor,
  DiagnosticsHub,
  BuildRunner,
  type ManifestValidationResult,
  type DiscoveredProject,
  type ProfileMode,
} from "@extensionflow/core";
import { ComponentTreeProvider } from "./views/component-tree-provider.js";
import { ProjectOverviewProvider } from "./views/project-overview-provider.js";
import { DiagnosticsManager } from "./diagnostics/manifest-diagnostics.js";
import { DoctorService } from "./doctor/doctor-service.js";

let statusBarItem: vscode.StatusBarItem;
let manifestWatcher: vscode.FileSystemWatcher | undefined;
let sessionManager: SessionManager;
let fileWatcher: FileWatcher | null = null;
let diagnosticsHub: DiagnosticsHub | null = null;
let outputChannel: vscode.OutputChannel;
let browserOutputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  console.log("[ExtensionFlow] Activating ExtensionFlow VS Code Extension...");

  outputChannel = vscode.window.createOutputChannel("ExtensionFlow");
  browserOutputChannel = vscode.window.createOutputChannel("ExtensionFlow: Browser");
  context.subscriptions.push(outputChannel);
  context.subscriptions.push(browserOutputChannel);

  const manifestService = new ManifestService();
  const projectDetector = new ProjectDetector();
  const diagnosticsManager = new DiagnosticsManager();
  const doctorService = new DoctorService();
  const classifier = new ChangeClassifier();
  const reloadExecutor = new ReloadExecutor();
  const buildRunner = new BuildRunner();
  sessionManager = new SessionManager();

  const overviewProvider = new ProjectOverviewProvider();
  const componentProvider = new ComponentTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "extensionflow.projectOverview",
      overviewProvider
    )
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "extensionflow.components",
      componentProvider
    )
  );
  context.subscriptions.push(diagnosticsManager);

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "extensionflow.start";
  statusBarItem.text = "$(zap) ExtensionFlow: Ready";
  statusBarItem.tooltip = "Click to start dedicated Chrome testing session";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  let currentProject: DiscoveredProject | null = null;
  let currentValidation: ManifestValidationResult | null = null;
  let targetExtensionId: string | null = null;

  // Resolve Helper extension location (supports bundled VSIX and dev repo)
  let helperExtensionPath = path.resolve(context.extensionPath, "helper-extension");
  if (!fs.existsSync(path.join(helperExtensionPath, "manifest.json"))) {
    helperExtensionPath = path.resolve(context.extensionPath, "../helper-extension");
  }

  // Central cache dir: prioritize local workspace cache in dev or global storage in production
  const localCache = path.resolve(context.extensionPath, "../../.cache/cft");
  const cacheDir = fs.existsSync(localCache)
    ? localCache
    : (context.globalStorageUri?.fsPath || localCache);

  // Helper to start the CDP diagnostics stream
  const startDiagnosticsHub = (browser: any, extensionRoot: string, extId: string) => {
    if (diagnosticsHub) {
      diagnosticsHub.stop();
    }

    diagnosticsHub = new DiagnosticsHub(browser, extensionRoot, extId);

    diagnosticsHub.on("log", (entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const srcLabel = entry.tabUrl ? `ContentScript: ${entry.tabUrl}` : entry.source.toUpperCase();
      browserOutputChannel.appendLine(`[${time}] [${srcLabel}] [${entry.level.toUpperCase()}] ${entry.message}`);
    });

    diagnosticsHub.on("problem", (problem) => {
      diagnosticsManager.addRuntimeProblem(problem);
    });

    diagnosticsHub.start();
    outputChannel.appendLine(`[Diagnostics] Attached CDP diagnostics stream for extension: ${extId}`);
  };

  const stopDiagnosticsHub = () => {
    if (diagnosticsHub) {
      diagnosticsHub.stop();
      diagnosticsHub = null;
    }
    diagnosticsManager.clearRuntimeProblems();
  };

  // Start watching files when session runs
  const startFileWatcher = (extensionRoot: string) => {
    if (fileWatcher) {
      fileWatcher.stop();
    }

    const config = vscode.workspace.getConfiguration("extensionflow");
    const debounceMs = config.get<number>("watch.debounceMs") || 300;
    const buildMode = config.get<string>("build.mode") || "none";
    const buildCommand = config.get<string>("build.command") || "";

    fileWatcher = new FileWatcher({
      watchPath: extensionRoot,
      debounceMs,
    });

    fileWatcher.on("change", async (changedFiles: string[]) => {
      const browser = sessionManager.getBrowser();
      if (!browser || sessionManager.getState() !== "Running" || !currentValidation || !currentProject) {
        return;
      }

      if (!targetExtensionId) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          targetExtensionId = await ReloadExecutor.findTargetExtensionId(
            browser,
            currentValidation.name
          );
          if (targetExtensionId) {
            outputChannel.appendLine(`[Watcher] Target extension resolved with ID: ${targetExtensionId}`);
            startDiagnosticsHub(browser, currentProject.extensionRoot, targetExtensionId);
            break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (!targetExtensionId) {
        outputChannel.appendLine("[Watcher] Target extension ID not yet resolved. Skipping reload.");
        return;
      }

      // Check session mode setting
      const mode = config.get<string>("mode");
      if (mode === "observe-only") {
        outputChannel.appendLine(
          `[Watcher] Files changed: ${changedFiles.join(", ")} (Skipping reload: Observe-only mode active)`
        );
        return;
      }

      // 1. Build integration (FR-28, FR-29)
      if (buildMode === "onChange" && buildCommand) {
        if (!vscode.workspace.isTrusted) {
          vscode.window.showErrorMessage(
            "ExtensionFlow: Build commands disabled in untrusted workspaces. Manage trust to enable."
          );
          return;
        }

        outputChannel.appendLine(`\n[Build] Running build command: '${buildCommand}'...`);
        statusBarItem.text = "$(sync~spin) ExtensionFlow: Building...";

        const buildResult = await buildRunner.runBuild(
          buildCommand,
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || currentProject.extensionRoot
        );

        diagnosticsManager.updateBuildProblems(buildResult.problems);

        if (!buildResult.success) {
          outputChannel.appendLine(`❌ [Build] Build failed with ${buildResult.problems.length} problem(s).`);
          statusBarItem.text = "$(error) ExtensionFlow: Build Failed";
          return; // Abort reload on build failure (FR-25)
        }

        outputChannel.appendLine(`✅ [Build] Build succeeded in ${buildResult.durationMs}ms.`);
      }

      // 2. Classify and reload
      const plan = classifier.classify(changedFiles, currentValidation);
      outputChannel.appendLine(`\n[Watcher] Changes detected in ${changedFiles.length} file(s):`);
      plan.reasons.forEach((r) => outputChannel.appendLine(`  - ${r}`));
      outputChannel.appendLine(`[Watcher] Executing reload action: ${plan.action}`);

      statusBarItem.text = "$(sync~spin) ExtensionFlow: Reloading...";

      const result = await reloadExecutor.execute(browser, targetExtensionId, plan, async () => {
        await sessionManager.restart();
      });

      if (result.success) {
        outputChannel.appendLine(
          `[Watcher] Reload complete via Method ${result.methodUsed} in ${result.durationMs}ms.`
        );
        if (result.refreshedTabs.length > 0) {
          outputChannel.appendLine(
            `[Watcher] Refreshed ${result.refreshedTabs.length} matching tab(s):`
          );
          result.refreshedTabs.forEach((tab) => outputChannel.appendLine(`    ${tab}`));
        }
        statusBarItem.text = `$(check) ExtensionFlow: Reloaded (${result.durationMs}ms)`;
        setTimeout(() => {
          if (sessionManager.getState() === "Running") {
            const port = sessionManager.getSessionInfo()?.port;
            statusBarItem.text = `$(play) ExtensionFlow: Port ${port}`;
          }
        }, 3000);
      } else {
        outputChannel.appendLine(`❌ [Watcher] Reload failed: ${result.error}`);
        statusBarItem.text = "$(error) ExtensionFlow: Reload Failed";
        vscode.window.showErrorMessage(`ExtensionFlow Reload Failed: ${result.error}`);
      }
    });

    fileWatcher.start();
    outputChannel.appendLine(`[Watcher] Started file watcher on: ${extensionRoot} (Debounce: ${debounceMs}ms)`);
  };

  const stopFileWatcher = () => {
    if (fileWatcher) {
      fileWatcher.stop();
      fileWatcher = null;
      outputChannel.appendLine("[Watcher] Stopped file watcher.");
    }
  };

  // Hook session manager events to UI
  sessionManager.on("stateChanged", async (state) => {
    outputChannel.appendLine(`[Session] State changed to: ${state}`);
    const sessionInfo = sessionManager.getSessionInfo();

    overviewProvider.update(
      currentProject,
      currentValidation,
      state === "Running" ? "Running" : state === "Starting" ? "Starting" : "Stopped"
    );

    if (state === "Running" && sessionInfo) {
      statusBarItem.text = `$(play) ExtensionFlow: Port ${sessionInfo.port}`;
      statusBarItem.tooltip = `Active session (PID: ${sessionInfo.pid}, Port: ${sessionInfo.port}). Click to stop.`;
      statusBarItem.command = "extensionflow.stop";

      // Resolve target extension ID & hook diagnostics
      const browser = sessionManager.getBrowser();
      if (browser && currentValidation && currentProject) {
        outputChannel.appendLine("[Session] Resolving target extension ID...");
        for (let attempt = 1; attempt <= 6; attempt++) {
          targetExtensionId = await ReloadExecutor.findTargetExtensionId(
            browser,
            currentValidation.name
          );
          if (targetExtensionId) {
            outputChannel.appendLine(`[Session] Target extension resolved with ID: ${targetExtensionId}`);
            startDiagnosticsHub(browser, currentProject.extensionRoot, targetExtensionId);
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        if (!targetExtensionId) {
          outputChannel.appendLine(
            "[Session] Notice: Extension ID will be resolved on first file change or preview."
          );
        }
      }

      // Start watcher on extension root
      if (currentProject) {
        startFileWatcher(currentProject.extensionRoot);
      }
    } else if (state === "Starting") {
      statusBarItem.text = "$(sync~spin) ExtensionFlow: Starting...";
      statusBarItem.command = undefined;
    } else {
      stopDiagnosticsHub();
      stopFileWatcher();
      targetExtensionId = null;
      statusBarItem.text = currentValidation
        ? `$(zap) ExtensionFlow: ${currentValidation.name}`
        : "$(zap) ExtensionFlow: Ready";
      statusBarItem.tooltip = "Click to start browser session";
      statusBarItem.command = "extensionflow.start";
    }
  });

  sessionManager.on("log", (msg, level) => {
    const timestamp = new Date().toLocaleTimeString();
    outputChannel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${msg}`);
  });

  sessionManager.on("error", (err) => {
    vscode.window.showErrorMessage(`ExtensionFlow Error: ${err.message}`);
  });

  // Function to refresh and validate the active project
  const refreshProject = (manifestPath?: string) => {
    if (!manifestPath) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        overviewProvider.update(null, null);
        componentProvider.update(null);
        return;
      }

      // Check user setting
      const configuredRoot = vscode.workspace
        .getConfiguration("extensionflow")
        .get<string>("extensionRoot");

      if (configuredRoot && configuredRoot !== "auto") {
        const fullManifest = path.join(configuredRoot, "manifest.json");
        if (fs.existsSync(fullManifest)) {
          manifestPath = fullManifest;
        }
      }

      if (!manifestPath) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        const discovered = projectDetector.findProjects(rootPath);
        if (discovered.length > 0) {
          currentProject = discovered[0];
          manifestPath = currentProject.manifestPath;
        }
      }
    }

    if (manifestPath && fs.existsSync(manifestPath)) {
      const validation = manifestService.parseAndValidate(manifestPath);
      currentValidation = validation;

      if (!currentProject) {
        currentProject = {
          extensionRoot: path.dirname(manifestPath),
          manifestPath,
          name: validation.name,
          version: validation.version,
          manifestVersion: validation.manifestVersion || 3,
          framework: projectDetector.detectFramework(
            path.dirname(manifestPath),
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.dirname(manifestPath)
          ),
        };
      }

      const isRunning = sessionManager.getState() === "Running";
      overviewProvider.update(
        currentProject,
        validation,
        isRunning ? "Running" : "Stopped"
      );
      componentProvider.update(validation);
      diagnosticsManager.updateManifestDiagnostics(manifestPath, validation.diagnostics);

      if (!isRunning) {
        statusBarItem.text = `$(zap) ExtensionFlow: ${validation.name}`;
        statusBarItem.tooltip = `Extension: ${validation.name} (${validation.components.length} components)`;
      }
    } else {
      overviewProvider.update(null, null);
      componentProvider.update(null);
      diagnosticsManager.clearAll();
      statusBarItem.text = "$(warning) ExtensionFlow: No Manifest";
    }
  };

  // Initial scan
  refreshProject();

  // Watch manifest.json for changes
  manifestWatcher = vscode.workspace.createFileSystemWatcher("**/manifest.json");
  manifestWatcher.onDidChange((uri) => refreshProject(uri.fsPath));
  manifestWatcher.onDidCreate((uri) => refreshProject(uri.fsPath));
  manifestWatcher.onDidDelete(() => refreshProject());
  context.subscriptions.push(manifestWatcher);

  // Command: Start Session
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.start", async () => {
      if (!currentProject) {
        vscode.window.showErrorMessage(
          "ExtensionFlow: No extension project found. Run 'Select Extension Root' first."
        );
        return;
      }

      const config = vscode.workspace.getConfiguration("extensionflow");
      const customPath = config.get<string>("browser.path") || undefined;
      let channel = config.get<string>("browser.channel") || "stable";
      if (channel.startsWith("cft-")) {
        channel = channel.replace(/^cft-/, "");
      }
      const profileMode = (config.get<string>("browser.profileMode") || "persistent") as ProfileMode;

      try {
        outputChannel.show(true);
        const extensions = [helperExtensionPath, currentProject.extensionRoot];
        await sessionManager.start({
          extensionPaths: extensions,
          cacheDir,
          customExecutablePath: customPath,
          channel,
          profileMode,
          headless: false,
        });

        vscode.window.showInformationMessage(
          `ExtensionFlow: Browser active for '${currentProject.name}' on port ${sessionManager.getSessionInfo()?.port}`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to start session: ${err.message}`);
      }
    })
  );

  // Command: Stop Session
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.stop", async () => {
      stopDiagnosticsHub();
      stopFileWatcher();
      await sessionManager.stop();
      vscode.window.showInformationMessage("ExtensionFlow: Browser session stopped.");
    })
  );

  // Command: Restart Session
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.restart", async () => {
      try {
        await sessionManager.restart();
        vscode.window.showInformationMessage("ExtensionFlow: Browser session restarted.");
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to restart session: ${err.message}`);
      }
    })
  );

  // Command: Reload Extension (Manual)
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.reload", async () => {
      const browser = sessionManager.getBrowser();
      if (!browser || sessionManager.getState() !== "Running" || !currentValidation) {
        vscode.window.showWarningMessage("No active browser session to reload.");
        return;
      }

      if (!targetExtensionId) {
        targetExtensionId = await ReloadExecutor.findTargetExtensionId(
          browser,
          currentValidation.name
        );
      }

      if (!targetExtensionId) {
        vscode.window.showErrorMessage("Could not resolve target extension ID.");
        return;
      }

      statusBarItem.text = "$(sync~spin) ExtensionFlow: Reloading...";
      const plan = {
        action: "reload_extension" as const,
        reasons: ["Manual reload triggered by user"],
        affectedFiles: [],
        matchingPatterns: [],
        isFallback: false,
      };

      const res = await reloadExecutor.execute(browser, targetExtensionId, plan);
      if (res.success) {
        vscode.window.showInformationMessage(`ExtensionFlow: Reloaded in ${res.durationMs}ms`);
        statusBarItem.text = `$(check) ExtensionFlow: Reloaded (${res.durationMs}ms)`;
      } else {
        vscode.window.showErrorMessage(`ExtensionFlow: Reload failed: ${res.error}`);
      }
    })
  );

  // Command: Reload Extension & Refresh Tabs (Manual)
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.reloadWithTabs", async () => {
      const browser = sessionManager.getBrowser();
      if (!browser || sessionManager.getState() !== "Running" || !currentValidation) {
        vscode.window.showWarningMessage("No active browser session to reload.");
        return;
      }

      if (!targetExtensionId) {
        targetExtensionId = await ReloadExecutor.findTargetExtensionId(
          browser,
          currentValidation.name
        );
      }

      if (!targetExtensionId) {
        vscode.window.showErrorMessage("Could not resolve target extension ID.");
        return;
      }

      const patterns: string[] = [];
      for (const comp of currentValidation.components) {
        if (comp.type === "content_script" && comp.matches) {
          patterns.push(...comp.matches);
        }
      }

      statusBarItem.text = "$(sync~spin) ExtensionFlow: Reloading...";
      const plan = {
        action: "reload_extension_and_tabs" as const,
        reasons: ["Manual reload & refresh tabs triggered by user"],
        affectedFiles: [],
        matchingPatterns: patterns,
        isFallback: false,
      };

      const res = await reloadExecutor.execute(browser, targetExtensionId, plan);
      if (res.success) {
        vscode.window.showInformationMessage(
          `ExtensionFlow: Reloaded & refreshed ${res.refreshedTabs.length} tab(s) in ${res.durationMs}ms`
        );
        statusBarItem.text = `$(check) ExtensionFlow: Reloaded (${res.durationMs}ms)`;
      } else {
        vscode.window.showErrorMessage(`ExtensionFlow: Reload failed: ${res.error}`);
      }
    })
  );

  // Command: Rebuild (Manual)
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.rebuild", async () => {
      const config = vscode.workspace.getConfiguration("extensionflow");
      const buildCommand = config.get<string>("build.command");

      if (!buildCommand) {
        vscode.window.showWarningMessage(
          "No build command configured. Set 'extensionflow.build.command' in settings."
        );
        return;
      }

      if (!vscode.workspace.isTrusted) {
        vscode.window.showErrorMessage(
          "ExtensionFlow: Build commands disabled in untrusted workspaces."
        );
        return;
      }

      outputChannel.appendLine(`\n[Build] Running manual rebuild: '${buildCommand}'...`);
      const res = await buildRunner.runBuild(
        buildCommand,
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || currentProject?.extensionRoot || ""
      );

      diagnosticsManager.updateBuildProblems(res.problems);

      if (res.success) {
        vscode.window.showInformationMessage(`ExtensionFlow: Rebuild succeeded in ${res.durationMs}ms`);
      } else {
        vscode.window.showErrorMessage(`ExtensionFlow: Rebuild failed with ${res.problems.length} errors.`);
      }
    })
  );

  // Command: Open Popup Preview
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.openPopupPreview", async () => {
      const browser = sessionManager.getBrowser();
      if (!browser || sessionManager.getState() !== "Running" || !currentValidation) {
        vscode.window.showWarningMessage("Start a browser session before opening the Popup Preview.");
        return;
      }

      if (!targetExtensionId) {
        targetExtensionId = await ReloadExecutor.findTargetExtensionId(
          browser,
          currentValidation.name
        );
      }

      if (!targetExtensionId) {
        vscode.window.showErrorMessage("Could not resolve target extension ID.");
        return;
      }

      const popupComp = currentValidation.components.find((c) => c.type === "popup");
      const popupRel = popupComp?.relativePath || "popup.html";

      try {
        await reloadExecutor.refreshPopupPreview(browser, targetExtensionId, popupRel);
        vscode.window.showInformationMessage(`ExtensionFlow: Opened Popup Preview for '${popupRel}'`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to open Popup Preview: ${err.message}`);
      }
    })
  );

  // Command: Clear Profile
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.clearProfile", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Are you sure you want to clear the browser profile? Logins and extension storage will be reset.",
        "Clear Profile",
        "Cancel"
      );
      if (confirm === "Clear Profile") {
        await sessionManager.stop();
        const profileDir = path.join(cacheDir, "profiles", "default-profile");
        BrowserProcess.clearProfile(profileDir);
        vscode.window.showInformationMessage("ExtensionFlow: Browser profile cleared.");
      }
    })
  );

  // Command: Select Extension Root
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.selectRoot", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage("Open a workspace folder to select an extension root.");
        return;
      }

      const projects = projectDetector.findProjects(workspaceFolders[0].uri.fsPath);
      if (projects.length === 0) {
        const pick = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: "Select Chrome Extension Root Directory",
        });
        if (pick && pick.length > 0) {
          const selectedFolder = pick[0].fsPath;
          const targetManifest = path.join(selectedFolder, "manifest.json");
          refreshProject(targetManifest);
        }
      } else {
        const items = projects.map((p) => ({
          label: `$(package) ${p.name}`,
          description: `v${p.version} (${p.framework.toUpperCase()})`,
          detail: p.extensionRoot,
          project: p,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select Chrome Extension Root",
        });

        if (selected) {
          currentProject = selected.project;
          refreshProject(selected.project.manifestPath);
        }
      }
    })
  );

  // Command: Run Doctor
  context.subscriptions.push(
    vscode.commands.registerCommand("extensionflow.runDoctor", async () => {
      const cachedCfT = path.resolve(
        cacheDir,
        "chrome/win64-156.0.8078.47/chrome-win64/chrome.exe"
      );
      await doctorService.runDoctor(currentProject, currentValidation, cachedCfT);
    })
  );

  console.log("[ExtensionFlow] ExtensionFlow activated successfully.");
}

export async function deactivate() {
  if (manifestWatcher) {
    manifestWatcher.dispose();
  }
  if (diagnosticsHub) {
    diagnosticsHub.stop();
  }
  if (fileWatcher) {
    await fileWatcher.stop();
  }
  if (sessionManager) {
    await sessionManager.stop();
  }
}
