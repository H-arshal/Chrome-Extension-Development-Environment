import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import { SessionManager } from "../src/session/session-manager.js";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const CACHE_DIR = path.resolve(WORKSPACE_ROOT, ".cache/cft");
const HELPER_PATH = path.resolve(WORKSPACE_ROOT, "packages/helper-extension");
const FIXTURE_PATH = path.resolve(WORKSPACE_ROOT, "fixtures/minimal-content-script");

describe("SessionManager", () => {
  const sessionManager = new SessionManager();

  it("should initialize in Idle state", () => {
    expect(sessionManager.getState()).toBe("Idle");
    expect(sessionManager.getSessionInfo()).toBeNull();
  });

  it("should start a headless browser session and transition to Running", async () => {
    const states: string[] = [];
    sessionManager.on("stateChanged", (newState) => {
      states.push(newState);
    });

    const sessionInfo = await sessionManager.start({
      extensionPaths: [HELPER_PATH, FIXTURE_PATH],
      cacheDir: CACHE_DIR,
      headless: true,
      profileMode: "ephemeral",
    });

    expect(sessionInfo.pid).toBeGreaterThan(0);
    expect(sessionInfo.port).toBeGreaterThan(0);
    expect(sessionInfo.wsEndpoint).toContain("ws://");
    expect(sessionManager.getState()).toBe("Running");
    expect(states).toContain("Starting");
    expect(states).toContain("Running");

    // Clean up
    await sessionManager.stop();
    expect(sessionManager.getState()).toBe("Idle");
  }, 20000);

  afterAll(async () => {
    await sessionManager.stop();
  });
});
