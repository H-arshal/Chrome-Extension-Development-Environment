import EventEmitter from "node:events";
import type { Browser as PuppeteerBrowser } from "puppeteer-core";
import { BrowserProcess } from "../browser/browser-process.js";
import type { BrowserLaunchConfig, BrowserSessionInfo } from "../browser/browser-types.js";
import type { SessionState, SessionEvents } from "./session-types.js";

export class SessionManager extends EventEmitter {
  private state: SessionState = "Idle";
  private browserProcess = new BrowserProcess();
  private browserInstance: PuppeteerBrowser | null = null;
  private sessionInfo: BrowserSessionInfo | null = null;
  private lastConfig: BrowserLaunchConfig | null = null;

  public getState(): SessionState {
    return this.state;
  }

  public getSessionInfo(): BrowserSessionInfo | null {
    return this.sessionInfo;
  }

  public getBrowser(): PuppeteerBrowser | null {
    return this.browserInstance;
  }

  private setState(newState: SessionState): void {
    if (this.state === newState) return;
    const old = this.state;
    this.state = newState;
    this.emit("stateChanged", newState, old);
  }

  /**
   * Starts a dedicated browser session with the target extensions.
   */
  public async start(config: BrowserLaunchConfig): Promise<BrowserSessionInfo> {
    if (this.state === "Running" || this.state === "Starting") {
      throw new Error(`Cannot start browser session: currently in state '${this.state}'.`);
    }

    this.lastConfig = config;
    this.setState("Starting");
    this.emit("log", "Starting browser session with Chrome for Testing...", "info");

    try {
      const { browser, sessionInfo } = await this.browserProcess.launch(config);
      this.browserInstance = browser;
      this.sessionInfo = sessionInfo;

      // Listen for unexpected browser window closures by user (FR-13)
      browser.on("disconnected", () => {
        if (this.state !== "Stopping" && this.state !== "Idle") {
          this.emit("log", "Browser window closed by user.", "warn");
          this.browserInstance = null;
          this.sessionInfo = null;
          this.setState("Idle");
          this.emit("browserStopped");
        }
      });

      this.setState("Running");
      this.emit("browserStarted", sessionInfo);
      this.emit(
        "log",
        `Browser session active on port ${sessionInfo.port} (PID ${sessionInfo.pid})`,
        "info"
      );

      return sessionInfo;
    } catch (err: any) {
      this.setState("Error");
      this.emit("error", err);
      this.emit("log", `Failed to start browser session: ${err.message}`, "error");
      await this.stop();
      throw err;
    }
  }

  /**
   * Stops the active browser session and performs process tree termination.
   */
  public async stop(): Promise<void> {
    if (this.state === "Idle") return;

    this.setState("Stopping");
    this.emit("log", "Stopping browser session...", "info");

    try {
      await this.browserProcess.terminate();
    } catch (err: any) {
      this.emit("log", `Error during browser termination: ${err.message}`, "warn");
    } finally {
      this.browserInstance = null;
      this.sessionInfo = null;
      this.setState("Idle");
      this.emit("browserStopped");
      this.emit("log", "Browser session stopped.", "info");
    }
  }

  /**
   * Restarts the browser session, retaining persistent profile state.
   */
  public async restart(config?: BrowserLaunchConfig): Promise<BrowserSessionInfo> {
    const launchConfig = config || this.lastConfig;
    if (!launchConfig) {
      throw new Error("No previous launch configuration available to restart.");
    }

    await this.stop();
    return await this.start(launchConfig);
  }
}
