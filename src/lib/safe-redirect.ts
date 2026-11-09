/**
 * Where to go after sign-in. Only a same-site path is acceptable: anything that a browser could
 * read as another host (`//evil.com`, `/\evil.com`, `https://…`, `javascript:`) falls back.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || next.length > 2000) return fallback;
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  try {
    const parsed = new URL(next, "http://placeholder.invalid");
    if (parsed.host !== "placeholder.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
