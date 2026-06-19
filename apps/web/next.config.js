/* global process */
import { DEV_HOSTS } from "@repo/auth/dev-hosts";

/** @type {import('next').NextConfig} */
const nextConfig = {
	// Local dev uses `.next`; production builds go into `.next-builds/<id>` with
	// `.next-builds/current` symlinked to the active build (server deploy flow).
	distDir: process.env.BUILD_DIR || ".next",
	cacheComponents: true,
	// Local dev is served behind portless (https://sirius.localhost on this Mac,
	// https://sirius.local over LAN/mDNS for physical devices; proxy forwards to
	// next dev on :3000). Next 16 rejects cross-origin dev requests from
	// unlisted hostnames. The names come from the ONE source of truth shared
	// with better-auth's trusted origins: packages/auth/dev-hosts.js.
	allowedDevOrigins: [...DEV_HOSTS],
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
