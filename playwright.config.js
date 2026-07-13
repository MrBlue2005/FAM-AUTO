const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: { baseURL: process.env.E2E_DASHBOARD_URL || 'http://127.0.0.1:5173', trace: 'retain-on-failure', channel: 'chrome' },
});
