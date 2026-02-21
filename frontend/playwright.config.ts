import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: 'e2e*.spec.ts',
    timeout: 180_000,       // 3 min per test (LLM on CPU can be slow)
    expect: { timeout: 15_000 },
    retries: 0,
    workers: 1,             // serial — one browser at a time
    use: {
        baseURL: 'http://localhost:5173',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
