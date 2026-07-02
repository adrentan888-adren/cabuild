/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
