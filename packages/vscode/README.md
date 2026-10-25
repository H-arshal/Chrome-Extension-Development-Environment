<div align="center">

# ⚡ ExtensionFlow

**The zero-config, state-preserving developer environment for Chrome Extensions (Manifest V3).**

[![Build & Test](https://img.shields.io/badge/tests-16%20passed-success.svg?style=flat-square&logo=vitest)](https://vitest.dev)
[![Manifest V3 Ready](https://img.shields.io/badge/Manifest%20V3-100%25%20Compatible-blue.svg?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC.svg?style=flat-square&logo=visualstudiocode)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

*Stop switching to `chrome://extensions`, clicking refresh, and losing your state. Save in VS Code — test instantly in Chrome.*

---

</div>

## 📌 The Problem vs. The Solution

Developing Chrome Extensions in Manifest V3 often feels like fighting your tools.

| The Old Manual Cycle 😫 | With ExtensionFlow ⚡ |
| :--- | :--- |
| Switch windows to `chrome://extensions` and click 🔄 Reload | **Zero clicks**: Watches your files and triggers atomic reloads on save |
| Extension storage (`chrome.storage.local`) resets on full restarts | **State preserved**: Surgical reload retains authentication, tokens & test data |
| Manually find and refresh every web page testing your content script | **Smart tab matching**: Automatically refreshes only tabs matching your URL patterns |
| Action popups close the second you switch to VS Code to edit code | **Persistent Popup Preview**: Auto-refreshing dedicated preview tab stays open |
| Hunt across 3 separate DevTools windows to find background & content errors | **Unified Diagnostics**: Background, popup & content script logs stream into VS Code |
| Risk polluting or crashing your personal daily-driver browser profile | **Isolated Chrome for Testing (CfT)**: Dedicated, sandboxed runtime |

---

## ✨ Core Capabilities

### ⚡ State-Preserving Reload Ladder
ExtensionFlow implements a deterministic **Reload Ladder**:
- **Method A (State-Preserving Toggle)**: Communicates with an internal helper extension via Chrome DevTools Protocol (CDP) to disable and re-enable your extension. Chrome instantly updates the unpacked bundle from disk while preserving `chrome.storage.local`, `chrome.storage.sync`, and user session state in under 70ms.
- **Method D (Session Recovery)**: If Chrome locks an extension binary, ExtensionFlow automatically falls back to an atomic browser restart without user intervention.

### 🧠 Intelligent Change Classification
Not all changes require a full extension restart. ExtensionFlow analyzes your `manifest.json` dependency graph:
- **`content_scripts` (JS/CSS)** $\rightarrow$ Surgical reload + automatic refresh of all matching open browser tabs.
- **`background.service_worker`** $\rightarrow$ Surgical reload and immediate worker re-attachment.
- **`action.default_popup` (HTML/CSS/JS)** $\rightarrow$ Instant reload & live refresh of the dedicated Popup Preview tab.
- **`manifest.json`** $\rightarrow$ Re-parses permissions, validates MV3 schemas, and updates matching patterns.

### 🎯 Real-Time Popup Preview
In Chrome, extension popups close as soon as focus leaves the browser window. ExtensionFlow solves this with the **Popup Preview Tab** (`ExtensionFlow: Open Popup Preview Tab`):
- Mounts `chrome-extension://<id>/popup.html` as a persistent browser tab.
- Keeps your popup rendered side-by-side with VS Code.
- Automatically refreshes the DOM on every save without clicking the extension icon.

### 🔍 Unified Diagnostics & Problems Hub
- **Console Aggregator**: Live `console.log`, `info`, `warn`, and `error` outputs from Service Workers, Content Scripts, and Popups stream directly into the `ExtensionFlow: Browser` output channel in VS Code.
- **Native Problems Panel**: Uncaught runtime errors and compile-time issues (from TypeScript, esbuild, Vite, or Webpack) appear directly in VS Code's Problems panel with clickable source locations.

### 🛠️ Environment Doctor
Run `ExtensionFlow: Run Doctor` anytime to verify:
- Manifest V3 schema validity and missing referenced assets.
- Chrome for Testing binary availability and port binding.
- CDP connectivity and Helper Extension communication integrity.

---

## 🚀 Quick Start

### 1. Installation
Install **ExtensionFlow** from the VS Code Marketplace or load the packaged `.vsix` file.

### 2. Launching Your Session
1. Open your Chrome extension workspace in VS Code.
2. ExtensionFlow automatically detects `manifest.json` and populates the **ExtensionFlow Activity Bar** view.
3. Click **$(zap) ExtensionFlow: Ready** in the status bar (or run `ExtensionFlow: Start Browser Session`).
4. A dedicated Chrome for Testing window launches with your unpacked extension pre-loaded.

### 3. Edit & See Changes
- **Edit Content Scripts**: Edit `content.js` and save. Any open tab matching your content script URLs reloads instantly.
- **Edit Popups**: Run `ExtensionFlow: Open Popup Preview Tab` to keep your popup open in a tab, then edit `popup.html` or styles to see live updates.
- **Inspect Logs**: Open the `ExtensionFlow: Browser` output channel to view aggregated extension logs.

---

## ⚙️ Configuration Reference

Customize ExtensionFlow in your VS Code settings (`settings.json`):

```jsonc
{
  // Path to extension folder containing manifest.json ("auto" auto-discovers)
  "extensionflow.extensionRoot": "auto",

  // Browser channel for Chrome for Testing ("stable", "beta", "dev", "canary")
  "extensionflow.browser.channel": "stable",

  // Custom executable path (leave empty to use managed Chrome for Testing)
  "extensionflow.browser.path": "",

  // "persistent" (preserves profile between runs) or "ephemeral" (fresh temp profile)
  "extensionflow.browser.profileMode": "persistent",

  // "managed" (triggers reloads) or "observe-only" (for WXT/Plasmo dev servers)
  "extensionflow.mode": "managed",

  // Settle debounce delay in milliseconds before triggering reloads
  "extensionflow.watch.debounceMs": 300,

  // Build integration: "none", "onChange", or "externalWatcher"
  "extensionflow.build.mode": "none",

  // Build command executed on file save when build.mode is "onChange"
  "extensionflow.build.command": "npm run build"
}
```

---

## ⌨️ Command Palette

Access these commands anytime via `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`):

| Command | Identifier | Description |
| :--- | :--- | :--- |
| **Start Browser Session** | `extensionflow.start` | Launches Chrome for Testing with active extension |
| **Stop Browser Session** | `extensionflow.stop` | Closes browser session and terminates process tree |
| **Restart Browser Session** | `extensionflow.restart` | Performs clean browser restart preserving profile |
| **Reload Extension** | `extensionflow.reload` | Triggers immediate state-preserving extension reload |
| **Reload & Refresh Tabs** | `extensionflow.reloadWithTabs` | Reloads extension and refreshes all matching pages |
| **Open Popup Preview Tab** | `extensionflow.openPopupPreview`| Opens persistent tab for live popup development |
| **Clear Browser Profile** | `extensionflow.clearProfile` | Resets cached browser cookies, storage, and logins |
| **Run Doctor** | `extensionflow.runDoctor` | Runs comprehensive environment and health checks |
| **Select Extension Root** | `extensionflow.selectRoot` | Manually select the active extension folder |

---

## 🏗️ Architecture

ExtensionFlow is structured as a modular TypeScript monorepo:

```
ExtensionFlow/
├── packages/core/              # Pure Node.js engine (Zero VS Code API dependencies)
│   ├── browser/                # Chrome for Testing lifecycle & dynamic port management
│   ├── project/                # ManifestService (JSONC parser, diagnostics & schema validation)
│   ├── watcher/                # FileWatcher (Chokidar debounce & ChangeClassifier matrix)
│   ├── reload/                 # Reload Ladder (Methods A & D) & TabMatcher
│   ├── diagnostics/            # CDP console stream & SourceMapper
│   └── build/                  # BuildRunner & parsers (tsc, esbuild, vite, webpack)
│
├── packages/vscode/            # VS Code Extension Host adapter
│   ├── views/                  # Activity Bar Tree Providers (Project Overview & Components)
│   ├── diagnostics/            # Native Problems Panel DiagnosticsManager
│   └── doctor/                 # Health check runner & verification suite
│
└── packages/helper-extension/  # Internal MV3 Controller Extension (Deterministic Key)
```

---

## 🤝 Framework Compatibility

ExtensionFlow works seamlessly with both vanilla Chrome extensions and modern toolchains:

- **Vanilla MV3**: Native out-of-the-box hot reload.
- **Vite / esbuild / Webpack**: Configure `"extensionflow.build.mode": "onChange"` and `"extensionflow.build.command": "npm run build"`.
- **WXT / Plasmo / CRXJS**: Set `"extensionflow.mode": "observe-only"` to leverage ExtensionFlow's isolated Chrome for Testing runtime and diagnostics hub while delegating reloads to your framework dev server.

---

## 🛠️ Local Development & Contributing

Contributions are welcome! To build and test ExtensionFlow locally:

```bash
# Clone the repository
git clone https://github.com/your-username/extensionflow.git
cd extensionflow

# Install dependencies across all monorepo packages
npm install

# Run the complete test suite (Vitest)
npm test

# Build all packages
npm run build

# Package extension into a VSIX
npm run package
```

To debug the extension in VS Code:
1. Open this repository in VS Code.
2. Press `F5` to open an **Extension Development Host** window.
3. Open any Chrome extension folder in the host window and test!

---

## 📄 License

ExtensionFlow is licensed under the [MIT License](LICENSE).
