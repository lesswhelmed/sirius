"use strict";

// PM2 process manifest for sirius-2-simple.
//   sirius-web    — Next.js production server (apps/web)
//   sirius-worker — long-running ingest worker daemon (apps/worker)
//
// Both inherit the repo-root .env via dotenv loading inside each app.
// Override DEPLOY_ROOT for non-standard install paths.

const path = require("node:path");

const ROOT =
  process.env.SIRIUS_DEPLOY_ROOT ||
  path.resolve(__dirname);

module.exports = {
  apps: [
    {
      name: "sirius-web",
      script: "bun",
      args: "run start",
      interpreter: "none",
      cwd: path.join(ROOT, "apps", "web"),
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1024M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/deploy/logs/sirius-web-error.log",
      out_file: "/home/deploy/logs/sirius-web-out.log",
      merge_logs: true,
    },
    {
      name: "sirius-worker",
      script: "bun",
      args: "run start",
      interpreter: "none",
      cwd: path.join(ROOT, "apps", "worker"),
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1024M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/deploy/logs/sirius-worker-error.log",
      out_file: "/home/deploy/logs/sirius-worker-out.log",
      merge_logs: true,
    },
  ],
};
