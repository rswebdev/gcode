import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: {
      // SwiftShader software WebGL so headless Chromium can create a WebGL context.
      args: ['--use-angle=swiftshader', '--disable-gpu-sandbox'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
