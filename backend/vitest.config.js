import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // tests live in ../tests/backend: resolve passport and nodemailer from backend/node_modules,
  // so vi.mock('passport') and vi.mock('nodemailer') hit the app's instances
  resolve: {
    alias: {
      passport: fileURLToPath(new URL('./node_modules/passport', import.meta.url)),
      nodemailer: fileURLToPath(new URL('./node_modules/nodemailer', import.meta.url))
    }
  },
  test: {
    name: 'backend',
    environment: 'node',
    // e2e tests run on their own database (recreated by each e2e file) and port, never on the dev ones;
    // an empty MAIL_USER is not overwritten by backend/.env: emails are printed, never sent
    env: { DB_PATH: fileURLToPath(new URL('./db/e2e.sqlite', import.meta.url)), PORT: '3002', MAIL_USER: '' },
    // every e2e file starts backend/index.js on port 3002: running files in parallel,
    // the first one to finish closes the server the others are still using
    fileParallelism: false,
    include: [
      'tests/**/*.{js,ts}',
      '../tests/backend/**/*.{js,ts}',
      '**/*.{test,spec}.{js,ts}'
    ]
  }
})
