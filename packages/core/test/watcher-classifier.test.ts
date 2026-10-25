import { describe, it, expect } from "vitest";
import path from "node:path";
import { TabMatcher } from "../src/reload/tab-matcher.js";
import { ChangeClassifier } from "../src/watcher/change-classifier.js";
import { ManifestService } from "../src/project/manifest-service.js";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const MINIMAL_FIXTURE_PATH = path.join(
  WORKSPACE_ROOT,
  "fixtures/minimal-content-script/manifest.json"
);

describe("TabMatcher", () => {
  it("should match wildcard domain patterns", () => {
    expect(
      TabMatcher.matchesAny("https://example.com/test", ["https://example.com/*"])
    ).toBe(true);
    expect(
      TabMatcher.matchesAny("https://sub.example.com/page", ["https://*.example.com/*"])
    ).toBe(true);
    expect(
      TabMatcher.matchesAny("http://google.com/", ["https://example.com/*"])
    ).toBe(false);
  });

  it("should match <all_urls>", () => {
    expect(TabMatcher.matchesAny("https://anything.org/path", ["<all_urls>"])).toBe(true);
    expect(TabMatcher.matchesAny("chrome://extensions", ["<all_urls>"])).toBe(false);
  });
});

describe("ChangeClassifier", () => {
  const service = new ManifestService();
  const manifestResult = service.parseAndValidate(MINIMAL_FIXTURE_PATH);
  const classifier = new ChangeClassifier();

  it("should classify manifest.json changes as reload_extension_and_tabs", () => {
    const plan = classifier.classify(
      [path.join(manifestResult.extensionRoot, "manifest.json")],
      manifestResult
    );
    expect(plan.action).toBe("reload_extension_and_tabs");
    expect(plan.isFallback).toBe(false);
  });

  it("should classify content.js changes as reload_extension_and_tabs with matching patterns", () => {
    const plan = classifier.classify(
      [path.join(manifestResult.extensionRoot, "content.js")],
      manifestResult
    );
    expect(plan.action).toBe("reload_extension_and_tabs");
    expect(plan.matchingPatterns).toContain("https://example.com/*");
    expect(plan.isFallback).toBe(false);
  });

  it("should classify background.js changes as reload_extension", () => {
    const plan = classifier.classify(
      [path.join(manifestResult.extensionRoot, "background.js")],
      manifestResult
    );
    expect(plan.action).toBe("reload_extension");
    expect(plan.isFallback).toBe(false);
  });

  it("should treat unknown files with conservative fallback", () => {
    const plan = classifier.classify(
      [path.join(manifestResult.extensionRoot, "random-script.ts")],
      manifestResult
    );
    expect(plan.action).toBe("reload_extension_and_tabs");
    expect(plan.isFallback).toBe(true);
  });

  it("should merge a batch and prioritize higher impact actions", () => {
    const plan = classifier.classify(
      [
        path.join(manifestResult.extensionRoot, "background.js"), // reload_extension
        path.join(manifestResult.extensionRoot, "content.js"),    // reload_extension_and_tabs
      ],
      manifestResult
    );
    expect(plan.action).toBe("reload_extension_and_tabs");
    expect(plan.affectedFiles).toHaveLength(2);
  });
});
