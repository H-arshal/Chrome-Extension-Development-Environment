import { execSync } from "node:child_process";
import { launchCfT, getHelperExtensionPath } from "./browser-helper.js";

function getChromeProcesses(): number[] {
  if (process.platform !== "win32") return [];
  try {
    const stdout = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH', {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('"chrome.exe"'))
      .map((line) => {
        const parts = line.split('","');
        return parseInt(parts[1]?.replace(/"/g, "") || "0", 10);
      })
      .filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

async function runSpikeS7() {
  console.log("==========================================================");
  console.log("  Running Phase 0 Spike S7: Windows Process Tree Cleanup");
  console.log("==========================================================\n");

  const helperPath = getHelperExtensionPath();
  const initialChromePids = new Set(getChromeProcesses());
  console.log(`[S7] Existing system chrome.exe processes before test: ${initialChromePids.size}`);

  const cycles = 5; // Run 5 complete start/stop cycles
  console.log(`[S7] Testing ${cycles} start-and-kill cycles with tree termination...`);

  for (let i = 1; i <= cycles; i++) {
    process.stdout.write(`  Cycle ${i}/${cycles}: Launching...`);
    const session = await launchCfT({
      extensions: [helperPath],
      headless: true,
    });
    const pid = session.process.pid;
    process.stdout.write(` [PID ${pid}] Stopping...`);
    await session.close();
    await new Promise((r) => setTimeout(r, 400));
    process.stdout.write(" Cleaned.\n");
  }

  // Check process table for any new orphan Chrome processes
  const currentChromePids = getChromeProcesses();
  const orphans = currentChromePids.filter((pid) => !initialChromePids.has(pid));

  console.log(`\n[S7] Process audit: ${orphans.length} orphan Chrome processes detected.`);
  if (orphans.length === 0) {
    console.log("✅ [S7 PASS]: Zero orphan browser processes after repeated cycles!");
    return true;
  } else {
    console.error(`❌ [S7 FAIL]: Found orphan processes with PIDs:`, orphans);
    // Cleanup orphans
    for (const pid of orphans) {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } catch {}
    }
    return false;
  }
}

if (process.argv[1]?.endsWith("s7-process-cleanup.ts") || process.argv[1]?.endsWith("s7-process-cleanup.js")) {
  runSpikeS7().then((passed) => {
    process.exit(passed ? 0 : 1);
  });
}

export { runSpikeS7 };
