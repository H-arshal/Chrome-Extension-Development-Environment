import { spawn, ChildProcess } from "node:child_process";
import { BuildParsers } from "./build-parsers.js";
import type { BuildProblem } from "../diagnostics/diagnostic-types.js";

export interface BuildResult {
  success: boolean;
  problems: BuildProblem[];
  rawOutput: string;
  durationMs: number;
}

export class BuildRunner {
  private activeProcess: ChildProcess | null = null;

  /**
   * Runs a build command, serializing calls and cancelling any active in-flight build.
   */
  public async runBuild(
    command: string,
    workspaceRoot: string,
    settleDelayMs = 300
  ): Promise<BuildResult> {
    // 1. Cancel previous in-flight build
    if (this.activeProcess) {
      try {
        if (process.platform === "win32") {
          this.activeProcess.kill();
        } else {
          this.activeProcess.kill("SIGTERM");
        }
      } catch {}
      this.activeProcess = null;
    }

    const startTime = Date.now();
    let rawOutput = "";

    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd: workspaceRoot,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.activeProcess = child;

      child.stdout?.on("data", (chunk) => {
        rawOutput += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        rawOutput += chunk.toString();
      });

      child.on("close", async (code) => {
        if (this.activeProcess === child) {
          this.activeProcess = null;
        }

        const problems = BuildParsers.parse(rawOutput, workspaceRoot);
        const success = code === 0 && !problems.some((p) => p.severity === "error");

        // Settle delay: wait 300ms post-build write window (PRD section 6.6)
        if (success && settleDelayMs > 0) {
          await new Promise((r) => setTimeout(r, settleDelayMs));
        }

        resolve({
          success,
          problems,
          rawOutput,
          durationMs: Date.now() - startTime,
        });
      });

      child.on("error", (err) => {
        resolve({
          success: false,
          problems: [
            {
              file: workspaceRoot,
              line: 1,
              column: 1,
              message: `Failed to execute build command: ${err.message}`,
              severity: "error",
              source: "BuildRunner",
            },
          ],
          rawOutput: err.message,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  public cancel(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch {}
      this.activeProcess = null;
    }
  }
}
