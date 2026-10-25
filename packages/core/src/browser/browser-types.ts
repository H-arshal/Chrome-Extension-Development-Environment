export type ProfileMode = "persistent" | "ephemeral";

export interface BrowserLaunchConfig {
  extensionPaths: string[];
  userDataDir?: string;
  profileMode?: ProfileMode;
  customExecutablePath?: string;
  channel?: string;
  cacheDir: string;
  startUrls?: string[];
  headless?: boolean;
}

export interface BrowserSessionInfo {
  pid: number;
  port: number;
  wsEndpoint: string;
  profileDir: string;
  executablePath: string;
  isEphemeral: boolean;
}
