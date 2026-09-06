/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Long writing requests need more than Next's default 30-second proxy window.
  // The provider deadline (210s) expires before this and Cloud Run (300s).
  experimental: { proxyTimeout: 240000 },
  async rewrites() {
    const apiUrl = process.env.API_SERVICE_URL;
    const surface = process.env.APP_SURFACE || "combined";
    if (!apiUrl || surface === "api" || surface === "combined") return [];
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${apiUrl.replace(/\/$/, "")}/api/:path*`
        }
      ]
    };
  }
};

export default nextConfig;
