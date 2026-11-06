// pm2.config.cjs — PM2 Process Configuration for kim-agent
// Use: pm2 start pm2.config.cjs
module.exports = {
  apps: [
    {
      name: "kim-agent",
      script: "./dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 20,
      min_uptime: "5s",
      // Environment
      env: {
        NODE_ENV: "production",
      },
      // Logs
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      // Graceful shutdown: allow 5s for WAL checkpoint
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Auto-restart on file changes (dev only)
      ignore_watch: ["node_modules", "data", "logs", ".git"],
    },
  ],
};
