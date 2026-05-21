/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.cdninstagram.com",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/library",
        destination: "/catalog",
        permanent: true,
      },
      {
        source: "/library/:path*",
        destination: "/catalog/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
