import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/BrandLogo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const INK = "#070d16";
const BRAND = "#60a5fa";

/** Home-screen icon. Same ribbon mark as the in-app lockup. */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: INK,
      }}
    >
      <BrandMark size={132} color={BRAND} />
    </div>,
    size
  );
}
