import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@/lib/brand";
import { BrandMark } from "@/components/BrandLogo";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${BRAND.name} — ${BRAND.tagline}`;

const INK = "#070d16";
const ACCENT = "#60a5fa";

/**
 * Social preview card for links to the marketing page. The file lives at the site root because the
 * route gate treats metadata files as public assets (a language-prefixed copy would redirect crawlers
 * to the sign-in page), so one card serves both languages: each line appears in English and French.
 */
export default async function OpenGraphImage() {
  const [en, fr] = await Promise.all([
    getTranslations({ locale: "en", namespace: "marketing.og" }),
    getTranslations({ locale: "fr", namespace: "marketing.og" }),
  ]);

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 72,
        background: INK,
        color: "#e2e8f0",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 72,
            height: 72,
            borderRadius: 16,
            background: ACCENT,
          }}
        >
          <BrandMark size={52} color={INK} />
        </div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>
          <span>{BRAND.wordmark.lead}</span>
          <span style={{ color: ACCENT }}>{BRAND.wordmark.tail}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            fontSize: 78,
            fontWeight: 700,
            letterSpacing: -2.5,
            lineHeight: 1.1,
          }}
        >
          {en("tagline")}
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#a3b1c6", maxWidth: 1000 }}>
          {fr("tagline")}
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#8393a8" }}
      >
        <div style={{ width: 56, height: 4, background: ACCENT }} />
        <span>{BRAND.domain}</span>
      </div>
    </div>,
    size
  );
}
