import fs from "node:fs";
import path from "node:path";
import {
  launchCfT,
  getHelperExtensionPath,
  getContentScriptFixturePath,
} from "./browser-helper.js";

async function runSpikeS3() {
  console.log("==========================================================");
  console.log("  Running Phase 0 Spike S3: End-to-End Content Script Reload");
  console.log("==========================================================\n");

  const helperPath = getHelperExtensionPath();
  const contentFixturePath = getContentScriptFixturePath();
  const contentJsPath = path.join(contentFixturePath, "content.js");

  // Keep backup to restore file after test
  const originalContentJs = fs.readFileSync(contentJsPath, "utf-8");

  let session;
  try {
    session = await launchCfT({
      extensions: [helperPath, contentFixturePath],
      headless: false,
      startUrl: "https://example.com",
    });

    console.log(`[S3] Browser running on port ${session.port}`);
    await new Promise((r) => setTimeout(r, 2500));

    // Find Helper target
    const targets = session.browser.targets();
    const helperTarget = targets.find((t) =>
      t.url().includes("eomflhagkmibofdkojpcjbjbhmmjcckc")
    );
    if (!helperTarget) {
      throw new Error("Could not find Helper target");
    }

    const helperCdp = await helperTarget.createCDPSession();
    const listResult = await helperCdp.send("Runtime.evaluate", {
      expression: "globalThis.__extensionflow_list()",
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    const extensions: Array<{ id: string; name: string }> = listResult.result.value || [];
    const fixtureExt = extensions.find((e) =>
      e.name.includes("Minimal Content Script")
    );
    if (!fixtureExt) {
      throw new Error("Content script fixture not found in chrome.management list");
    }
    const fixtureId = fixtureExt.id;
    console.log(`[S3] Content Script Fixture ID: ${fixtureId}`);

    // Get or create page and navigate to example.com
    const pages = await session.browser.pages();
    const page = pages[0] || (await session.browser.newPage());
    console.log("[S3] Navigating to https://example.com...");
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });

    // Wait for initial v1 marker in DOM
    console.log("[S3] Waiting for initial content script injection (v1)...");
    await page.waitForSelector("#extensionflow-test-marker", { timeout: 5000 });
    const initialText = await page.$eval(
      "#extensionflow-test-marker",
      (el) => el.textContent
    );
    console.log(`[S3] Initial DOM marker found: "${initialText}"`);

    // SIMULATE CODE EDIT: Write v2 into content.js
    console.log("\n[S3] Simulating developer code edit in content.js (v1 -> v2)...");
    const v2Content = originalContentJs
      .replace('data-version", "1"', 'data-version", "2"')
      .replace("ExtensionFlow Test Marker v1", "ExtensionFlow Live Updated v2");

    const t0 = Date.now();
    fs.writeFileSync(contentJsPath, v2Content, "utf-8");

    // Execute Reload Method A via Helper
    console.log("[S3] Triggering Method A reload via Helper...");
    await helperCdp.send("Runtime.evaluate", {
      expression: `globalThis.__extensionflow_reload("${fixtureId}")`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    // Refresh matching tab
    console.log("[S3] Refreshing target page tab...");
    await page.reload({ waitUntil: "domcontentloaded" });

    // Wait for updated v2 marker
    await page.waitForFunction(
      () => {
        const el = document.getElementById("extensionflow-test-marker");
        return el && el.getAttribute("data-version") === "2";
      },
      { timeout: 4000 }
    );

    const elapsed = Date.now() - t0;
    const updatedText = await page.$eval(
      "#extensionflow-test-marker",
      (el) => el.textContent
    );

    console.log(`[S3] Updated DOM marker detected: "${updatedText}"`);
    console.log(`\n⏱️ [S3 TIMING]: Total edit-to-refresh cycle took: ${elapsed}ms`);

    if (elapsed < 3000) {
      console.log(`✅ [S3 PASS]: Completed in ${elapsed}ms (Exceeds < 3000ms target)!`);
    } else {
      console.log(`⚠️ [S3 NOTE]: Completed in ${elapsed}ms (Slightly above 3000ms cold target).`);
    }

    return true;
  } catch (error) {
    console.error("❌ [S3 FAIL]:", error);
    return false;
  } finally {
    // Restore original file content
    fs.writeFileSync(contentJsPath, originalContentJs, "utf-8");
    console.log("[S3] Restored fixture content.js to original version.");

    if (session) {
      console.log("[S3] Closing browser session...");
      await session.close();
      console.log("[S3] Cleanup complete.\n");
    }
  }
}

if (process.argv[1]?.endsWith("s3-e2e-content-script-reload.ts") || process.argv[1]?.endsWith("s3-e2e-content-script-reload.js")) {
  runSpikeS3().then((passed) => {
    process.exit(passed ? 0 : 1);
  });
}

export { runSpikeS3 };
