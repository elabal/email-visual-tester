// src/global-setup.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import * as dotenv from 'dotenv';
import { IEmailPreviewService } from './interfaces/i-email-preview-service';
import { getEmailPreviewService } from './utils/service-factory';
import axios from 'axios';

dotenv.config();

export interface GeneratedPreview {
  name: string;
  url: string;
  client: string;
}

const TEMP_DIR = resolve(__dirname, '..', 'temp');
const ARCHIVE_DIR = resolve(TEMP_DIR, 'archives');
const EMAILS_DIR = resolve(__dirname, '..', 'emails');
const DEFAULT_CLIENTS_FILE = resolve(__dirname, '..', 'default-clients-eoa.json');

// Helper function to sanitize string for use in file names
function sanitizeFilename(name: string, isKebabCase: boolean = true): string {
  let sanitized = name.toLowerCase().replace(/[^a-z0-9\s-.]/g, '');
  if (isKebabCase) {
      sanitized = sanitized.replace(/\s+/g, '-');
  } else {
      sanitized = sanitized.replace(/\s+/g, '_');
  }
  return sanitized.substring(0, 100);
}

async function globalSetup() {
  const taskName = process.env.TASK_NAME;
  
  if (!taskName) {
    console.warn('\nWARNING: TASK_NAME is not set. Cannot determine which HTML file to use. Exiting setup.');
    return;
  }

  const emailHtmlFileName = `${sanitizeFilename(taskName)}.html`;
  const EMAIL_HTML_FILE = resolve(EMAILS_DIR, emailHtmlFileName);
  const sanitizedTaskName = sanitizeFilename(taskName, false); // For JSON filename
  const GENERATED_URLS_FILE = resolve(TEMP_DIR, `generated-preview-urls-${sanitizedTaskName}.json`);

  const now = new Date();
  const verboseTimestamp = [
    now.getUTCFullYear(),
    (now.getUTCMonth() + 1).toString().padStart(2, '0'),
    now.getUTCDate().toString().padStart(2, '0'),
    now.getUTCHours().toString().padStart(2, '0'),
    now.getUTCMinutes().toString().padStart(2, '0'),
    now.getUTCSeconds().toString().padStart(2, '0'),
    now.getUTCMilliseconds().toString().padStart(3, '0')
  ].join('-');
  
  let taskIdForLogs = `${taskName} - EOA-API-${now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })}`;

  console.log(`\n--- Running Playwright Global Setup for Task: "${taskName}" ---`);

  if (!existsSync(EMAIL_HTML_FILE)) {
    throw new Error(`Error: Could not find email HTML file at ${EMAIL_HTML_FILE}.`);
  }
  
  let desiredApiClients: string[] = [];
  if (existsSync(DEFAULT_CLIENTS_FILE)) {
    try {
      const clientsConfigString = readFileSync(DEFAULT_CLIENTS_FILE, 'utf-8');
      const clientsConfig = JSON.parse(clientsConfigString);
      desiredApiClients = Object.values(clientsConfig).map((client: any) => client.id);
    } catch (error: any) {
      throw new Error(`[${taskIdForLogs}] Failed to load default email preview clients.`);
    }
  } else {
    throw new Error(`Error: Could not find default clients file at ${DEFAULT_CLIENTS_FILE}.`);
  }

  const serviceToUse = process.env.EMAIL_PREVIEW_SERVICE?.toLowerCase();
  const apiKey = process.env[`${serviceToUse?.toUpperCase()}_API_KEY`];
  const accountPassword = process.env.EMAILONACID_ACCOUNT_PASSWORD; 

  if (!serviceToUse || !apiKey || !accountPassword) {
    throw new Error('Environment variables EMAIL_PREVIEW_SERVICE, its API key, and EOA password must be set.');
  }

  if (!existsSync(TEMP_DIR)) { mkdirSync(TEMP_DIR, { recursive: true }); }
  if (!existsSync(ARCHIVE_DIR)) { mkdirSync(ARCHIVE_DIR, { recursive: true }); }

  const emailHtmlContent = readFileSync(EMAIL_HTML_FILE, 'utf-8');
  let previewService: IEmailPreviewService;
  try {
    previewService = getEmailPreviewService(serviceToUse, apiKey, accountPassword);
  } catch (error: any) {
    throw new Error(`[${taskIdForLogs}] Error initializing email preview service: ${error.message}`);
  }

  try {
    const emailSubject = `${taskName || 'Playwright Test'} - EOA Preview - ${now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })}`;
    const injectionResponse = await previewService.injectHtml(emailHtmlContent, emailSubject, { clients: desiredApiClients });
    const previewUrlsMap = await previewService.getPreviewUrls(injectionResponse, desiredApiClients);

    const generatedPreviews: GeneratedPreview[] = Object.entries(previewUrlsMap).map(([client, url]) => ({
      name: `${client.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())} Preview`,
      url,
      client,
    }));
    
    writeFileSync(GENERATED_URLS_FILE, JSON.stringify(generatedPreviews, null, 2));
    console.log(`[${taskIdForLogs}] Generated URLs saved to: ${GENERATED_URLS_FILE}`);

    if (taskName) {
        // ➡️ NEW: Use the verbose timestamp for the archive filename
        const archiveFileName = `generated-preview-urls-${sanitizedTaskName}-${verboseTimestamp}.json`;
        const archiveFilePath = resolve(ARCHIVE_DIR, archiveFileName);
        writeFileSync(archiveFilePath, JSON.stringify(generatedPreviews, null, 2));
        console.log(`[${taskIdForLogs}] Archived URLs to: ${archiveFilePath}`);
    } else {
        console.warn(`[${taskIdForLogs}] Skipping archiving URLs: TASK_NAME environment variable not set.`);
    }

  } catch (error: any) {
    console.error(`[${taskIdForLogs}] Critical error during email preview API process:`, error.message);
    if (axios.isAxiosError(error) && error.response) {
      console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    throw new Error(`[${taskIdForLogs}] Failed to generate preview URLs: ${error.message}`);
  }

  console.log('--- Playwright Global Setup Finished ---');
}

export default globalSetup;

// --- TEMPORARY ADDITION FOR DIRECT TESTING ONLY ---
// This block ensures globalSetup() is called when the script is run directly
// via `ts-node src/global-setup.ts`.
// Playwright handles calling globalSetup() automatically during `playwright test` runs.
// if (require.main === module) {
//   globalSetup().catch(error => {
//     console.error("Error executing global setup directly:", error);
//     process.exit(1);
//   });
// }
// --- END TEMPORARY ADDITION ---´