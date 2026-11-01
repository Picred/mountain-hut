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
    include: [
      'tests/**/*.{js,ts}',
      '../tests/backend/**/*.{js,ts}',
      '**/*.{test,spec}.{js,ts}'
    ]
  }
})
