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
	turbopack: {
		// Suppress a benign Output File Tracing (NFT) warning. lib/originals/
		// originals-paths.ts resolves the PRIVATE originals/archives roots via
		// `resolve(process.cwd(), "..", "..", ...)` at request time. @vercel/nft
		// statically folds that to the repo root and traces the whole project,
		// then reports "Encountered unexpected file in NFT list" against this
		// config. The path math is intentional and runtime-only (nothing is
		// imported from those dirs), and this app deploys via `bun run start`
		// (pm2), not `output: standalone`, so the NFT list is never consumed. The
		// documented `/* turbopackIgnore */` magic comment does not suppress this
		// NFT issue in Next 16.2.x, so we scope-suppress the issue itself.
		ignoreIssue: [
			{
				path: "**/next.config.js",
				title: "Encountered unexpected file in NFT list",
			},
		],
	},
};

export default nextConfig;
