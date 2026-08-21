import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off' },
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:8787/health/ready',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
