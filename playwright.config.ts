// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env file (e.g., your EOA API keys, TASK_NAME, BUILD_NAME)
dotenv.config();

// Helper to sanitize filename to prevent path issues
function sanitizeFilename(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\s-.]/g, '').replace(/\s+/g, '-').substring(0, 100);
}

 // Get the task name from the environment variable
  const taskName = process.env.TASK_NAME;
  const projectName = taskName ? sanitizeFilename(taskName) : 'staging';

/**
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({

  // Path to your global setup file. This script will run once before all tests.
  // It's responsible for interacting with the Email on Acid API to generate preview URLs.
  globalSetup: resolve(__dirname, 'src', 'global-setup.ts'),

  // Directory where your test files are located.
  testDir: './tests', 

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  // Retries tests twice on CI environments, no retries locally by default.
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI. */
  // Runs tests sequentially on CI, in parallel locally (if `workers` not specified).
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html', // Generates an HTML report after test execution.

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry', // Captures trace for failed tests on retry, helpful for debugging.
  },

  /* Configure projects for different environments/browsers */
  projects: [
    {
      // This is our main project for running email preview tests against the 'staging' context.
      // The 'name' property 'staging' is used in the `pathTemplate` below for screenshot organization.
      name: projectName, 
      testMatch: 'tests/blueprint.spec.ts'
    },
  ],

  /* Output directory for test results, traces, and generated screenshots/snapshots. */
  outputDir: 'test-results/',

  /* Configure screenshot and snapshot path templates */
  expect: {
      toHaveScreenshot: {
        // We will store the screenshots in a new folder named 'visual-baselines'.
        pathTemplate: resolve(__dirname, 'visual-baselines', '{projectName}', '{arg}{ext}'),
      },
      toMatchAriaSnapshot: {
        // Snapshots will also go into this new folder.
        pathTemplate: resolve(__dirname, 'visual-baselines', '{projectName}', '{arg}{ext}'),
      },
    },
});
