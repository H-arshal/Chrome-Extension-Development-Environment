import type { Browser as PuppeteerBrowser, Page } from "puppeteer-core";
import { TabMatcher } from "./tab-matcher.js";
import type { ReloadPlan, ReloadResult, ReloadMethod } from "./reload-types.js";

const HELPER_EXTENSION_ID = "eomflhagkmibofdkojpcjbjbhmmjcckc";

export class ReloadExecutor {
  private isExecuting = false;
  private queuedPlan: ReloadPlan | null = null;
  private methodAFailures = 0;

  /**
   * Queries the Helper extension or active targets to discover the target extension ID dynamically.
   */
  public static async findTargetExtensionId(
    browser: PuppeteerBrowser,
    extensionName?: string
  ): Promise<string | null> {
    const targets = browser.targets();

    // 1. Direct discovery from active browser targets (pages, workers, side panels)
    for (const t of targets) {
      const match = t.url().match(/^chrome-extension:\/\/([a-p]{32})/);
      if (match && match[1] !== HELPER_EXTENSION_ID) {
        return match[1];
      }
    }

    // 2. Discover via Helper Extension management API
    let helperTarget = targets.find((t) => t.url().includes(HELPER_EXTENSION_ID));

    // If helper service worker is asleep, wake it up by opening/checking control.html
    if (!helperTarget) {
      try {
        const page = await browser.newPage();
        await page.goto(`chrome-extension://${HELPER_EXTENSION_ID}/control.html`, {
          waitUntil: "domcontentloaded",
          timeout: 3000,
        });
        helperTarget = browser.targets().find((t) => t.url().includes(HELPER_EXTENSION_ID));
      } catch {
        // Fallback continues
      }
    }

    if (!helperTarget) return null;

    try {
      const cdp = await helperTarget.createCDPSession();
      const list = await cdp.send("Runtime.evaluate", {
        expression: "globalThis.__extensionflow_list()",
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });

      const extensions: Array<{ id: string; name: string; installType: string }> =
        list?.result?.value || [];

      // Prioritize unpacked development extension
      const devExtensions = extensions.filter(
        (e) => e.id !== HELPER_EXTENSION_ID && (e.installType === "development" || !e.installType)
      );

      if (extensionName) {
        const matchByName = devExtensions.find(
          (e) => e.name.toLowerCase() === extensionName.toLowerCase()
        );
        if (matchByName) return matchByName.id;
      }

      if (devExtensions.length === 1) {
        return devExtensions[0].id;
      }

      const anyNonHelper = extensions.find((e) => e.id !== HELPER_EXTENSION_ID);
      return anyNonHelper ? anyNonHelper.id : null;
    } catch {
      return null;
    }
  }

  /**
   * Executes a reload plan against the active browser session.
   */
  public async execute(
    browser: PuppeteerBrowser,
    targetExtensionId: string,
    plan: ReloadPlan,
    onRestartRequest?: () => Promise<void>
  ): Promise<ReloadResult> {
    if (this.isExecuting) {
      // Coalesce into queued follow-up plan (FR-18)
      this.queuedPlan = plan;
      return {
        success: true,
        methodUsed: "A",
        durationMs: 0,
        plan,
        refreshedTabs: [],
      };
    }

    this.isExecuting = true;
    const startTime = Date.now();
    const refreshedTabs: string[] = [];
    let methodUsed: ReloadMethod = "A";

    try {
      if (plan.action === "noop") {
        return {
          success: true,
          methodUsed: "A",
          durationMs: 0,
          plan,
          refreshedTabs: [],
        };
      }

      // 1. Popup Refresh
      if (plan.action === "refresh_popup") {
        // Toggle extension via Method A so Chrome re-reads popup files from disk
        await this.executeMethodA(browser, targetExtensionId).catch(() => {});
        await this.refreshPopupPreview(browser, targetExtensionId);
        return {
          success: true,
          methodUsed: "A",
          durationMs: Date.now() - startTime,
          plan,
          refreshedTabs: ["Popup Preview"],
        };
      }

      // 2. Extension Reload (Ladder Step A or D)
      if (this.methodAFailures < 2) {
        methodUsed = "A";
        const success = await this.executeMethodA(browser, targetExtensionId);
        if (!success) {
          this.methodAFailures++;
          throw new Error("Reload Method A failed to toggle extension via Helper.");
        }
      } else {
        // Fallback to Method D (Session restart)
        methodUsed = "D";
        if (onRestartRequest) {
          await onRestartRequest();
        } else {
          throw new Error("Reload Method A failed and restart handler is not configured.");
        }
      }

      // 3. Tab Refresh if action requires it
      if (plan.action === "reload_extension_and_tabs" && plan.matchingPatterns.length > 0) {
        const refreshed = await this.refreshMatchingTabs(browser, plan.matchingPatterns);
        refreshedTabs.push(...refreshed);
      }

      // Also refresh popup preview tab if currently open
      await this.refreshOpenExtensionTabs(browser, targetExtensionId);

      const durationMs = Date.now() - startTime;
      return {
        success: true,
        methodUsed,
        durationMs,
        plan,
        refreshedTabs,
      };
    } catch (err: any) {
      return {
        success: false,
        methodUsed,
        durationMs: Date.now() - startTime,
        plan,
        error: err.message,
        refreshedTabs,
      };
    } finally {
      this.isExecuting = false;

      // Handle queued follow-up plan
      if (this.queuedPlan) {
        const nextPlan = this.queuedPlan;
        this.queuedPlan = null;
        await this.execute(browser, targetExtensionId, nextPlan, onRestartRequest);
      }
    }
  }

  /**
   * Executes Reload Method A by toggling the target extension via the Helper extension.
   */
  private async executeMethodA(
    browser: PuppeteerBrowser,
    targetExtensionId: string
  ): Promise<boolean> {
    let helperTarget = browser
      .targets()
      .find((t) => t.url().includes(HELPER_EXTENSION_ID));

    if (!helperTarget) {
      try {
        const page = await browser.newPage();
        await page.goto(`chrome-extension://${HELPER_EXTENSION_ID}/control.html`, {
          waitUntil: "domcontentloaded",
          timeout: 3000,
        });
        helperTarget = browser.targets().find((t) => t.url().includes(HELPER_EXTENSION_ID));
      } catch {
        // Fallback continues
      }
    }

    if (!helperTarget) {
      throw new Error("ExtensionFlow Helper extension target not found in browser.");
    }

    const cdp = await helperTarget.createCDPSession();
    const result = await cdp.send("Runtime.evaluate", {
      expression: `globalThis.__extensionflow_reload("${targetExtensionId}")`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    return !!result?.result?.value?.success;
  }

  /**
   * Refreshes all open browser tabs matching content script URL patterns.
   */
  private async refreshMatchingTabs(
    browser: PuppeteerBrowser,
    patterns: string[]
  ): Promise<string[]> {
    const refreshed: string[] = [];
    const pages = await browser.pages();

    for (const page of pages) {
      const url = page.url();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        continue;
      }

      if (TabMatcher.matchesAny(url, patterns)) {
        try {
          await page.reload({ waitUntil: "domcontentloaded" });
          refreshed.push(url);
        } catch {
          // Tab may have navigated or closed
        }
      }
    }

    return refreshed;
  }

  /**
   * Opens or refreshes the Popup Preview tab.
   */
  public async refreshPopupPreview(
    browser: PuppeteerBrowser,
    targetExtensionId: string,
    popupRelativePath = "popup.html"
  ): Promise<Page> {
    const popupUrl = `chrome-extension://${targetExtensionId}/${popupRelativePath}`;
    const pages = await browser.pages();

    let popupPage = pages.find((p) => p.url().includes(popupUrl));
    if (popupPage) {
      await popupPage.reload({ waitUntil: "domcontentloaded" });
      await popupPage.bringToFront();
    } else {
      popupPage = await browser.newPage();
      await popupPage.goto(popupUrl, { waitUntil: "domcontentloaded" });
    }

    return popupPage;
  }

  /**
   * Refreshes any open extension pages (options, popup preview, sidepanel).
   */
  private async refreshOpenExtensionTabs(
    browser: PuppeteerBrowser,
    targetExtensionId: string
  ): Promise<void> {
    const pages = await browser.pages();
    for (const page of pages) {
      const url = page.url();
      if (url.startsWith(`chrome-extension://${targetExtensionId}/`)) {
        try {
          await page.reload({ waitUntil: "domcontentloaded" });
        } catch {}
      }
    }
  }
}
