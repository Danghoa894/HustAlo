// client/playwright.config.ts — khung M0; cấu hình đầy đủ (projects, fake media, webServer) theo
// development_guide.md §6.6 được hoàn thiện từ milestone có test E2E đầu tiên (M1).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'https://localhost:5173',
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
