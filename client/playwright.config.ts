// client/playwright.config.ts — development_guide.md §6.6
import { defineConfig, devices } from '@playwright/test';

const chromiumMediaArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000, // AC-073/082 cần chờ tới 47 s
  expect: { timeout: 10_000 },
  fullyParallel: false, // các spec dùng chung DB seed
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', // DG-01; smoke production: https://<domain> (§9.7)
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: chromiumMediaArgs },
        permissions: ['camera', 'microphone'],
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true },
        },
      },
    },
    {
      // WebKit của Playwright không có thiết bị media giả tin cậy: chỉ chạy spec không gắn tag @media.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grepInvert: /@media/,
    },
  ],
  // Chạy với E2E_BASE_URL (môi trường đã deploy) thì không tự khởi động dev server.
  // (spread có điều kiện thay cho `webServer: undefined` vì tsconfig bật exactOptionalPropertyTypes)
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          cwd: '..',
          url: 'http://localhost:5173/api/v1/health',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
