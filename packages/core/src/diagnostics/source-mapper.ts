import path from "node:path";
import fs from "node:fs";

export class SourceMapper {
  constructor(
    private extensionRoot: string,
    private targetExtensionId: string
  ) {}

  /**
   * Translates a runtime URL (e.g. chrome-extension://<id>/src/content.js) into a local workspace file path.
   */
  public mapUrlToWorkspace(url: string): { workspacePath?: string; relativePath?: string } {
    if (!url) return {};

    const prefix = `chrome-extension://${this.targetExtensionId}/`;
    if (url.startsWith(prefix)) {
      const rel = url.slice(prefix.length).split("?")[0].split("#")[0];
      const abs = path.resolve(this.extensionRoot, rel);
      if (fs.existsSync(abs)) {
        return { workspacePath: abs, relativePath: rel };
      }
      return { workspacePath: abs, relativePath: rel };
    }

    return {};
  }
}
