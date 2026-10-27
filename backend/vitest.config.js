import { defineConfig } from 'vitest/config'

export default defineConfig({
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