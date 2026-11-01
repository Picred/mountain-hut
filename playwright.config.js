import { defineConfig } from '@playwright/test';

// e2e tests run on their own ports and database, recreated from the demo data before each run:
// the dev app (3001/5173) and its database are never touched
export default defineConfig({
  testDir: './tests/frontend/e2e',
  use: { baseURL: 'http://localhost:5174' },
  webServer: [
    {
      command: 'node db/init-db.js --reset && node index.js',
      cwd: './backend',
      env: { DB_PATH: 'db/e2e.sqlite', PORT: '3002', CORS_ORIGIN: 'http://localhost:5174' },
      port: 3002,
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort',
      cwd: './frontend',
      env: { VITE_API_URL: 'http://localhost:3002' },
      port: 5174,
    },
  ],
});
