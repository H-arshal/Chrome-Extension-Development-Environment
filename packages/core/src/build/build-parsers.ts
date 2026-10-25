import path from "node:path";
import type { BuildProblem } from "../diagnostics/diagnostic-types.js";

export class BuildParsers {
  /**
   * Parses terminal output from tsc, esbuild, vite, or webpack into structured BuildProblems.
   */
  public static parse(output: string, workspaceRoot: string): BuildProblem[] {
    const problems: BuildProblem[] = [];
    const lines = output.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 1. TypeScript compiler (tsc)
      // Example: src/background.ts(15,9): error TS2322: Type 'string' is not assignable to type 'number'.
      const tscMatch = line.match(/^([^(]+)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+)?:\s*(.+)$/i);
      if (tscMatch) {
        const [, relFile, lineNum, colNum, sev, code, msg] = tscMatch;
        problems.push({
          file: path.resolve(workspaceRoot, relFile.trim()),
          line: parseInt(lineNum, 10),
          column: parseInt(colNum, 10),
          message: code ? `${code}: ${msg}` : msg,
          severity: sev.toLowerCase() === "error" ? "error" : "warning",
          code,
          source: "tsc",
        });
        continue;
      }

      // 2. esbuild
      // Example: ✘ [ERROR] Could not resolve "foo"
      //              src/index.ts:3:7:
      if (line.includes("[ERROR]") || line.includes("[WARNING]")) {
        const isError = line.includes("[ERROR]");
        const msg = line.replace(/.*\[(ERROR|WARNING)\]\s*/, "").trim();

        // Scan ahead up to 4 lines for file:line:col:
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 4); j++) {
          const aheadLine = lines[j];
          const esbuildLoc = aheadLine.match(/^\s*([^:\s]+):(\d+):(\d+):?/);
          if (esbuildLoc) {
            const [, relFile, lineNum, colNum] = esbuildLoc;
            problems.push({
              file: path.resolve(workspaceRoot, relFile.trim()),
              line: parseInt(lineNum, 10),
              column: parseInt(colNum, 10),
              message: msg,
              severity: isError ? "error" : "warning",
              source: "esbuild",
            });
            i = j; // skip forward
            break;
          }
        }
        continue;
      }

      // 3. Generic/Vite/Webpack location matcher
      // Example: /path/to/src/app.ts:45:10 - error: Something failed
      const genericMatch = line.match(/^([^:\s]+):(\d+):(\d+)\s*[-:]\s*(error|warning)?\s*(.+)$/i);
      if (genericMatch) {
        const [, relFile, lineNum, colNum, sev, msg] = genericMatch;
        if (relFile.endsWith(".ts") || relFile.endsWith(".js") || relFile.endsWith(".tsx") || relFile.endsWith(".jsx")) {
          problems.push({
            file: path.resolve(workspaceRoot, relFile.trim()),
            line: parseInt(lineNum, 10),
            column: parseInt(colNum, 10),
            message: msg.trim(),
            severity: sev?.toLowerCase() === "warning" ? "warning" : "error",
            source: "build",
          });
        }
      }
    }

    return problems;
  }
}
