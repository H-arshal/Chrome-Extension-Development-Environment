import { runSpikeS1 } from "./s1-cft-cdp-launch.js";
import { runSpikeS2 } from "./s2-helper-reload-storage.js";
import { runSpikeS3 } from "./s3-e2e-content-script-reload.js";
import { runSpikeS7 } from "./s7-process-cleanup.js";

async function main() {
  console.log("===============================================================");
  console.log("  🚀 EXTENSIONFLOW PHASE 0 FEASIBILITY SPIKES SUITE (GATE M0)  ");
  console.log("===============================================================\n");

  const results: Record<string, boolean> = {};

  console.log(">>> [1/4] Starting Spike S1 (CfT + CDP + Extension Loading)...");
  results["S1: CfT Launch & CDP"] = await runSpikeS1();

  if (!results["S1: CfT Launch & CDP"]) {
    console.error("\n❌ Spike S1 FAILED. Halting remaining spikes as S1 is foundational.");
    process.exit(1);
  }

  console.log("\n>>> [2/4] Starting Spike S2 (Method A Helper Reload & Storage)...");
  results["S2: Helper Reload & Storage"] = await runSpikeS2();

  console.log("\n>>> [3/4] Starting Spike S3 (E2E Content Script Reload < 3s)...");
  results["S3: E2E Content Script Loop"] = await runSpikeS3();

  console.log("\n>>> [4/4] Starting Spike S7 (Windows Process Tree Cleanup)...");
  results["S7: Process Cleanup"] = await runSpikeS7();

  console.log("\n===============================================================");
  console.log("                   PHASE 0 GATE RESULTS                        ");
  console.log("===============================================================");

  let allPassed = true;
  for (const [spike, passed] of Object.entries(results)) {
    console.log(`  ${passed ? "✅ PASS" : "❌ FAIL"} - ${spike}`);
    if (!passed) allPassed = false;
  }

  console.log("===============================================================");
  if (allPassed) {
    console.log("🎉 ALL PHASE 0 SPIKES PASSED! VERDICT: GO FOR MILESTONE M1.");
  } else {
    console.log("⚠️ ONE OR MORE SPIKES FAILED. REVIEW REQUIRED BEFORE PROCEEDING.");
  }
  console.log("===============================================================\n");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error during spikes execution:", err);
  process.exit(1);
});
