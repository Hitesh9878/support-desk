/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // ── Proxy all /api/* requests to the Express backend ────────────────────────
  // This is what stops Next.js from returning 404 on /api/auth/forgot-password
  // and every other Express API route when running via Next.js dev server.
  async rewrites() {
    const expressPort = process.env.EXPRESS_PORT || '5000';
    return [
      {
        source: '/api/:path*',
        destination: `https://trademav.info/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `https://trademav.info/uploads/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/login.html',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
