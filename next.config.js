/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Microsoft 365 page was folded into Custom Solutions (see
  // app/(marketing)/custom-solutions/page.tsx) and its content
  // deliberately never names the underlying provider. Any old link or
  // bookmark to the standalone page should land on the merged content
  // instead of a 404.
  async redirects() {
    return [
      { source: "/microsoft-365", destination: "/custom-solutions", permanent: true },
    ];
  },
};
module.exports = nextConfig;
