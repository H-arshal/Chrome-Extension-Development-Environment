import fs from "node:fs";
import path from "node:path";
import {
  install,
  resolveBuildId,
  getInstalledBrowsers,
  Browser,
  detectBrowserPlatform,
  computeExecutablePath,
  computeSystemExecutablePath,
} from "@puppeteer/browsers";

export interface ProgressCallback {
  (downloadedBytes: number, totalBytes: number): void;
}

export class BrowserResolver {
  /**
   * Resolves a usable browser executable path based on user settings, cached CfT,
   * or by downloading Chrome for Testing.
   */
  public async resolve(options: {
    cacheDir: string;
    customPath?: string;
    channel?: string;
    onProgress?: ProgressCallback;
  }): Promise<{ executablePath: string; isCfT: boolean; buildId?: string }> {
    // 1. User custom binary path
    if (options.customPath && options.customPath.trim().length > 0) {
      const custom = path.resolve(options.customPath);
      if (fs.existsSync(custom)) {
        return { executablePath: custom, isCfT: false };
      }
      throw new Error(`Configured custom browser executable does not exist at: ${custom}`);
    }

    const platform = detectBrowserPlatform();
    if (!platform) {
      throw new Error(`Unsupported OS platform for Chrome for Testing: ${process.platform}`);
    }

    // 2. Normalize channel tag: "cft-stable" -> "stable", "cft-canary" -> "canary"
    let channelTag = options.channel || "stable";
    if (channelTag.startsWith("cft-")) {
      channelTag = channelTag.replace(/^cft-/, "");
    }
    if (channelTag === "cft" || !channelTag) {
      channelTag = "stable";
    }

    // 3. Check for any already installed CfT browser in the primary cacheDir
    const checkCacheDirs = [
      options.cacheDir,
      path.resolve(options.cacheDir, "chrome"),
      path.resolve(process.cwd(), ".cache/cft"),
    ];

    for (const dir of checkCacheDirs) {
      if (fs.existsSync(dir)) {
        try {
          const installed = await getInstalledBrowsers({ cacheDir: dir });
          for (const item of installed) {
            if (item.browser === "chrome" && fs.existsSync(item.executablePath)) {
              return {
                executablePath: item.executablePath,
                isCfT: true,
                buildId: item.buildId,
              };
            }
          }
        } catch {
          // Continue checking
        }
      }
    }

    // 4. Resolve buildId from channel tag or fallback to pinned build
    let buildId: string;
    try {
      buildId = await resolveBuildId(Browser.CHROME, platform, channelTag as any);
    } catch {
      // Offline or network fallback
      buildId = "156.0.8078.47";
    }

    // 5. Check if expected executable path already exists
    const expectedExecutable = computeExecutablePath({
      browser: Browser.CHROME,
      buildId,
      platform,
      cacheDir: options.cacheDir,
    });

    if (fs.existsSync(expectedExecutable)) {
      return { executablePath: expectedExecutable, isCfT: true, buildId };
    }

    // 6. Download CfT
    try {
      fs.mkdirSync(options.cacheDir, { recursive: true });
      const installed = await install({
        browser: Browser.CHROME,
        buildId,
        platform,
        cacheDir: options.cacheDir,
      });

      return { executablePath: installed.executablePath, isCfT: true, buildId };
    } catch (downloadError: any) {
      // 7. Fallback to system Chrome if CfT download fails
      const systemChrome = this.getSystemChrome();
      if (systemChrome && fs.existsSync(systemChrome)) {
        return { executablePath: systemChrome, isCfT: false };
      }
      throw downloadError;
    }
  }

  /**
   * Checks whether system Chrome exists as a fallback.
   */
  public getSystemChrome(): string | undefined {
    try {
      return computeSystemExecutablePath({
        browser: Browser.CHROME,
        channel: "stable" as any,
      });
    } catch {
      return undefined;
    }
  }
}
