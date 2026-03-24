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
      },
      max_memory_restart: "100M",
    },
  ],
};
