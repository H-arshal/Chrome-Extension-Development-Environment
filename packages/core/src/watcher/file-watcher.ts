import EventEmitter from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";

export interface FileWatcherOptions {
  watchPath: string;
  debounceMs?: number;
  extraIgnores?: string[];
}

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private isPaused = false;
  private pendingChanges = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;
  private watchPath: string;
  private extraIgnores: string[];

  constructor(options: FileWatcherOptions) {
    super();
    this.watchPath = path.resolve(options.watchPath);
    this.debounceMs = options.debounceMs || 300;
    this.extraIgnores = options.extraIgnores || [];
  }

  public start(): void {
    if (this.watcher) return;

    const ignored = [
      /(^|[/\\])\../, // dotfiles
      "**/node_modules/**",
      "**/.git/**",
      "**/.cache/**",
      "**/*.tmp",
      "**/*~",
      ...this.extraIgnores,
    ];

    this.watcher = chokidar.watch(this.watchPath, {
      ignored,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    const handleFileEvent = (filePath: string) => {
      if (this.isPaused) return;

      this.pendingChanges.add(filePath);
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        const batch = Array.from(this.pendingChanges);
        this.pendingChanges.clear();
        this.debounceTimer = null;
        if (batch.length > 0) {
          this.emit("change", batch);
        }
      }, this.debounceMs);
    };

    this.watcher.on("add", handleFileEvent);
    this.watcher.on("change", handleFileEvent);
    this.watcher.on("unlink", handleFileEvent);
  }

  public pause(): void {
    this.isPaused = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  public resume(): void {
    this.isPaused = false;
    if (this.pendingChanges.size > 0) {
      const batch = Array.from(this.pendingChanges);
      this.pendingChanges.clear();
      this.emit("change", batch);
    }
  }

  public isWatching(): boolean {
    return !!this.watcher && !this.isPaused;
  }

  public async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
