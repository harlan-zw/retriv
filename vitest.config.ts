import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.eval.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'eval',
          include: ['test/**/*.eval.test.ts'],
        },
      },
    ],
  },
})
