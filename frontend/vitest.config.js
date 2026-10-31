import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  // tests live in ../tests/frontend: always resolve these from frontend/node_modules (single React copy)
  resolve: {
    alias: [
      ...['react', 'react-dom', 'react-router'].map((pkg) => ({
        find: new RegExp(`^${pkg}(/.*)?$`),
        replacement: fileURLToPath(new URL(`./node_modules/${pkg}$1`, import.meta.url))
      })),
      // ESM build, so its react-dom imports go through the aliases above
      {
        find: /^@testing-library\/react$/,
        replacement: fileURLToPath(new URL('../node_modules/@testing-library/react/dist/@testing-library/react.esm.js', import.meta.url))
      }
    ]
  },
  test: {
    name: 'frontend',
    environment: 'jsdom',
    server: {
      deps: {
        inline: [/@testing-library/]
      }
    },
    include: [
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'tests/**/*.{js,ts,jsx,tsx}',
      '../tests/frontend/**/*.{js,ts,jsx,tsx}'
    ],
    exclude: ['../tests/frontend/e2e/**', '**/node_modules/**']
  }
})