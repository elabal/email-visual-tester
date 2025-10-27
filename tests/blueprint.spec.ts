// tests/blueprint.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { GeneratedPreview } from '../src/global-setup';

const taskId = process.env.TASK_NAME;

if (!taskId) {
  test.skip('No task name defined', () => {
    console.error('Environment variable TASK_NAME must be set to run this test.');
  });
} else {
  const sanitizeFilename = (name: string): string => name.toLowerCase().replace(/[^a-z0-9\s-.]/g, '').replace(/\s+/g, '_').substring(0, 100);

  const GENERATED_URLS_FILE = resolve(__dirname, '..', 'temp', `generated-preview-urls-${sanitizeFilename(taskId)}.json`);

  let generatedPreviews: GeneratedPreview[] = [];
  if (existsSync(GENERATED_URLS_FILE)) {
    try {
      const fileContent = readFileSync(GENERATED_URLS_FILE, 'utf-8');
      generatedPreviews = JSON.parse(fileContent);
      console.log(`[Test File] Loaded ${generatedPreviews.length} email preview URLs for task "${taskId}".`);
    } catch (error: any) {
      console.error(`[Test File] Error loading generated preview URLs from ${GENERATED_URLS_FILE}: ${error.message}`);
    }
  } else {
    console.error(`[Test File] Error: Generated URLs file not found at ${GENERATED_URLS_FILE}. Please ensure global-setup runs successfully.`);
  }

  // Create the tests dynamically from the loaded URLs
  if (generatedPreviews.length > 0) {
    test.describe(`Email Preview Tests for Task: ${taskId}`, () => {
      generatedPreviews.forEach(preview => {
        test(`Tests Staging - ${preview.name} (${preview.client})`, async ({ page }) => {
          const screenshotName = `${preview.client.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
          
          test.info().annotations.push({ type: 'client', description: preview.client });
          test.info().annotations.push({ type: 'previewUrl', description: preview.url });
          
          await page.goto(preview.url, { waitUntil: 'networkidle' });
          await expect(page).toHaveScreenshot(screenshotName, {
            fullPage: true,
            timeout: 10000,
            maxDiffPixelRatio: 0.05,
          });
        });
      });
    });
  } else {
    test.describe(`No Email Previews for Task: ${taskId}`, () => {
      test.skip('Skipping tests as no preview URLs were generated.', () => {});
    });
  }
}