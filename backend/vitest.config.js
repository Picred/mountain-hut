import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // tests live in ../tests/backend: resolve passport from backend/node_modules, so vi.mock('passport') hits the app's instance
  resolve: {
    alias: {
      passport: fileURLToPath(new URL('./node_modules/passport', import.meta.url))
    }
  },
  test: {
    name: 'backend',
    environment: 'node',
    // e2e tests run on their own database (recreated by each e2e file) and port, never on the dev ones
    env: { DB_PATH: fileURLToPath(new URL('./db/e2e.sqlite', import.meta.url)), PORT: '3002' },
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
