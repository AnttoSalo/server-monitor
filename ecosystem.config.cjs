module.exports = {
  apps: [
    {
      name: "monitor",
      script: "dist/index.js",
      env: {
        PORT: 3099,
        NODE_ENV: "production",
        PING_TARGETS: "1.1.1.1,8.8.8.8,google.com",
        HISTORY_RETENTION_DAYS: 7,
        MONITOR_SERVICES: "ssh,nginx,cloudflared",
        ALERT_WEBHOOK: "",
        ALERT_CPU: 90,
        ALERT_MEMORY: 85,
        ALERT_DISK: 90,
        ALERT_TEMP: 80,
        CERT_DOMAINS: "",
        REPORT_INTERVAL: "daily",
      },
      max_memory_restart: "100M",
    },
  ],
};
