import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["sharp", "@prisma/client", "googleapis", "exceljs", "archiver"],
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // pages: no embedding by other sites. (File routes under /api set their own stricter CSP.)
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
    ];
  },
};
export default config;
