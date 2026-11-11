// PM2 keeps the app running and restarts it after a crash or reboot.
//   pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'office-attendance',
      script: './server.js',
      cwd: __dirname,
      instances: 1, // keep 1: data is saved in JSON files
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3112
      }
    }
  ]
};
