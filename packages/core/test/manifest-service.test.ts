import { describe, it, expect } from "vitest";
import path from "node:path";
import { ManifestService } from "../src/project/manifest-service.js";
import { ProjectDetector } from "../src/project/project-detector.js";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const MINIMAL_FIXTURE_PATH = path.join(
  WORKSPACE_ROOT,
  "fixtures/minimal-content-script/manifest.json"
);
const STORAGE_FIXTURE_PATH = path.join(
  WORKSPACE_ROOT,
  "fixtures/storage-test-extension/manifest.json"
);

describe("ManifestService", () => {
  const service = new ManifestService();

  it("should validate and map resources from minimal content script fixture", () => {
    const res = service.parseAndValidate(MINIMAL_FIXTURE_PATH);
    expect(res.valid).toBe(true);
    expect(res.manifestVersion).toBe(3);
    expect(res.name).toBe("Fixture: Minimal Content Script");
    expect(res.diagnostics).toHaveLength(0);

    // Verify background worker component
    const sw = res.components.find((c) => c.type === "service_worker");
    expect(sw).toBeDefined();
    expect(sw?.exists).toBe(true);
    expect(sw?.relativePath).toBe("background.js");

    // Verify content script component
    const cs = res.components.find((c) => c.type === "content_script");
    expect(cs).toBeDefined();
    expect(cs?.exists).toBe(true);
    expect(cs?.matches).toContain("https://example.com/*");
  });

  it("should validate storage fixture", () => {
    const res = service.parseAndValidate(STORAGE_FIXTURE_PATH);
    expect(res.valid).toBe(true);
    expect(res.name).toBe("Fixture: Storage Test Extension");
  });

  it("should generate diagnostic for missing manifest file", () => {
    const res = service.parseAndValidate("non/existent/manifest.json");
    expect(res.valid).toBe(false);
    expect(res.diagnostics.length).toBeGreaterThan(0);
    expect(res.diagnostics[0].code).toBe("MANIFEST_NOT_FOUND");
  });
});

describe("ProjectDetector", () => {
  const detector = new ProjectDetector();

  it("should discover all fixture extensions in the workspace", () => {
    const projects = detector.findProjects(path.join(WORKSPACE_ROOT, "fixtures"));
    expect(projects.length).toBeGreaterThanOrEqual(2);
    const names = projects.map((p) => p.name);
    expect(names).toContain("Fixture: Minimal Content Script");
    expect(names).toContain("Fixture: Storage Test Extension");
  });
});
