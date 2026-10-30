import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/frontend/e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'node index.js',  
      cwd: './backend',
      port: 3001,
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev',
      cwd: './frontend',
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});