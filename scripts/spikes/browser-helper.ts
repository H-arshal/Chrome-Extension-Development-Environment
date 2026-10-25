import path from "node:path";
import fs from "node:fs";
import { spawn, execSync, ChildProcess } from "node:child_process";
import {
  install,
  resolveBuildId,
  Browser,
  detectBrowserPlatform,
  computeExecutablePath,
} from "@puppeteer/browsers";
import puppeteer, { Browser as PuppeteerBrowser } from "puppeteer-core";

const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.resolve(WORKSPACE_ROOT, ".cache/cft");

export interface LaunchOptions {
  extensions: string[];
  userDataDir?: string;
  headless?: boolean;
  startUrl?: string;
}

export interface RunningSession {
  browser: PuppeteerBrowser;
  process: ChildProcess;
  wsEndpoint: string;
  port: number;
  profileDir: string;
  close: () => Promise<void>;
}

/**
 * Ensures Chrome for Testing (CfT) is installed in .cache/cft and returns the executable path.
 */
export async function ensureCfT(): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error("Unsupported operating system platform for Chrome for Testing");
  }

  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  const expectedExecutable = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    platform,
    cacheDir: CACHE_DIR,
  });

  if (fs.existsSync(expectedExecutable)) {
    console.log(`[CfT] Using cached Chrome for Testing (${buildId}): ${expectedExecutable}`);
    return expectedExecutable;
  }

  console.log(`[CfT] Downloading Chrome for Testing ${buildId} to ${CACHE_DIR}...`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const installed = await install({
    browser: Browser.CHROME,
    buildId,
    platform,
    cacheDir: CACHE_DIR,
  });

  console.log(`[CfT] Download complete. Executable: ${installed.executablePath}`);
  return installed.executablePath;
}

/**
 * Reads DevToolsActivePort file from profile directory.
 */
async function waitForDevToolsActivePort(
  profileDir: string,
  timeoutMs = 15000
): Promise<{ port: number; wsPath: string }> {
  const devToolsFile = path.join(profileDir, "DevToolsActivePort");
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(devToolsFile)) {
      try {
        const content = fs.readFileSync(devToolsFile, "utf-8").trim().split(/\r?\n/);
        if (content.length >= 2 && content[0]) {
          const port = parseInt(content[0], 10);
          const wsPath = content[1] || "";
          if (port > 0) {
            return { port, wsPath };
          }
        }
      } catch {
        // File may be currently being written
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`Timed out waiting for DevToolsActivePort in ${profileDir}`);
}

/**
 * Launches Chrome for Testing with port 0 and loaded extensions.
 */
export async function launchCfT(options: LaunchOptions): Promise<RunningSession> {
  const executablePath = await ensureCfT();

  const profileDir =
    options.userDataDir ||
    path.join(WORKSPACE_ROOT, ".cache/profiles", `session-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const absExtensions = options.extensions.map((e) => path.resolve(e));
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

  if (options.headless) {
    args.push("--headless=new");
  }

  if (options.startUrl) {
    args.push(options.startUrl);
  }

  console.log(`[CfT] Spawning process: ${executablePath}`);
  const child = spawn(executablePath, args, {
    stdio: "ignore",
    detached: false,
  });

  const pid = child.pid;
  if (!pid) {
    throw new Error("Failed to spawn browser process: no PID returned.");
  }
  console.log(`[CfT] Spawned browser with PID: ${pid}`);

  const { port, wsPath } = await waitForDevToolsActivePort(profileDir);
  const wsEndpoint = `ws://127.0.0.1:${port}${wsPath}`;
  console.log(`[CfT] DevToolsActivePort acquired. Port: ${port}, wsEndpoint: ${wsEndpoint}`);

  const browser = await puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    defaultViewport: null,
  });

  const close = async () => {
    try {
      if (browser.isConnected()) {
        await browser.close();
      }
    } catch {
      // Ignore disconnect errors
    }

    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } catch {
        // Process might have already terminated
      }
    } else {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore
      }
    }
  };

  return {
    browser,
    process: child,
    wsEndpoint,
    port,
    profileDir,
    close,
  };
}

/**
 * Returns helper extension path.
 */
export function getHelperExtensionPath(): string {
  return path.resolve(WORKSPACE_ROOT, "packages/helper-extension");
}

/**
 * Returns minimal content script fixture path.
 */
export function getContentScriptFixturePath(): string {
  return path.resolve(WORKSPACE_ROOT, "fixtures/minimal-content-script");
}

/**
 * Returns storage fixture path.
 */
export function getStorageFixturePath(): string {
  return path.resolve(WORKSPACE_ROOT, "fixtures/storage-test-extension");
}
