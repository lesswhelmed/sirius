/* global process */
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Local dev uses `.next`; production builds go into `.next-builds/<id>` with
  // `.next-builds/current` symlinked to the active build (server deploy flow).
  distDir: process.env.BUILD_DIR || ".next",
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.cdninstagram.com",
      },
    ],
  },
};

export default nextConfig;
