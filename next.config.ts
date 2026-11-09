import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Pages grouped under hubs (Inventory, Quality, Records, Compliance). The old flat URLs keep
 * working for bookmarks and printed QR labels.
 */
const MOVED_PAGES: Record<string, string> = {
  units: "inventory/units",
  experiments: "inventory/experiments",
  materials: "inventory/materials",
  destroyed: "inventory/destroyed",
  qa: "quality",
  recall: "quality/recall",
  cultivars: "records/cultivars",
  locations: "records/locations",
  organizations: "records/organizations",
  members: "records/members",
  overview: "compliance",
  reports: "compliance/reports",
  activity: "compliance/audit",
};

const nextConfig: NextConfig = {
  // The e2e server (scripts/e2e-server.ts) builds into its own folder so it can run next to `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  // Do not advertise the framework.
  poweredByHeader: false,
  // Self-contained server bundle for the container image (see Dockerfile).
  output: "standalone",
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "pino"],
  async redirects() {
    return Object.entries(MOVED_PAGES).flatMap(([from, to]) => [
      {
        source: `/:locale(en|fr)/${from}/:path*`,
        destination: `/:locale/${to}/:path*`,
        permanent: false,
      },
      { source: `/${from}/:path*`, destination: `/${to}/:path*`, permanent: false },
    ]);
  },
};

export default withNextIntl(nextConfig);
