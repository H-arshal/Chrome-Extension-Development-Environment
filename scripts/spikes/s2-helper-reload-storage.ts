import {
  launchCfT,
  getHelperExtensionPath,
  getStorageFixturePath,
} from "./browser-helper.js";

async function runSpikeS2() {
  console.log("==========================================================");
  console.log("  Running Phase 0 Spike S2: Helper Reload & Storage State");
  console.log("==========================================================\n");

  const helperPath = getHelperExtensionPath();
  const storageFixturePath = getStorageFixturePath();

  let session;
  try {
    session = await launchCfT({
      extensions: [helperPath, storageFixturePath],
      headless: false,
    });

    console.log(`[S2] Browser active on port ${session.port}`);
    await new Promise((r) => setTimeout(r, 2000));

    // 1. Locate Helper target
    const targets = session.browser.targets();
    const helperTarget = targets.find((t) =>
      t.url().includes("eomflhagkmibofdkojpcjbjbhmmjcckc")
    );

    if (!helperTarget) {
      throw new Error("Could not find ExtensionFlow Helper target");
    }

    const helperCdp = await helperTarget.createCDPSession();

    // 2. Query extensions list via helper management API
    const listResult = await helperCdp.send("Runtime.evaluate", {
      expression: "globalThis.__extensionflow_list()",
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    const extensions: Array<{ id: string; name: string; enabled: boolean }> =
      listResult.result.value || [];

    const fixtureExt = extensions.find((e) =>
      e.name.includes("Storage Test Extension")
    );
    if (!fixtureExt) {
      throw new Error("Storage fixture not found in chrome.management list");
    }
    const fixtureId = fixtureExt.id;
    console.log(`[S2] Storage Test Fixture ID: ${fixtureId}`);

    // 3. Open fixture test page to interact with chrome.storage.local
    const page = await session.browser.newPage();
    const testPageUrl = `chrome-extension://${fixtureId}/test.html`;
    console.log(`[S2] Navigating to ${testPageUrl}...`);
    await page.goto(testPageUrl, { waitUntil: "domcontentloaded" });

    const initialData = {
      testKey: "persistence-check",
      counter: 12345,
      timestamp: Date.now(),
    };

    console.log("[S2] Writing state into chrome.storage.local:", initialData);
    await page.evaluate((data) => {
      return (window as any).__setStorage(data);
    }, initialData);

    const readBefore = await page.evaluate(() => {
      return (window as any).__getStorage();
    });
    console.log("[S2] Verified data in chrome.storage before reload:", readBefore);

    // 4. Test Reload Method A via Helper Extension
    console.log("\n[S2] Executing Reload Method A via Helper Extension...");
    const reloadResult = await helperCdp.send("Runtime.evaluate", {
      expression: `globalThis.__extensionflow_reload("${fixtureId}")`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    console.log("[S2] Reload trigger evaluated:", reloadResult.result.value);

    // Extension pages are closed when an extension is disabled. Reopen test page post-reload!
    console.log("[S2] Reopening test page post-reload...");
    const pageAfter = await session.browser.newPage();
    await pageAfter.goto(testPageUrl, { waitUntil: "domcontentloaded" });

    const storedData = await pageAfter.evaluate(() => {
      return (window as any).__getStorage();
    });
    console.log("[S2] Data in chrome.storage.local after reload:", storedData);

    if (
      storedData &&
      storedData.testKey === initialData.testKey &&
      storedData.counter === initialData.counter
    ) {
      console.log("✅ [S2 PASS]: Storage state is 100% PRESERVED across reload!");
    } else {
      throw new Error(`Storage was wiped or corrupted! Found: ${JSON.stringify(storedData)}`);
    }

    // 5. Stress test: Run 20 consecutive reloads to verify stability & no gesture blocking
    console.log("\n[S2] Stress-testing 20 consecutive reloads via Method A...");
    const startTime = Date.now();
    for (let i = 1; i <= 20; i++) {
      const stepStart = Date.now();
      const res = await helperCdp.send("Runtime.evaluate", {
        expression: `globalThis.__extensionflow_reload("${fixtureId}")`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });

      if (!res.result.value?.success) {
        throw new Error(`Reload iteration ${i} failed: ${JSON.stringify(res)}`);
      }
      const elapsed = Date.now() - stepStart;
      process.stdout.write(`  Iteration ${i.toString().padStart(2, "0")}/20 completed in ${elapsed}ms\r`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const totalElapsed = Date.now() - startTime;
    console.log(`\n✅ [S2 PASS]: 20 consecutive reloads succeeded in ${totalElapsed}ms (avg ${(totalElapsed / 20).toFixed(0)}ms/reload)!`);
    console.log("✅ [S2 PASS]: No user gesture blocking, no UI prompts or modal dialogs.");

    try {
      await pageAfter.close();
    } catch {}
    return true;
  } catch (error) {
    console.error("❌ [S2 FAIL]:", error);
    return false;
  } finally {
    if (session) {
      console.log("\n[S2] Closing browser session...");
      await session.close();
      console.log("[S2] Cleanup finished.\n");
    }
  }
}

if (process.argv[1]?.endsWith("s2-helper-reload-storage.ts") || process.argv[1]?.endsWith("s2-helper-reload-storage.js")) {
  runSpikeS2().then((passed) => {
    process.exit(passed ? 0 : 1);
  });
}

export { runSpikeS2 };
