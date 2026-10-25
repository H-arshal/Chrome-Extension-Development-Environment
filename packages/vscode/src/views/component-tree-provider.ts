import * as vscode from "vscode";
import type { ExtensionComponent, ManifestValidationResult } from "@extensionflow/core";

export class ComponentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly component?: ExtensionComponent,
    public readonly subFile?: { relativePath: string; absolutePath: string; exists: boolean; kind: "js" | "css" }
  ) {
    super(label, collapsibleState);

    if (subFile) {
      this.resourceUri = vscode.Uri.file(subFile.absolutePath);
      this.description = subFile.kind.toUpperCase();
      this.tooltip = subFile.absolutePath;
      this.iconPath = subFile.exists
        ? new vscode.ThemeIcon(subFile.kind === "js" ? "symbol-method" : "symbol-color")
        : new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
      if (subFile.exists) {
        this.command = {
          command: "vscode.open",
          title: "Open File",
          arguments: [this.resourceUri],
        };
      }
      return;
    }

    if (component) {
      this.resourceUri = vscode.Uri.file(component.absolutePath);
      this.description = component.relativePath;
      this.tooltip = `${component.name}: ${component.absolutePath}`;

      if (!component.exists) {
        this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
        this.description = `${component.relativePath} (Missing File!)`;
      } else {
        switch (component.type) {
          case "service_worker":
            this.iconPath = new vscode.ThemeIcon("gear");
            break;
          case "content_script":
            this.iconPath = new vscode.ThemeIcon("file-code");
            break;
          case "popup":
            this.iconPath = new vscode.ThemeIcon("browser");
            break;
          case "options":
            this.iconPath = new vscode.ThemeIcon("settings");
            break;
          case "side_panel":
            this.iconPath = new vscode.ThemeIcon("layout-sidebar-right");
            break;
          case "icon":
            this.iconPath = new vscode.ThemeIcon("file-media");
            break;
          default:
            this.iconPath = new vscode.ThemeIcon("file");
            break;
        }

        this.command = {
          command: "vscode.open",
          title: "Open File",
          arguments: [this.resourceUri],
        };
      }
    }
  }
}

export class ComponentTreeProvider
  implements vscode.TreeDataProvider<ComponentTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ComponentTreeItem | undefined | null | void
  > = new vscode.EventEmitter<ComponentTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ComponentTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private currentResult: ManifestValidationResult | null = null;

  public update(result: ManifestValidationResult | null) {
    this.currentResult = result;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ComponentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ComponentTreeItem): Thenable<ComponentTreeItem[]> {
    if (!this.currentResult) {
      return Promise.resolve([
        new ComponentTreeItem("No Extension Selected", vscode.TreeItemCollapsibleState.None),
      ]);
    }

    if (!element) {
      // Root level: return all components
      const items = this.currentResult.components.map((comp) => {
        const hasChildren = (comp.extraFiles && comp.extraFiles.length > 1) || (comp.matches && comp.matches.length > 0);
        return new ComponentTreeItem(
          comp.name,
          hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          comp
        );
      });
      return Promise.resolve(items);
    }

    // Children for content scripts: list match patterns & all injected files
    if (element.component?.type === "content_script") {
      const children: ComponentTreeItem[] = [];

      // Add match pattern badges
      if (element.component.matches) {
        for (const match of element.component.matches) {
          const item = new ComponentTreeItem(`Match: ${match}`, vscode.TreeItemCollapsibleState.None);
          item.iconPath = new vscode.ThemeIcon("link");
          children.push(item);
        }
      }

      // Add files
      if (element.component.extraFiles) {
        for (const file of element.component.extraFiles) {
          children.push(
            new ComponentTreeItem(
              file.relativePath,
              vscode.TreeItemCollapsibleState.None,
              undefined,
              file
            )
          );
        }
      }

      return Promise.resolve(children);
    }

    return Promise.resolve([]);
  }
}
