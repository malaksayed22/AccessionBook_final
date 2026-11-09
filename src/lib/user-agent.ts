/**
 * A short, human description of a browser from its User-Agent header, for the "active sessions" list.
 * Deliberately small: names are proper nouns (not translated); anything unrecognised is null and the UI
 * says "Unknown device". Never use this for security decisions.
 */
export function describeUserAgent(userAgent: string | null | undefined): {
  browser: string | null;
  system: string | null;
} {
  const ua = userAgent ?? "";
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua) && /Version\//.test(ua)
            ? "Safari"
            : null;
  const system = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return { browser, system };
}
