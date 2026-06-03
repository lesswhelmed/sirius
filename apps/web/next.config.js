/* global process */
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Local dev uses `.next`; production builds go into `.next-builds/<id>` with
  // `.next-builds/current` symlinked to the active build (server deploy flow).
  distDir: process.env.BUILD_DIR || ".next",
  cacheComponents: true,
  // Local dev is served behind portless at https://sirius.localhost (the proxy
  // forwards to next dev on :3000). Next 16 rejects cross-origin dev requests
  // from a hostname other than localhost unless it's allow-listed here.
  allowedDevOrigins: ["sirius.localhost"],
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
