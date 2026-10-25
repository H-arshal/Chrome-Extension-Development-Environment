import fs from "node:fs";
import path from "node:path";
import { spawn, execSync, ChildProcess } from "node:child_process";
import puppeteer, { Browser as PuppeteerBrowser } from "puppeteer-core";
import type { BrowserLaunchConfig, BrowserSessionInfo } from "./browser-types.js";
import { BrowserResolver } from "./browser-resolver.js";

export class BrowserProcess {
  private childProcess: ChildProcess | null = null;
  private puppeteerBrowser: PuppeteerBrowser | null = null;
  private sessionInfo: BrowserSessionInfo | null = null;
  private resolver = new BrowserResolver();

  /**
   * Spawns a dedicated browser instance, connects via CDP, and returns the session.
   */
  public async launch(config: BrowserLaunchConfig): Promise<{
    browser: PuppeteerBrowser;
    sessionInfo: BrowserSessionInfo;
  }> {
    // 1. Resolve executable
    const resolved = await this.resolver.resolve({
      cacheDir: config.cacheDir,
      customPath: config.customExecutablePath,
      channel: config.channel,
    });

    // 2. Setup user-data-dir
    const isEphemeral = config.profileMode === "ephemeral";
    const profileDir =
      config.userDataDir ||
      path.join(
        config.cacheDir,
        "profiles",
        isEphemeral ? `ephemeral-${Date.now()}` : "default-profile"
      );

    // Clean previous ephemeral profile, orphan sweep, and remove stale DevToolsActivePort
    this.sweepOrphanPid(profileDir);
    fs.mkdirSync(profileDir, { recursive: true });

    const devToolsFile = path.join(profileDir, "DevToolsActivePort");
    if (fs.existsSync(devToolsFile)) {
      try {
        fs.unlinkSync(devToolsFile);
      } catch {}
    }

    // 3. Format extensions arguments
    const absExtensions = config.extensionPaths.map((p) => path.resolve(p));
    const loadExtensionArg = `--load-extension=${absExtensions.join(",")}`;
    const disableExceptArg = `--disable-extensions-except=${absExtensions.join(",")}`;

    const args = [
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-features=Translate,OptimizationHints,MediaRouter",
      loadExtensionArg,
      disableExceptArg,
    ];

    if (config.headless) {
      args.push("--headless=new");
    }

    if (config.startUrls && config.startUrls.length > 0) {
      args.push(...config.startUrls);
    }

    // 4. Spawn child process with stderr captured for diagnostics
    let startupStderr = "";
    const child = spawn(resolved.executablePath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    });

    child.stderr?.on("data", (chunk) => {
      startupStderr += chunk.toString();
    });

    const pid = child.pid;
    if (!pid) {
      throw new Error("Failed to spawn browser process: PID is missing.");
    }

    // Store PID for crash recovery
    fs.writeFileSync(path.join(profileDir, "extensionflow.pid"), pid.toString(), "utf-8");

    // 5. Wait for freshly written DevToolsActivePort
    const { port, wsPath } = await this.waitForActivePort(profileDir, child);
    const wsEndpoint = `ws://127.0.0.1:${port}${wsPath}`;

    // 6. Connect puppeteer-core with retry loop to avoid ECONNREFUSED race conditions
    let browser: PuppeteerBrowser | null = null;
    let lastConnectError: any = null;

    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        browser = await puppeteer.connect({
          browserWSEndpoint: wsEndpoint,
          defaultViewport: null,
        });
        break;
      } catch (err: any) {
        lastConnectError = err;
        if (child.exitCode !== null) {
          throw new Error(
            `Browser process exited prematurely with code ${child.exitCode}: ${startupStderr}`
          );
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!browser) {
      throw (
        lastConnectError ||
        new Error(`Failed to establish CDP connection to browser at ${wsEndpoint}`)
      );
    }

    this.childProcess = child;
    this.puppeteerBrowser = browser;
    this.sessionInfo = {
      pid,
      port,
      wsEndpoint,
      profileDir,
      executablePath: resolved.executablePath,
      isEphemeral,
    };

    return { browser, sessionInfo: this.sessionInfo };
  }

  /**
   * Safely terminates the browser process and all child processes.
   */
  public async terminate(): Promise<void> {
    if (this.puppeteerBrowser) {
      try {
        if (this.puppeteerBrowser.isConnected()) {
          await this.puppeteerBrowser.close();
        }
      } catch {
        // Disconnect gracefully
      }
      this.puppeteerBrowser = null;
    }

    if (this.sessionInfo) {
      const pid = this.sessionInfo.pid;
      this.killPidTree(pid);

      // Clean up PID file and DevToolsActivePort
      const pidFile = path.join(this.sessionInfo.profileDir, "extensionflow.pid");
      if (fs.existsSync(pidFile)) {
        try {
          fs.unlinkSync(pidFile);
        } catch {}
      }

      const devToolsFile = path.join(this.sessionInfo.profileDir, "DevToolsActivePort");
      if (fs.existsSync(devToolsFile)) {
        try {
          fs.unlinkSync(devToolsFile);
        } catch {}
      }

      // If ephemeral profile, delete directory
      if (this.sessionInfo.isEphemeral) {
        try {
          fs.rmSync(this.sessionInfo.profileDir, { recursive: true, force: true });
        } catch {}
      }

      this.sessionInfo = null;
    }

    this.childProcess = null;
  }

  /**
   * Cleans the persistent profile directory.
   */
  public static clearProfile(profileDir: string): void {
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  }

  private async waitForActivePort(
    profileDir: string,
    child?: ChildProcess,
    timeoutMs = 15000
  ): Promise<{ port: number; wsPath: string }> {
    const devToolsFile = path.join(profileDir, "DevToolsActivePort");
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (child && child.exitCode !== null) {
        throw new Error(`Browser process exited unexpectedly with code ${child.exitCode}`);
      }

      if (fs.existsSync(devToolsFile)) {
        try {
          const lines = fs.readFileSync(devToolsFile, "utf-8").trim().split(/\r?\n/);
          if (lines.length >= 2 && lines[0]) {
            const port = parseInt(lines[0], 10);
            const wsPath = lines[1] || "";
            if (port > 0) {
              return { port, wsPath };
            }
          }
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`Timed out waiting for DevToolsActivePort in: ${profileDir}`);
  }

  private killPidTree(pid: number): void {
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } catch {}
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  }

  private sweepOrphanPid(profileDir: string): void {
    const pidFile = path.join(profileDir, "extensionflow.pid");
    if (fs.existsSync(pidFile)) {
      try {
        const oldPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
        if (oldPid > 0) {
          this.killPidTree(oldPid);
        }
        fs.unlinkSync(pidFile);
      } catch {}
    }
  }
}
