import fs from "node:fs";
import path from "node:path";
import type { DiscoveredProject } from "./types.js";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".vscode",
  ".idea",
  "dist",
  "build",
  "coverage",
]);

export class ProjectDetector {
  /**
   * Recursively discovers all Chrome extension projects in a workspace.
   */
  public findProjects(workspaceRoot: string, maxDepth = 4): DiscoveredProject[] {
    const projects: DiscoveredProject[] = [];
    const visited = new Set<string>();

    const scan = (currentDir: string, depth: number) => {
      if (depth > maxDepth || visited.has(currentDir)) return;
      visited.add(currentDir);

      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        // Check if current directory has a manifest.json
        const hasManifest = entries.some(
          (e) => e.isFile() && e.name.toLowerCase() === "manifest.json"
        );

        if (hasManifest) {
          const manifestPath = path.join(currentDir, "manifest.json");
          try {
            const content = fs.readFileSync(manifestPath, "utf-8");
            const raw = JSON.parse(content);
            if (raw && typeof raw === "object") {
              const framework = this.detectFramework(currentDir, workspaceRoot);
              projects.push({
                extensionRoot: currentDir,
                manifestPath,
                name: raw.name || path.basename(currentDir),
                version: raw.version || "1.0.0",
                manifestVersion: raw.manifest_version || 3,
                framework,
              });
            }
          } catch {
            // Unparseable JSON still recorded
            projects.push({
              extensionRoot: currentDir,
              manifestPath,
              name: path.basename(currentDir),
              version: "unknown",
              manifestVersion: 3,
              framework: "plain",
            });
          }
        }

        // Recurse subdirectories
        for (const entry of entries) {
          if (entry.isDirectory() && !DEFAULT_IGNORED_DIRS.has(entry.name)) {
            scan(path.join(currentDir, entry.name), depth + 1);
          }
        }
      } catch {
        // Ignore read permission errors
      }
    };

    scan(workspaceRoot, 0);
    return projects;
  }

  /**
   * Detects the build framework by examining package.json dependencies and config files.
   */
  public detectFramework(
    extensionRoot: string,
    workspaceRoot: string
  ): DiscoveredProject["framework"] {
    const searchDirs = [extensionRoot, workspaceRoot];

    for (const dir of searchDirs) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const allDeps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
          };

          if (allDeps["wxt"]) return "wxt";
          if (allDeps["plasmo"] || Object.keys(allDeps).some((k) => k.startsWith("@plasmohq/"))) return "plasmo";
          if (allDeps["@crxjs/vite-plugin"]) return "crxjs";
          if (allDeps["vite"] || fs.existsSync(path.join(dir, "vite.config.ts")) || fs.existsSync(path.join(dir, "vite.config.js"))) return "vite";
          if (allDeps["webpack"] || fs.existsSync(path.join(dir, "webpack.config.js"))) return "webpack";
        } catch {
          // Ignore json parse error
        }
      }
    }

    return "plain";
  }
}
