# ExtensionFlow: Product Requirements Document

Version 0.1 draft | VS Code extension for Chrome extension development | Includes a technical review of the original architecture

## 1. Review of the current architecture

The architecture you pasted is a good skeleton: a VS Code extension for the UI, a framework-agnostic core, a change classifier, a reload planner and CDP for browser control. The split between UI and core logic is right and should be kept. However, several assumptions will break in practice. This PRD fixes them.

### 1.1 Findings that must change

| # | Issue in the original | Why it matters | Fix in this PRD |
| --- | --- | --- | --- |
| 1 | `--load-extension` is the main way to load the unpacked extension | Since Chrome 137, official Chrome branded builds no longer honor `--load-extension`. It still works in Chromium and Chrome for Testing. | Default to a managed Chrome for Testing (CfT) binary. Treat branded Chrome as an experimental path using remote-debugging-pipe plus CDP extension install (section 6.1). |
| 2 | Extension reload is left as an open question | This is the single feature that decides whether the product works. | A defined reload ladder with four mechanisms and a Phase 0 spike that must pass before any other work (sections 6.2 and 12). |
| 3 | Reload via CDP uninstall and reinstall is not discussed | Uninstalling wipes the extension's storage, so the developer loses state on every save. | Reinstall is the last resort, never the default. The default reload must preserve storage. |
| 4 | `vscode.workspace.createFileSystemWatcher` as the watcher | It honors `files.watcherExclude`, and it cannot reliably watch build output outside the workspace folder. Bundled projects often write to ignored `dist/` folders. | The core uses its own watcher (chokidar or Node fs.watch) with explicit ignore rules. The VS Code watcher is used only for config files. |
| 5 | Popup refresh is assumed to be easy | A real popup closes when it loses focus and cannot be kept open or driven reliably through CDP. | A Popup Preview tab: the popup HTML opened as a normal tab and refreshed. Limitations are documented (section 6.4). |
| 6 | Picking a free debugging port | Race conditions and conflicts. | Launch with port 0 and read the `DevToolsActivePort` file from the profile directory, or use the pipe transport. |
| 7 | A temporary profile on every run | Developers lose logins on test sites and extension storage on each start. | Persistent per-workspace profile by default, ephemeral as an option. |
| 8 | Reload success is assumed | Silent failure leaves the developer testing old code. | Every reload is verified (a new extension service-worker target must appear after the trigger) and the result is shown in VS Code. |
| 9 | Existing dev servers are ignored | WXT, Plasmo and CRXJS bring their own watching and reload. Two reloaders fighting each other causes loops. | Coexistence mode: ExtensionFlow can run in observe-only mode and never trigger reloads (section 6.5). |
| 10 | Remote and untrusted workspaces are not considered | In WSL, SSH or Dev Containers the VS Code extension runs on the remote machine, so Chrome would launch there, not on the developer's screen. Untrusted workspaces must not run build commands. | v0.1 supports local workspaces only, declares limited support for untrusted workspaces (no build execution), and the Doctor command explains the situation. |
| 11 | Some claims depend on current Chrome behavior | Chrome's extension and automation behavior changes between releases. | Every browser-dependent claim in this PRD is tied to a Phase 0 spike and re-tested against stable and CfT in CI. |

### 1.2 What stays as is

- TypeScript everywhere, Node child processes, Output channel, Problems panel, tree view and status bar.
- Plain-JavaScript MV3 projects supported first, bundler integrations later.
- Change classification instead of blind reload, with a conservative fallback that explains itself.
- The honest feasibility table: universal project detection is possible, universal HMR is not.

## 2. Product overview

### 2.1 Problem

Every change to a Chrome extension means: save, switch to chrome://extensions, click reload, switch to the target website, refresh it, open DevTools for the right context, and read errors in a different window. This takes several manual steps per edit, and mistakes (testing stale code) are common.

### 2.2 Vision

Save a file in VS Code and the right part of a real Chrome session updates, with errors reported inside VS Code. No manual visits to chrome://extensions.

### 2.3 Goals

1. One command starts a dedicated, isolated browser session with the developer's unpacked extension loaded.
2. Saving a file triggers the minimum correct update: refresh a page, reload the extension, reload the extension and refresh matching tabs, or rebuild first.
3. Build errors, manifest errors and runtime errors appear in VS Code.
4. Every failure is visible and recoverable. The tool never claims the extension is up to date unless it verified it.
5. It works with any valid MV3 project without requiring a framework.

### 2.4 Non-goals for v0.1

Firefox or Safari, Manifest V2, publishing to the Chrome Web Store, true HMR for content scripts, visual regression testing, AI error diagnosis, WSL, SSH and Dev Container workspaces, and replacing the developer's build tool.

### 2.5 Target users

- Primary: developers building MV3 extensions in VS Code, from plain JavaScript to TypeScript with esbuild, Vite or webpack.
- Secondary: teams who want a consistent, reproducible extension test browser.

### 2.6 Principles

1. Never touch the developer's normal Chrome profile.
2. Prefer supported, documented mechanisms over UI automation.
3. Be explicit: show what was done and why. Unknown means conservative, not silent.
4. Core logic has no VS Code dependency, so it is unit-testable.
5. Degrade gracefully: if a reload mechanism fails, fall back to the next one and tell the developer.

## 3. Supported environments

| Area | v0.1 support |
| --- | --- |
| Extension type | Manifest V3 unpacked extensions. MV2 is reported as unsupported with a clear message. |
| Browser | Chrome for Testing (managed, default), Chromium (user-provided path). Branded Chrome stable: experimental, enabled only if Phase 0 passes. |
| OS | Windows, macOS, Linux (local desktop sessions) |
| VS Code | Current stable and one previous minor version |
| Workspace | Local folders, trusted workspaces for build execution |
| Build tools | None (plain JS), any user-supplied build command, plus detection of Vite and webpack output |

## 4. User stories

1. As a developer I run one command and get a clean Chrome with my extension loaded, so I can test without setup.
2. As a developer I edit a content script, save, and see the target tab refreshed with the new code, so I never test stale code.
3. As a developer I edit popup CSS and only the popup preview refreshes, so my place in the test site is not lost.
4. As a developer my TypeScript build fails and I see the error in the Problems panel, and the last working extension keeps running.
5. As a developer I can see the extension's service-worker and content-script console errors without opening DevTools.
6. As a developer with a Vite or WXT project, ExtensionFlow does not fight my existing dev server.
7. As a developer when something is misconfigured, a Doctor command tells me exactly what is wrong.

## 5. Functional requirements

Priority: P0 = required for v0.1, P1 = v0.2, P2 = later.

### 5.1 Project detection and validation

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| FR-1 | Find manifest.json files in the workspace (ignoring node\_modules, .git) and let the user choose the extension root. | P0 | With 0 manifests: clear message and a Select Folder action. With several: Quick Pick. Choice is remembered per workspace. |
| FR-2 | Parse manifest as JSONC and validate against the Chrome manifest schema. | P0 | Syntax errors and unknown or invalid keys appear in the Problems panel with file and line. |
| FR-3 | Map declared resources: service worker, content scripts (js, css, matches), action popup, options page, side panel, new tab override, web accessible resources, icons, locales. | P0 | The tree view lists each component with its file path and whether the file exists. |
| FR-4 | Report missing referenced files and MV2 manifests. | P0 | Each missing file is a diagnostic. MV2 produces an unsupported error. |
| FR-5 | Detect a build setup: package.json scripts (build, dev, watch), vite.config, webpack.config, tsconfig. | P1 | Detected tool and suggested configuration shown in the setup prompt. |
| FR-6 | Detect extension framework dev servers (WXT, Plasmo, CRXJS) and offer observe-only mode. | P1 | Prompt on first start when detected. |

### 5.2 Browser session

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| FR-7 | Resolve a browser in this order: user setting, previously downloaded CfT, offer to download CfT (with consent and size shown), system Chromium, branded Chrome (experimental). | P0 | Start never fails silently. Missing browser gives a one-click download or path selection. |
| FR-8 | Launch the browser with a dedicated user-data directory, no first-run prompts, and the extension loaded. | P0 | Session starts in under 10 seconds on a warm machine (target). The normal Chrome profile is never used. |
| FR-9 | Connect over CDP using port 0 plus the DevToolsActivePort file, or the pipe transport. Bind to localhost only. | P0 | No port conflicts. No listener reachable from the network. |
| FR-10 | Load the ExtensionFlow Helper extension together with the user's extension (section 6.2). | P0 | Helper is never listed as part of the user's project and is hidden from the tree. |
| FR-11 | Profile modes: persistent per workspace (default, stored in VS Code global storage) and ephemeral. Command to clear the profile. | P0 | Logins and extension storage survive restarts in persistent mode. |
| FR-12 | Clean shutdown: close the browser, remove ephemeral profiles, kill the whole process tree (including on Windows), and detect orphan browsers from a previous crash. | P0 | After Stop or VS Code exit, no browser process from the session remains. |
| FR-13 | Handle the user closing the browser window manually. | P0 | Session state becomes Stopped and the status bar updates. A Restart action is offered. |
| FR-14 | Configurable start URL and a list of managed test URLs. | P1 | Test URLs reopen on each start. |

### 5.3 Watching and change classification

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| FR-15 | Watch the extension root (plain projects) or the build output directory (built projects) using the core watcher. | P0 | Changes outside the workspace folder are detected. node\_modules and .git are ignored by default. |
| FR-16 | Debounce 200 to 400 ms (configurable) and coalesce events. For build projects, wait for the build process to exit and the output to settle. | P0 | One save produces at most one reload. |
| FR-17 | Classify each changed file using the manifest map and the rules in section 6.3. | P0 | Unit-tested rule table with fixtures. |
| FR-18 | If a change arrives during a reload, queue exactly one follow-up action. The highest-impact action in the batch wins. | P0 | No overlapping reloads and no lost changes. |
| FR-19 | Unknown files use the conservative fallback (reload extension and refresh managed tabs) and state that this was a fallback. | P0 | Output channel line explains the rule used for every action. |
| FR-20 | Pause and resume watching. | P0 | While paused, changes are recorded and a Reload Now action is offered. |

### 5.4 Reload and refresh

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| FR-21 | Reload the extension through the reload ladder (section 6.2), preserving extension storage. | P0 | In the spike corpus, reload succeeds and chrome.storage data is intact. |
| FR-22 | After an extension reload that affects content scripts, refresh only managed tabs whose URL matches a content script's match patterns. | P0 | Tabs not matching are untouched. |
| FR-23 | Verify each reload: a new service-worker or extension target must appear after the trigger, and the extension must be enabled. | P0 | Failed verification shows an error with a Retry action and never shows a success state. |
| FR-24 | Popup Preview tab and Options tab: open on demand, refresh on change, reopen if closed. | P0 | Commands: Open Popup Preview, Open Options Page. |
| FR-25 | Reload action runs only after a successful build. If the build fails, the last working output keeps running. | P0 | Build failure leaves the browser untouched and shows errors. |
| FR-26 | Manual commands: Reload Extension, Reload Extension and Tabs, Refresh Page, Rebuild. | P0 | Each works while watching is paused. |
| FR-27 | Optional hot style updates for Vite or webpack dev servers that provide HMR, by yielding to their runtime. | P2 | Documented as dependent on the bundler. |

### 5.5 Build integration

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| FR-28 | Three build modes: none; run a command on change (serialized, stale builds cancelled); external watcher (ExtensionFlow runs or observes a long-running command and only watches the output). | P0 | Mode is selected in settings or the setup prompt. |
| FR-29 | Build commands run only in trusted workspaces and are shown to the user before the first run. | P0 | Untrusted workspace: build features disabled with an explanation. |
| FR-30 | Parse common error formats (tsc, esbuild, Vite, webpack) into Problems panel entries. Unparsed output still goes to the Output channel. | P1 | Click a problem to jump to file and line. |

### 5.6 Diagnostics

| ID | Requirement | Pri | Acceptance criteria |
| --- | --- | --- | --- |
| FR-31 | Capture console output, uncaught exceptions and log entries from the extension service worker and extension pages via CDP auto-attach. | P0 | Output channel ExtensionFlow: Browser shows source (worker, popup, options), level and message. |
| FR-32 | Capture content-script console output and errors from managed tabs by observing extension-origin execution contexts. | P1 | Messages are labeled with the tab URL. |
| FR-33 | Show runtime errors as Problems entries when the stack frame maps to a workspace file. | P1 | chrome-extension://ID/path maps to the workspace file, with line numbers. Source maps used where available. |
| FR-34 | Doctor command: checks browser, version, flags, helper load, CDP connection, reload mechanism, workspace trust and file watching. | P0 | Produces a pass or fail checklist with a fix hint for each failure. |
| FR-35 | Status bar: stopped, starting, running, reloading, error, with last reload result and time. | P0 | Click opens the ExtensionFlow view. |

## 6. Technical design

### 6.1 Browser strategy

1. Default: Chrome for Testing, downloaded on request into extension global storage (for example with the @puppeteer/browsers package), version pinned in settings. This keeps `--load-extension` working and gives every developer the same browser.
2. Chromium or branded Chrome at a user-supplied path. For branded Chrome the extension must be installed through the CDP route reported for Chrome 137 and later: launch with `--remote-debugging-pipe` and `--enable-unsafe-extension-debugging`, then install through the CDP Extensions domain. This is marked experimental until Phase 0 proves it on Windows, macOS and Linux.
3. A CDP client library (puppeteer-core is a candidate) can reduce effort, since recent versions support pipe transport and extension installation. Evaluate against raw CDP in Phase 0. The abstraction `BrowserDriver` hides the choice.
4. Always: dedicated user-data directory, `--no-first-run`, `--no-default-browser-check`, localhost only, never the default profile.

### 6.2 Reload ladder

The reload method is the highest-risk part of the product. The ladder is ordered so that the first method that works for the environment is used, and every method must keep extension storage intact except the last.

| Order | Method | How | Pros | Cons |
| --- | --- | --- | --- | --- |
| A (default) | Helper extension toggle | The ExtensionFlow Helper is a tiny MV3 extension with the management permission and a fixed ID (via the key field). Its control page stays open in a pinned tab. The engine calls CDP Runtime.evaluate on that page (with the user-gesture flag set if Chrome requires one) to disable then re-enable the target extension, which re-reads the unpacked files from disk. | No change to the developer's code. Storage preserved. Used by existing reloader tools. | Needs Phase 0 proof that a gesture is not blocking. Helper must be loaded in every session. |
| B | Injected dev client | ExtensionFlow builds a staging copy of the extension, wraps the service worker with a small dev client that listens for a reload message and calls chrome.runtime.reload(), and loads the staging copy. | Proven pattern in webpack and Vite reloaders. Storage preserved. | Modifies a copy, so paths, source maps and the extension ID must be handled. More complexity. Opt-in. |
| C | CDP reinstall | Uninstall and load unpacked again through the CDP Extensions domain (pipe mode only). | Works when helper methods are blocked. | Wipes the extension's storage. Warn before use. |
| D | Session restart | Stop and start the dedicated browser, keeping the profile. | Always works. | Slowest. Loses open tabs unless restored. |

Rules: try A, then B if enabled, then C with a warning, then D with a prompt. The method used is always shown in the Output channel. If a method fails twice in one session it is disabled for that session and the Doctor reports it.

Verification (all methods): record the trigger time, wait up to a timeout (default 5 s) for a new service-worker or extension target created after the trigger, and check that the extension is enabled. Only then report success.

### 6.3 Change classification rules

Rules are data (a table in code with unit-test fixtures), not scattered conditionals.

| Changed file | Action |
| --- | --- |
| manifest.json | Validate. If invalid, show errors and stop. Otherwise reload extension, and refresh managed tabs. |
| Service worker file, or any module it imports | Rebuild if needed, then reload extension. |
| Content script JS or CSS | Reload extension, then refresh managed tabs matching its patterns. |
| Popup HTML, CSS or JS | Refresh the Popup Preview tab. |
| Options, side panel or new tab page files | Refresh that page's open tab. |
| Offscreen document files | Reload extension. |
| \_locales, icons, declarativeNetRequest rule files, web accessible resources | Reload extension. |
| Shared module (bundled projects) | Use build output and manifest map, or the sourcemap, to find affected entries. If unknown, treat as unknown. |
| Source file in a built project | Run the build. Then classify the changed output files. |
| Unknown file | Reload extension and refresh managed tabs, and print that this was a fallback. |

Impact order when merging a batch: manifest and service worker, then content scripts, then pages, then no-op.

### 6.4 Popup and options handling

A real browser-action popup is transient and cannot be reliably kept open and driven. ExtensionFlow opens the popup HTML as a normal tab (Popup Preview). Known limitations to document: no popup sizing, the active tab seen by the page is the preview tab itself, and window lifecycle events differ. A setting lets developers choose which tab the popup preview treats as its target for chrome.tabs queries (v0.2).

### 6.5 Coexistence with framework dev servers

Modes: Managed (ExtensionFlow triggers reloads) and Observe-only (ExtensionFlow only loads the browser, shows diagnostics and the tree, and never triggers reloads). Observe-only is suggested when WXT, Plasmo, CRXJS or a vite-plugin-web-extension setup is detected. This prevents double reloads.

### 6.6 Watching

- Core watcher: chokidar or Node fs.watch with explicit ignore globs (node\_modules, .git, configured ignores).
- For build projects watch the output directory, and optionally the source directory to trigger builds.
- Handle atomic-save editors (rename on save), editor temp files, and symlinked folders.
- Settle logic: after a build process exits, wait for 300 ms of no output changes before classifying.

### 6.7 Diagnostics pipeline

- Use Target.setAutoAttach with flatten enabled so new targets (service worker, popup, options, tabs) are attached automatically.
- Enable Runtime, Log and Page domains per target. Route events into Output channel and Problems panel.
- MV3 service workers stop when idle. Treat worker target disappearance as normal, and re-attach when a new worker target appears. Do not report idle shutdown as an error.
- Map chrome-extension://ID/ paths to workspace files (or build output to sources via source maps in v0.2).
- Rate-limit repeated identical messages.

### 6.8 Process and component model

Packages (monorepo):

1. core: no VS Code imports. Contains ProjectDetector, ManifestService, ChangeClassifier, ReloadPlanner, ReloadExecutor, BuildRunner, BrowserDriver, SessionManager, DiagnosticsHub, and an event bus. Fully unit-testable.
2. vscode: commands, tree view, status bar, Output channel, DiagnosticCollection, settings, Doctor UI. Thin adapter over core.
3. helper-extension: the MV3 Helper with a fixed ID, loaded only in the dedicated browser.

The core runs in the extension host for v0.1. All interfaces are asynchronous and message-based so it can move to a child process later for crash isolation.

Session states: Idle, Starting, Running, Building, Reloading, Degraded, Error, Stopping. Transitions are logged. Every command is valid in a defined set of states.

### 6.9 Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| extensionflow.extensionRoot | auto | Folder containing manifest.json |
| extensionflow.browser.path | empty | Chromium or Chrome binary |
| extensionflow.browser.channel | cft-stable | Managed Chrome for Testing channel or version |
| extensionflow.browser.profileMode | persistent | persistent or ephemeral |
| extensionflow.startUrls | empty | Pages opened on start |
| extensionflow.mode | managed | managed or observe-only |
| extensionflow.build.mode | none | none, onChange, or externalWatcher |
| extensionflow.build.command | empty | Command for the build |
| extensionflow.build.outputDir | empty | Folder with the loadable extension |
| extensionflow.watch.debounceMs | 300 | Debounce window |
| extensionflow.watch.ignore | defaults | Extra ignore globs |
| extensionflow.reload.methods | A, D | Allowed reload ladder steps |
| extensionflow.reload.verifyTimeoutMs | 5000 | Verification wait |

### 6.10 Commands and UI

Commands: Start Session, Stop Session, Restart Session, Reload Extension, Reload Extension and Tabs, Rebuild, Pause or Resume Watching, Select Extension Root, Open Popup Preview, Open Options Page, Show Browser Logs, Clear Browser Profile, Run Doctor.

Activity Bar view: project and manifest summary, browser status, component tree (service worker, content scripts, popup, options), last action with the rule and method used, and recent errors.

## 7. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance (targets) | Page refresh after save within 1 second, extension reload plus verification within 3 seconds, session start within 10 seconds, on a typical developer machine. Idle CPU use near zero. |
| Reliability | No orphan browser processes after Stop, crash or VS Code exit. Reload reliability measured on the corpus (target 99 percent or higher). |
| Safety | No remote debugging listener beyond localhost. No use of the normal profile. No telemetry in v0.1 unless explicitly opt-in. |
| Security | Build commands only in trusted workspaces. The Helper extension is loaded only in the dedicated browser and never published to the Chrome Web Store. Debug endpoints are never logged with secrets. |
| Compatibility | Windows, macOS, Linux. Paths with spaces and non-ASCII characters. Long Windows paths. |
| Accessibility | All views keyboard accessible, no color-only status. |
| Observability | A verbose log level and an exportable diagnostics bundle (versions, settings, last 500 log lines). |

## 8. Phase 0: feasibility spikes (gate before building)

Nothing else starts until these pass. Each spike has a written result.

| Spike | Question | Pass criteria |
| --- | --- | --- |
| S1 | Can CfT load an unpacked extension with the Helper and the target together, with CDP connected via port 0 and DevToolsActivePort? | Both extensions present, CDP attached, on all 3 OSes |
| S2 | Does reload method A work (disable and enable through the Helper, via Runtime.evaluate)? Is a user gesture required, and does the gesture flag solve it? | New service-worker target appears, storage preserved, 20 consecutive reloads, no dialogs |
| S3 | Does a content script change appear after reload plus tab refresh, end to end? | Edit, save, see new behavior in under 3 seconds |
| S4 | Can branded Chrome stable install the extension through the pipe and CDP route? Does reload method C work? | Result documented per OS. If it fails, branded Chrome stays unsupported. |
| S5 | Does method B (staging copy with dev client) work with a module service worker and a classic one? | Reload works and extension ID stays stable |
| S6 | Does diagnostics capture work for service worker errors, including after idle shutdown? | Error shown in VS Code within 1 second, and re-attach after worker restart |
| S7 | Process cleanup on all OSes, including VS Code crash | No orphan processes in 50 start and stop cycles |

Go or no-go: if S1 to S3 pass, proceed with CfT only. If they do not pass, redesign around method B before continuing.

## 9. Milestones

| Milestone | Scope | Exit criteria |
| --- | --- | --- |
| M0 | Phase 0 spikes S1 to S7 | Written go or no-go |
| M1 | VS Code skeleton, settings, project detection, manifest validation, tree view, Doctor | Plain MV3 projects detected and validated |
| M2 | Browser session manager, CfT download, profile modes, cleanup | Start and stop 50 times without leaks |
| M3 | Watcher, classifier, planner, reload ladder A and D, verification, tab refresh, Popup Preview | Save to updated browser works on the corpus |
| M4 | Diagnostics (service worker and pages), build modes, Problems panel for builds | Errors visible in VS Code without DevTools |
| M5 | Cross-OS CI, docs, beta on the Marketplace | v0.1 beta published |
| v0.2 | Content script diagnostics, source maps, framework detection and observe-only mode, method B, build error parsers, branded Chrome if S4 passed |  |

## 10. Test plan

- Unit tests (Vitest): manifest parsing, resource mapping, classifier rule table, planner merge logic, debounce and queue behavior, settle logic, path mapping.
- Integration tests: launch a real CfT with fixture extensions and drive the full loop through the core (no VS Code UI). Playwright or Puppeteer can assist assertions.
- VS Code tests: @vscode/test-electron for commands, status bar and diagnostics.
- Corpus of at least 10 extensions: plain JS, TypeScript with esbuild, Vite with React, webpack, WXT, Plasmo, CRXJS, a content-script-heavy extension, a side-panel extension, an extension with offscreen documents.
- CI matrix: Windows, macOS, Linux against CfT stable and a pinned older version. A scheduled job also runs against the latest Chrome stable to catch behavior changes early.
- Failure injection: kill the browser mid-reload, break the manifest, fail the build, rename files during a save, close the browser manually.

## 11. Success metrics

- Time from save to updated behavior: median under 3 seconds (reload) and under 1 second (page refresh).
- Reload success rate on the corpus: 99 percent or higher.
- Zero orphan browser processes in the cleanup test.
- New user to first successful live reload in under 5 minutes (usability test with 5 developers).
- Beta feedback: fewer than 3 distinct crash reports per 100 installs in the first month.

## 12. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Chrome changes extension loading or management behavior again | High | High | Pin CfT, run scheduled CI against stable, keep BrowserDriver abstraction and reload ladder |
| Reload method A blocked by gesture or policy | Medium | High | Spike S2, fallback to B then D |
| Branded Chrome path never becomes reliable | Medium | Medium | Ship CfT-first. Branded Chrome is optional. |
| Reloader fights framework dev servers | Medium | Medium | Observe-only mode and detection |
| Windows process cleanup failures | Medium | Medium | Process tree kill, pid file, startup orphan sweep |
| Large CfT download deters users | Medium | Low | Explicit consent, progress, reuse across workspaces |
| Stale-code confusion after silent failure | Medium | High | Mandatory verification and visible result in status bar |
| Remote workspaces confuse users | Medium | Low | Doctor message and docs. Remote support is a future feature. |

## 13. Open questions

1. Should ExtensionFlow own the build process, or only observe a watcher the developer already runs? (Default proposed: support both, document the external watcher as recommended.)
2. Should the Helper control page be a pinned tab or an offscreen document? Decide in S2.
3. Is a persistent profile acceptable by default for teams that want clean reproducibility? Proposed: persistent by default, with a one-click Clear Profile.
4. Which framework (WXT, Plasmo, CRXJS) should be the first coexistence target? Decide from corpus results.
5. Marketplace name and publisher identity for the Helper and the VS Code extension.

## 14. Recommended next step

Run M0 as a one-week spike on one machine first (S1, S2, S3), using a 30-line content-script fixture. If a save in VS Code refreshes the matching tab with the new content script, with no visit to chrome://extensions, the rest of the product is conventional engineering.
