import fs from "node:fs";
import path from "node:path";
import {
  parseTree,
  findNodeAtLocation,
  type ParseError,
  printParseErrorCode,
  type Node as JsonNode,
} from "jsonc-parser";
import type {
  ManifestValidationResult,
  ManifestDiagnostic,
  ExtensionComponent,
  ComponentType,
} from "./types.js";

export class ManifestService {
  /**
   * Reads, parses, and validates a manifest.json file, resolving all declared resources.
   */
  public parseAndValidate(manifestPath: string): ManifestValidationResult {
    const extensionRoot = path.dirname(path.resolve(manifestPath));
    const diagnostics: ManifestDiagnostic[] = [];
    const components: ExtensionComponent[] = [];

    if (!fs.existsSync(manifestPath)) {
      return {
        valid: false,
        name: "Unknown",
        version: "0.0.0",
        components: [],
        diagnostics: [
          {
            line: 1,
            column: 1,
            offset: 0,
            length: 0,
            message: `Manifest file not found at: ${manifestPath}`,
            severity: "error",
            code: "MANIFEST_NOT_FOUND",
            file: manifestPath,
          },
        ],
        manifestPath,
        extensionRoot,
      };
    }

    const content = fs.readFileSync(manifestPath, "utf-8");
    const parseErrors: ParseError[] = [];
    const rootNode = parseTree(content, parseErrors);

    if (parseErrors.length > 0) {
      for (const err of parseErrors) {
        const { line, column } = this.getLineAndColumn(content, err.offset);
        diagnostics.push({
          line,
          column,
          offset: err.offset,
          length: err.length,
          message: `JSON syntax error: ${printParseErrorCode(err.error)}`,
          severity: "error",
          code: "SYNTAX_ERROR",
          file: manifestPath,
        });
      }
      return {
        valid: false,
        name: "Unknown",
        version: "0.0.0",
        components: [],
        diagnostics,
        manifestPath,
        extensionRoot,
      };
    }

    let raw: Record<string, any> = {};
    try {
      raw = JSON.parse(content);
    } catch {
      // In case of any fallback JSON issue
      return {
        valid: false,
        name: "Unknown",
        version: "0.0.0",
        components: [],
        diagnostics,
        manifestPath,
        extensionRoot,
      };
    }

    // 1. Validate manifest_version
    const manifestVersion = raw.manifest_version;
    const mvNode = rootNode ? findNodeAtLocation(rootNode, ["manifest_version"]) : undefined;
    if (manifestVersion === 2) {
      diagnostics.push(
        this.createDiagnostic(
          content,
          mvNode,
          "Manifest V2 is not supported in ExtensionFlow v0.1. Please migrate to Manifest V3.",
          "error",
          "MV2_UNSUPPORTED",
          manifestPath
        )
      );
    } else if (manifestVersion !== 3) {
      diagnostics.push(
        this.createDiagnostic(
          content,
          mvNode,
          `Unsupported or missing manifest_version: expected 3, found ${manifestVersion}`,
          "error",
          "INVALID_MANIFEST_VERSION",
          manifestPath
        )
      );
    }

    // 2. Validate required metadata
    const name = raw.name || "Unnamed Extension";
    const version = raw.version || "0.0.1";

    if (!raw.name) {
      diagnostics.push(
        this.createDiagnostic(content, rootNode, "Missing required manifest field: 'name'", "error", "MISSING_NAME", manifestPath)
      );
    }
    if (!raw.version) {
      diagnostics.push(
        this.createDiagnostic(content, rootNode, "Missing required manifest field: 'version'", "error", "MISSING_VERSION", manifestPath)
      );
    }

    // 3. Map Background Service Worker
    if (raw.background?.service_worker) {
      const swRelPath = raw.background.service_worker;
      const swAbsPath = path.resolve(extensionRoot, swRelPath);
      const exists = fs.existsSync(swAbsPath);

      components.push({
        id: `sw:${swRelPath}`,
        type: "service_worker",
        name: "Background Service Worker",
        relativePath: swRelPath,
        absolutePath: swAbsPath,
        exists,
      });

      if (!exists) {
        const swNode = rootNode ? findNodeAtLocation(rootNode, ["background", "service_worker"]) : undefined;
        diagnostics.push(
          this.createDiagnostic(content, swNode, `Declared service worker file not found: '${swRelPath}'`, "error", "FILE_NOT_FOUND", manifestPath)
        );
      }
    }

    // 4. Map Content Scripts
    if (Array.isArray(raw.content_scripts)) {
      raw.content_scripts.forEach((cs: any, index: number) => {
        const matches: string[] = cs.matches || [];
        const extraFiles: ExtensionComponent["extraFiles"] = [];
        let primaryRelPath = "";
        let primaryAbsPath = "";
        let primaryExists = false;

        const jsFiles: string[] = cs.js || [];
        const cssFiles: string[] = cs.css || [];

        jsFiles.forEach((file, fileIdx) => {
          const abs = path.resolve(extensionRoot, file);
          const exists = fs.existsSync(abs);
          extraFiles.push({ relativePath: file, absolutePath: abs, exists, kind: "js" });
          if (!primaryRelPath) {
            primaryRelPath = file;
            primaryAbsPath = abs;
            primaryExists = exists;
          }
          if (!exists) {
            const node = rootNode ? findNodeAtLocation(rootNode, ["content_scripts", index, "js", fileIdx]) : undefined;
            diagnostics.push(
              this.createDiagnostic(content, node, `Content script JS file not found: '${file}'`, "error", "FILE_NOT_FOUND", manifestPath)
            );
          }
        });

        cssFiles.forEach((file, fileIdx) => {
          const abs = path.resolve(extensionRoot, file);
          const exists = fs.existsSync(abs);
          extraFiles.push({ relativePath: file, absolutePath: abs, exists, kind: "css" });
          if (!primaryRelPath) {
            primaryRelPath = file;
            primaryAbsPath = abs;
            primaryExists = exists;
          }
          if (!exists) {
            const node = rootNode ? findNodeAtLocation(rootNode, ["content_scripts", index, "css", fileIdx]) : undefined;
            diagnostics.push(
              this.createDiagnostic(content, node, `Content script CSS file not found: '${file}'`, "error", "FILE_NOT_FOUND", manifestPath)
            );
          }
        });

        components.push({
          id: `cs:${index}:${primaryRelPath}`,
          type: "content_script",
          name: `Content Script [${matches.join(", ")}]`,
          relativePath: primaryRelPath,
          absolutePath: primaryAbsPath,
          exists: primaryExists,
          matches,
          extraFiles,
        });
      });
    }

    // 5. Map Action Popup
    const popupRel = raw.action?.default_popup;
    if (popupRel) {
      const popupAbs = path.resolve(extensionRoot, popupRel);
      const exists = fs.existsSync(popupAbs);
      components.push({
        id: `popup:${popupRel}`,
        type: "popup",
        name: "Action Popup",
        relativePath: popupRel,
        absolutePath: popupAbs,
        exists,
      });

      if (!exists) {
        const node = rootNode ? findNodeAtLocation(rootNode, ["action", "default_popup"]) : undefined;
        diagnostics.push(
          this.createDiagnostic(content, node, `Action popup file not found: '${popupRel}'`, "error", "FILE_NOT_FOUND", manifestPath)
        );
      }
    }

    // 6. Map Options Page
    const optionsRel = raw.options_ui?.page || raw.options_page;
    if (optionsRel) {
      const optionsAbs = path.resolve(extensionRoot, optionsRel);
      const exists = fs.existsSync(optionsAbs);
      components.push({
        id: `options:${optionsRel}`,
        type: "options",
        name: "Options Page",
        relativePath: optionsRel,
        absolutePath: optionsAbs,
        exists,
      });

      if (!exists) {
        const node = rootNode
          ? findNodeAtLocation(rootNode, raw.options_ui?.page ? ["options_ui", "page"] : ["options_page"])
          : undefined;
        diagnostics.push(
          this.createDiagnostic(content, node, `Options page file not found: '${optionsRel}'`, "error", "FILE_NOT_FOUND", manifestPath)
        );
      }
    }

    // 7. Map Side Panel
    const sidePanelRel = raw.side_panel?.default_path;
    if (sidePanelRel) {
      const sidePanelAbs = path.resolve(extensionRoot, sidePanelRel);
      const exists = fs.existsSync(sidePanelAbs);
      components.push({
        id: `side_panel:${sidePanelRel}`,
        type: "side_panel",
        name: "Side Panel",
        relativePath: sidePanelRel,
        absolutePath: sidePanelAbs,
        exists,
      });

      if (!exists) {
        const node = rootNode ? findNodeAtLocation(rootNode, ["side_panel", "default_path"]) : undefined;
        diagnostics.push(
          this.createDiagnostic(content, node, `Side panel file not found: '${sidePanelRel}'`, "error", "FILE_NOT_FOUND", manifestPath)
        );
      }
    }

    // 8. Map New Tab Override
    const newTabRel = raw.chrome_url_overrides?.newtab;
    if (newTabRel) {
      const newTabAbs = path.resolve(extensionRoot, newTabRel);
      const exists = fs.existsSync(newTabAbs);
      components.push({
        id: `new_tab:${newTabRel}`,
        type: "new_tab",
        name: "New Tab Page",
        relativePath: newTabRel,
        absolutePath: newTabAbs,
        exists,
      });

      if (!exists) {
        const node = rootNode ? findNodeAtLocation(rootNode, ["chrome_url_overrides", "newtab"]) : undefined;
        diagnostics.push(
          this.createDiagnostic(content, node, `New tab override page not found: '${newTabRel}'`, "error", "FILE_NOT_FOUND", manifestPath)
        );
      }
    }

    // 9. Map Icons
    if (raw.icons && typeof raw.icons === "object") {
      for (const [size, iconRel] of Object.entries<string>(raw.icons)) {
        const iconAbs = path.resolve(extensionRoot, iconRel);
        const exists = fs.existsSync(iconAbs);
        components.push({
          id: `icon:${size}:${iconRel}`,
          type: "icon",
          name: `Icon (${size}x${size})`,
          relativePath: iconRel,
          absolutePath: iconAbs,
          exists,
        });

        if (!exists) {
          const node = rootNode ? findNodeAtLocation(rootNode, ["icons", size]) : undefined;
          diagnostics.push(
            this.createDiagnostic(content, node, `Declared icon file not found: '${iconRel}'`, "warning", "ICON_NOT_FOUND", manifestPath)
          );
        }
      }
    }

    const hasErrors = diagnostics.some((d) => d.severity === "error");

    return {
      valid: !hasErrors,
      manifestVersion: typeof manifestVersion === "number" ? manifestVersion : undefined,
      name,
      version,
      components,
      diagnostics,
      manifestPath,
      extensionRoot,
      rawJson: raw,
    };
  }

  private createDiagnostic(
    content: string,
    node: JsonNode | undefined,
    message: string,
    severity: "error" | "warning" | "info",
    code: string,
    file: string
  ): ManifestDiagnostic {
    const offset = node ? node.offset : 0;
    const length = node ? node.length : 0;
    const { line, column } = this.getLineAndColumn(content, offset);

    return {
      line,
      column,
      offset,
      length,
      message,
      severity,
      code,
      file,
    };
  }

  private getLineAndColumn(content: string, offset: number): { line: number; column: number } {
    const safeOffset = Math.max(0, Math.min(offset, content.length));
    const lines = content.slice(0, safeOffset).split(/\r?\n/);
    const line = lines.length;
    const column = (lines[lines.length - 1]?.length || 0) + 1;
    return { line, column };
  }
}
