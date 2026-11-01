import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['./frontend', './backend'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: [
        '../tests/frontend/**/*.{js,ts,jsx,tsx}',
        'frontend/src/**/*.{js,jsx,ts,tsx}',
        'backend/**/*.{js,ts}'
      ],
      exclude: [
        '../tests/frontend/e2e/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/*.config.*',
        'tests/**',
        '**/tests/**',
        'backend/db/init-db.js',
      ]
    }
  }
})