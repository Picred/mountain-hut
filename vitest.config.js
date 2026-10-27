import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['./frontend', './backend'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: [
        'frontend/src/**/*.{js,jsx,ts,tsx}',
        'backend/**/*.{js,ts}'
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.config.*',
        'tests/**',
        '**/tests/**'
      ]
    }
  }
})