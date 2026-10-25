import path from "node:path";
import type { ManifestValidationResult } from "../project/types.js";
import type { ReloadPlan, ReloadActionType } from "../reload/reload-types.js";

const ACTION_PRIORITY: Record<ReloadActionType, number> = {
  reload_extension_and_tabs: 5,
  reload_extension: 4,
  refresh_popup: 3,
  refresh_page: 2,
  noop: 1,
};

export class ChangeClassifier {
  /**
   * Classifies a batch of changed files against the extension manifest map.
   */
  public classify(
    changedFilePaths: string[],
    manifestResult: ManifestValidationResult
  ): ReloadPlan {
    const extensionRoot = manifestResult.extensionRoot;
    const plans: ReloadPlan[] = [];

    for (const filePath of changedFilePaths) {
      const relPath = path.relative(extensionRoot, path.resolve(filePath)).replace(/\\/g, "/");
      const fileName = path.basename(filePath).toLowerCase();

      // 1. Manifest
      if (fileName === "manifest.json") {
        plans.push({
          action: "reload_extension_and_tabs",
          reasons: ["Manifest file changed"],
          affectedFiles: [relPath],
          matchingPatterns: this.getAllContentScriptPatterns(manifestResult),
          isFallback: false,
        });
        continue;
      }

      let matched = false;

      // 2. Check declared components
      for (const comp of manifestResult.components) {
        const compRel = comp.relativePath.replace(/\\/g, "/");

        // Check primary file
        let isDirectMatch = compRel === relPath;

        // Check extra files (e.g. multiple content script JS/CSS files)
        if (!isDirectMatch && comp.extraFiles) {
          isDirectMatch = comp.extraFiles.some(
            (f) => f.relativePath.replace(/\\/g, "/") === relPath
          );
        }

        if (isDirectMatch) {
          matched = true;
          switch (comp.type) {
            case "service_worker":
              plans.push({
                action: "reload_extension",
                reasons: [`Service worker '${relPath}' changed`],
                affectedFiles: [relPath],
                matchingPatterns: [],
                isFallback: false,
              });
              break;

            case "content_script":
              plans.push({
                action: "reload_extension_and_tabs",
                reasons: [`Content script file '${relPath}' changed`],
                affectedFiles: [relPath],
                matchingPatterns: comp.matches || [],
                isFallback: false,
              });
              break;

            case "popup":
              plans.push({
                action: "refresh_popup",
                reasons: [`Popup file '${relPath}' changed`],
                affectedFiles: [relPath],
                matchingPatterns: [],
                isFallback: false,
              });
              break;

            case "options":
            case "side_panel":
            case "new_tab":
              plans.push({
                action: "refresh_page",
                reasons: [`Extension page '${relPath}' changed`],
                affectedFiles: [relPath],
                matchingPatterns: [],
                targetPageUrl: relPath,
                isFallback: false,
              });
              break;

            case "declarative_net_request":
            case "icon":
            case "locale":
              plans.push({
                action: "reload_extension",
                reasons: [`Extension resource '${relPath}' changed`],
                affectedFiles: [relPath],
                matchingPatterns: [],
                isFallback: false,
              });
              break;
          }
          break;
        }
      }

      if (!matched) {
        // Conservative fallback (PRD Section 5.3 & FR-19)
        plans.push({
          action: "reload_extension_and_tabs",
          reasons: [`Unmapped/Unknown file '${relPath}' changed (conservative fallback)`],
          affectedFiles: [relPath],
          matchingPatterns: this.getAllContentScriptPatterns(manifestResult),
          isFallback: true,
        });
      }
    }

    return this.mergePlans(plans);
  }

  /**
   * Merges multiple plans in a batch, selecting the highest-impact action.
   */
  private mergePlans(plans: ReloadPlan[]): ReloadPlan {
    if (plans.length === 0) {
      return {
        action: "noop",
        reasons: ["No changes detected"],
        affectedFiles: [],
        matchingPatterns: [],
        isFallback: false,
      };
    }

    let winningAction: ReloadActionType = "noop";
    const allReasons: string[] = [];
    const allAffected = new Set<string>();
    const allPatterns = new Set<string>();
    let targetPageUrl: string | undefined;
    let isFallback = false;

    for (const plan of plans) {
      if (ACTION_PRIORITY[plan.action] > ACTION_PRIORITY[winningAction]) {
        winningAction = plan.action;
        targetPageUrl = plan.targetPageUrl;
      }
      if (plan.isFallback) isFallback = true;

      plan.reasons.forEach((r) => allReasons.push(r));
      plan.affectedFiles.forEach((f) => allAffected.add(f));
      plan.matchingPatterns.forEach((p) => allPatterns.add(p));
    }

    return {
      action: winningAction,
      reasons: allReasons,
      affectedFiles: Array.from(allAffected),
      matchingPatterns: Array.from(allPatterns),
      targetPageUrl,
      isFallback,
    };
  }

  private getAllContentScriptPatterns(manifestResult: ManifestValidationResult): string[] {
    const patterns = new Set<string>();
    for (const comp of manifestResult.components) {
      if (comp.type === "content_script" && comp.matches) {
        comp.matches.forEach((m) => patterns.add(m));
      }
    }
    return Array.from(patterns);
  }
}
