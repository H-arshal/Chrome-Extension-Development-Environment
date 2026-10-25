/**
 * Utility to match Chrome Extension URL patterns against active browser tab URLs.
 * Specification: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
 */
export class TabMatcher {
  /**
   * Converts a Chrome match pattern into a RegExp.
   */
  public static patternToRegex(pattern: string): RegExp | null {
    if (pattern === "<all_urls>") {
      return /^(https?|file|ftp):\/\/.*/;
    }

    const match = pattern.match(/^(\*|http|https|file|ftp):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/);
    if (!match) {
      return null;
    }

    const [, scheme, host, pathPart] = match;

    let schemeRegex = scheme;
    if (scheme === "*") {
      schemeRegex = "https?";
    }

    let hostRegex = host;
    if (host === "*") {
      hostRegex = "[^/]+";
    } else if (host.startsWith("*.")) {
      const baseDomain = host.slice(2).replace(/\./g, "\\.");
      hostRegex = `(?:[^/]+\\.)?${baseDomain}`;
    } else {
      hostRegex = host.replace(/\./g, "\\.");
    }

    const pathRegex = pathPart.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&").replace(/\*/g, ".*");

    return new RegExp(`^${schemeRegex}:\\/\\/${hostRegex}${pathRegex}$`);
  }

  /**
   * Tests whether a tab URL matches any of the given patterns.
   */
  public static matchesAny(tabUrl: string, patterns: string[]): boolean {
    if (!patterns || patterns.length === 0) return false;

    for (const pattern of patterns) {
      const regex = this.patternToRegex(pattern);
      if (regex && regex.test(tabUrl)) {
        return true;
      }
    }

    return false;
  }
}
