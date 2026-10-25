import { describe, it, expect } from "vitest";
import { BuildParsers } from "../src/build/build-parsers.js";

describe("BuildParsers", () => {
  const workspaceRoot = "/workspace";

  it("should parse TypeScript compiler errors", () => {
    const tscOutput = `
src/background.ts(15,9): error TS2322: Type 'string' is not assignable to type 'number'.
src/content.ts(4,1): warning TS6133: 'unusedVar' is declared but its value is never read.
`;
    const problems = BuildParsers.parse(tscOutput, workspaceRoot);
    expect(problems).toHaveLength(2);

    expect(problems[0].line).toBe(15);
    expect(problems[0].column).toBe(9);
    expect(problems[0].severity).toBe("error");
    expect(problems[0].code).toBe("TS2322");
    expect(problems[0].source).toBe("tsc");

    expect(problems[1].line).toBe(4);
    expect(problems[1].severity).toBe("warning");
  });

  it("should parse esbuild errors", () => {
    const esbuildOutput = `
✘ [ERROR] Could not resolve "missing-module"

    src/index.ts:3:7:
      3 │ import { foo } from "missing-module";
        ╵                     ~~~~~~~~~~~~~~~~
`;
    const problems = BuildParsers.parse(esbuildOutput, workspaceRoot);
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(3);
    expect(problems[0].column).toBe(7);
    expect(problems[0].message).toContain("Could not resolve");
    expect(problems[0].source).toBe("esbuild");
  });

  it("should parse generic file:line:col errors", () => {
    const output = `src/popup.ts:10:25: error: Syntax error in file`;
    const problems = BuildParsers.parse(output, workspaceRoot);
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(10);
    expect(problems[0].column).toBe(25);
    expect(problems[0].severity).toBe("error");
  });
});
