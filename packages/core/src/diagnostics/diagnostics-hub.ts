import EventEmitter from "node:events";
import type { Browser as PuppeteerBrowser, Target, CDPSession } from "puppeteer-core";
import type { BrowserLogEntry, LogSource, LogLevel, BuildProblem } from "./diagnostic-types.js";
import { SourceMapper } from "./source-mapper.js";

export class DiagnosticsHub extends EventEmitter {
  private attachedTargets = new Map<string, CDPSession>();
  private mapper: SourceMapper;
  private lastMessage = "";
  private repeatCount = 0;
  private lastMessageTime = 0;

  constructor(
    private browser: PuppeteerBrowser,
    private extensionRoot: string,
    private targetExtensionId: string
  ) {
    super();
    this.mapper = new SourceMapper(extensionRoot, targetExtensionId);
  }

  public start(): void {
    // Attach to existing targets
    for (const target of this.browser.targets()) {
      this.handleTarget(target);
    }

    // Listen for new targets
    this.browser.on("targetcreated", (target) => this.handleTarget(target));
    this.browser.on("targetdestroyed", (target) => {
      const id = (target as any)._targetId || target.url();
      const session = this.attachedTargets.get(id);
      if (session) {
        try {
          session.detach();
        } catch {}
        this.attachedTargets.delete(id);
      }
    });
  }

  private async handleTarget(target: Target): Promise<void> {
    const url = target.url();
    const type = target.type();
    const targetId = (target as any)._targetId || url;

    // Filter relevant targets: extension service worker, extension pages, or http tabs
    const isExtensionTarget = url.includes(this.targetExtensionId);
    const isHttpTab = type === "page" && (url.startsWith("http://") || url.startsWith("https://"));

    if (!isExtensionTarget && !isHttpTab) {
      return;
    }

    if (this.attachedTargets.has(targetId)) {
      return;
    }

    try {
      const cdp = await target.createCDPSession();
      this.attachedTargets.set(targetId, cdp);

      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");

      const source: LogSource =
        type === "service_worker"
          ? "service_worker"
          : url.includes("popup")
          ? "popup"
          : url.includes("options")
          ? "options"
          : isHttpTab
          ? "content_script"
          : "page";

      // 1. Console API calls
      cdp.on("Runtime.consoleAPICalled", (event: any) => {
        const message = (event.args || [])
          .map((arg: any) => (arg.value !== undefined ? String(arg.value) : arg.description || ""))
          .join(" ");

        const level: LogLevel =
          event.type === "error"
            ? "error"
            : event.type === "warning"
            ? "warn"
            : event.type === "debug"
            ? "debug"
            : "info";

        if (this.isRateLimited(message)) return;

        const stack = this.parseStackTrace(event.stackTrace);
        const logEntry: BrowserLogEntry = {
          source,
          level,
          message,
          timestamp: Date.now(),
          tabUrl: isHttpTab ? url : undefined,
          rawUrl: stack[0]?.file,
          stack,
        };

        this.emit("log", logEntry);
      });

      // 2. Uncaught Exceptions
      cdp.on("Runtime.exceptionThrown", (event: any) => {
        const details = event.exceptionDetails || {};
        const message =
          details.exception?.description || details.text || "Uncaught runtime exception";
        const stack = this.parseStackTrace(details.stackTrace);

        const logEntry: BrowserLogEntry = {
          source,
          level: "error",
          message,
          timestamp: Date.now(),
          tabUrl: isHttpTab ? url : undefined,
          rawUrl: details.url,
          stack,
        };

        this.emit("log", logEntry);

        // If top stack frame maps to local workspace, emit problem
        const topFrame = stack[0];
        if (topFrame && topFrame.workspaceFile) {
          const problem: BuildProblem = {
            file: topFrame.workspaceFile,
            line: topFrame.line,
            column: topFrame.column,
            message: `[Runtime Error] ${message}`,
            severity: "error",
            source: "ExtensionFlow: Runtime",
          };
          this.emit("problem", problem);
        }
      });
    } catch {
      // Ignore attach race conditions for short-lived targets
    }
  }

  private parseStackTrace(stackTrace?: any): any[] {
    if (!stackTrace || !Array.isArray(stackTrace.callFrames)) return [];

    return stackTrace.callFrames.map((frame: any) => {
      const fileUrl = frame.url || "";
      const { workspacePath } = this.mapper.mapUrlToWorkspace(fileUrl);
      return {
        file: fileUrl,
        line: (frame.lineNumber || 0) + 1,
        column: (frame.columnNumber || 0) + 1,
        functionName: frame.functionName,
        workspaceFile: workspacePath,
      };
    });
  }

  private isRateLimited(msg: string): boolean {
    const now = Date.now();
    if (msg === this.lastMessage && now - this.lastMessageTime < 1000) {
      this.repeatCount++;
      if (this.repeatCount > 5) return true;
    } else {
      this.lastMessage = msg;
      this.repeatCount = 0;
      this.lastMessageTime = now;
    }
    return false;
  }

  public stop(): void {
    for (const session of this.attachedTargets.values()) {
      try {
        session.detach();
      } catch {}
    }
    this.attachedTargets.clear();
  }
}
