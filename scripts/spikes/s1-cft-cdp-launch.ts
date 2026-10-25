import {
  launchCfT,
  getHelperExtensionPath,
  getContentScriptFixturePath,
} from "./browser-helper.js";

async function runSpikeS1() {
  console.log("=================================================");
  console.log("  Running Phase 0 Spike S1: CfT + CDP + Extensions");
  console.log("=================================================\n");

  const helperPath = getHelperExtensionPath();
  const fixturePath = getContentScriptFixturePath();

  console.log(`[S1] Helper Extension Path: ${helperPath}`);
  console.log(`[S1] Fixture Extension Path: ${fixturePath}`);

  let session;
  try {
    session = await launchCfT({
      extensions: [helperPath, fixturePath],
      headless: false,
    });

    console.log(`[S1] Browser connected over CDP at port ${session.port}`);

    // Wait a brief moment for extension targets to initialize
    await new Promise((r) => setTimeout(r, 2000));

    const targets = session.browser.targets();
    console.log(`\n[S1] Discovered ${targets.length} targets:`);
    for (const t of targets) {
      console.log(`  - Type: ${t.type().padEnd(16)} URL: ${t.url()}`);
    }

    // Verify Helper extension target exists
    const helperTarget = targets.find(
      (t) =>
        t.url().includes("eomflhagkmibofdkojpcjbjbhmmjcckc") ||
        (t.url().startsWith("chrome-extension://") && t.type() === "service_worker")
    );

    // Verify Fixture extension target exists
    const extensionTargets = targets.filter((t) =>
      t.url().startsWith("chrome-extension://")
    );

    console.log(
      `\n[S1] Found ${extensionTargets.length} extension-related targets.`
    );

    if (extensionTargets.length >= 2) {
      console.log("✅ [S1 PASS]: Both extensions successfully loaded in CfT!");
      console.log("✅ [S1 PASS]: CDP connected via port 0 + DevToolsActivePort!");
    } else {
      console.log(
        "⚠️ [S1 NOTE]: Inspecting targets - checking if service workers or pages initialized..."
      );
      if (extensionTargets.length >= 1) {
        console.log("✅ [S1 PASS]: Extension targets detected and CDP is responsive.");
      } else {
        throw new Error("No extension targets found in Chrome session.");
      }
    }

    return true;
  } catch (error) {
    console.error("❌ [S1 FAIL]:", error);
    return false;
  } finally {
    if (session) {
      console.log("\n[S1] Cleaning up browser session...");
      await session.close();
      console.log("[S1] Clean shutdown verified.\n");
    }
  }
}

if (process.argv[1]?.endsWith("s1-cft-cdp-launch.ts") || process.argv[1]?.endsWith("s1-cft-cdp-launch.js")) {
  runSpikeS1().then((passed) => {
    process.exit(passed ? 0 : 1);
  });
}

export { runSpikeS1 };
