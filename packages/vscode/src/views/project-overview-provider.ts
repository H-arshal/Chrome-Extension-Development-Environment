import * as vscode from "vscode";
import type { ManifestValidationResult, DiscoveredProject } from "@extensionflow/core";

export class ProjectOverviewItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly value: string,
    public readonly iconName: string,
    public readonly customColor?: vscode.ThemeColor
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.tooltip = `${label}: ${value}`;
    this.iconPath = customColor
      ? new vscode.ThemeIcon(iconName, customColor)
      : new vscode.ThemeIcon(iconName);
  }
}

export class ProjectOverviewProvider
  implements vscode.TreeDataProvider<ProjectOverviewItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ProjectOverviewItem | undefined | null | void
  > = new vscode.EventEmitter<ProjectOverviewItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ProjectOverviewItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private currentProject: DiscoveredProject | null = null;
  private currentValidation: ManifestValidationResult | null = null;
  private browserStatus: "Stopped" | "Starting" | "Running" = "Stopped";

  public update(
    project: DiscoveredProject | null,
    validation: ManifestValidationResult | null,
    browserStatus: "Stopped" | "Starting" | "Running" = "Stopped"
  ) {
    this.currentProject = project;
    this.currentValidation = validation;
    this.browserStatus = browserStatus;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProjectOverviewItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<ProjectOverviewItem[]> {
    if (!this.currentProject && !this.currentValidation) {
      return Promise.resolve([
        new ProjectOverviewItem(
          "No Extension Found",
          "Click Select Extension Root",
          "info"
        ),
      ]);
    }

    const items: ProjectOverviewItem[] = [];

    // Project Name & Version
    items.push(
      new ProjectOverviewItem(
        "Extension",
        `${this.currentValidation?.name || this.currentProject?.name} (v${
          this.currentValidation?.version || this.currentProject?.version
        })`,
        "package"
      )
    );

    // Manifest Version
    const mv = this.currentValidation?.manifestVersion || this.currentProject?.manifestVersion;
    items.push(
      new ProjectOverviewItem(
        "Manifest",
        `MV${mv || 3} ${mv === 3 ? "✓" : "✗"}`,
        mv === 3 ? "pass" : "error",
        mv === 3
          ? new vscode.ThemeColor("testing.iconPassed")
          : new vscode.ThemeColor("errorForeground")
      )
    );

    // Framework
    items.push(
      new ProjectOverviewItem(
        "Framework",
        (this.currentProject?.framework || "plain").toUpperCase(),
        "tools"
      )
    );

    // Status
    const statusColor =
      this.browserStatus === "Running"
        ? new vscode.ThemeColor("testing.iconPassed")
        : this.browserStatus === "Starting"
        ? new vscode.ThemeColor("testing.iconQueued")
        : undefined;

    items.push(
      new ProjectOverviewItem(
        "Browser Session",
        this.browserStatus,
        this.browserStatus === "Running"
          ? "debug-start"
          : this.browserStatus === "Starting"
          ? "sync~spin"
          : "debug-stop",
        statusColor
      )
    );

    // Validation Status
    if (this.currentValidation) {
      const errCount = this.currentValidation.diagnostics.filter(
        (d) => d.severity === "error"
      ).length;
      const warnCount = this.currentValidation.diagnostics.filter(
        (d) => d.severity === "warning"
      ).length;

      if (errCount > 0) {
        items.push(
          new ProjectOverviewItem(
            "Validation",
            `${errCount} Error(s)`,
            "error",
            new vscode.ThemeColor("errorForeground")
          )
        );
      } else if (warnCount > 0) {
        items.push(
          new ProjectOverviewItem(
            "Validation",
            `${warnCount} Warning(s)`,
            "warning",
            new vscode.ThemeColor("warningForeground")
          )
        );
      } else {
        items.push(
          new ProjectOverviewItem(
            "Validation",
            "Valid MV3 Manifest ✓",
            "pass",
            new vscode.ThemeColor("testing.iconPassed")
          )
        );
      }
    }

    return Promise.resolve(items);
  }
}
