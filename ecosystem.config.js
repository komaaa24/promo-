module.exports = {
  apps: [
    {
      name: "promo-bot",
      script: "dist/main.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: "350M",
      kill_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
