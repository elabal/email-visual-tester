// get-full-eoa-results.ts

import axios from 'axios';
import * as dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Load environment variables from .env file
dotenv.config();

/**
 * Helper function to generate the Basic Authentication header string.
 * Email on Acid API v5 uses HTTP Basic Authentication.
 * @param apiKey Your Email on Acid API Key.
 * @param accountPassword Your Email On Acid Account Password.
 * @returns The Basic Authorization header string.
 */
function getBasicAuthHeader(apiKey: string, accountPassword: string): string {
  const credentials = Buffer.from(`${apiKey}:${accountPassword}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Main function to retrieve the full Email on Acid test results and save them to a JSON file.
 */
async function getFullEmailOnAcidResults(): Promise<void> {
  const apiKey = process.env.EMAILONACID_API_KEY;
  const accountPassword = process.env.EMAILONACID_ACCOUNT_PASSWORD;
  
  // The specific test ID you want to retrieve the full results for
  const testId = '5IwKDsvNfngdEujSOLfqAbOZyAac8MI43OwX487N94jkr'; 
  
  // Output file for the full JSON response, including the test ID in the filename
  const outputJsonFilePath = resolve(__dirname, `eoa-full-results-${testId}.json`); 
  const apiBaseUrl = 'https://api.emailonacid.com/v5';

  // --- 1. Input Validation ---
  if (!apiKey || !accountPassword) {
    console.error('Error: EMAILONACID_API_KEY and EMAILONACID_ACCOUNT_PASSWORD must be set in your .env file.');
    process.exit(1);
  }
  if (!testId) {
    console.error('Error: The testId is missing. Please provide a valid Email on Acid test ID.');
    process.exit(1);
  }

  const authHeaders = {
    'Authorization': getBasicAuthHeader(apiKey, accountPassword),
    'Accept': 'application/json', // Specify that we accept JSON response
  };

  let fullApiResponse: any = null; // Variable to store the full API response data
  const MAX_POLLING_ATTEMPTS = 60; // Max attempts (e.g., 60 attempts * 10 seconds = 10 minutes)
  const POLLING_INTERVAL_MS = 10000; // 10 seconds

  console.log(`\n--- Retrieving Full Results for Test ID: ${testId} ---`);
  // Current Time (Buenos Aires) as of Wednesday, July 23, 2025 at 5:58:00 PM -03
  console.log(`Current Time (Buenos Aires): ${new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })}`);

  // --- 2. GET /v5/email/tests/<test_id>/results (Polling) ---
  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    // Declare allClientStatusesFinal here, at the start of each loop iteration
    // This ensures its scope covers the entire iteration including the final `if` condition.
    let allClientStatusesFinal = true; 
    let responseReceivedInThisAttempt = false; // Flag to check if we got a successful response

    try {
      console.log(`Attempt ${attempt + 1}/${MAX_POLLING_ATTEMPTS}: Fetching full results...`);
      const response = await axios.get(`${apiBaseUrl}/email/tests/${testId}/results`, { headers: authHeaders });
      fullApiResponse = response.data; // Store the entire response data
      responseReceivedInThisAttempt = true;

      const results = fullApiResponse?.results || [];
      const currentStatusCounts = { complete: 0, pending: 0, failed: 0, total: results.length };

      if (results.length === 0 && attempt === 0) {
          // If no results are available on first attempt, it's likely still processing
          allClientStatusesFinal = false;
      } else {
          for (const clientResult of results) {
            if (clientResult?.status === 'complete') {
              currentStatusCounts.complete++;
            } else if (clientResult?.status === 'pending') {
              currentStatusCounts.pending++;
              allClientStatusesFinal = false; // Found a pending client, so not all are final yet
            } else if (clientResult?.status === 'failed') {
              currentStatusCounts.failed++;
            }
          }
      }

      console.log(`  Summary: ${currentStatusCounts.complete} complete, ${currentStatusCounts.pending} pending, ${currentStatusCounts.failed} failed. Total results: ${currentStatusCounts.total}`);

      // If all clients have a final status (complete or failed), stop polling
      if (allClientStatusesFinal && currentStatusCounts.total > 0) { // Also ensure we actually have some results
        console.log('All client previews have reached a final status (complete or failed). Exiting polling.');
        break; 
      } else if (attempt === MAX_POLLING_ATTEMPTS - 1) {
          console.warn(`  Max polling attempts reached. Some clients might still be pending or results are not fully available.`);
      }

    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 404) {
          console.warn(`  Test results for ${testId} not yet available (404 Not Found). Retrying...`);
          allClientStatusesFinal = false; // Keep polling if 404
        } else if (error.response.status === 401) {
          console.error("  Authentication failed during polling. Check API Key and Account Password.");
          process.exit(1); // Critical error, stop script
        } else {
          console.warn(`  Polling error, status ${error.response.status}: ${error.message}. Retrying...`);
          allClientStatusesFinal = false; // Keep polling for other errors
        }
      } else {
        console.warn(`  Network or unexpected error during polling: ${error.message}. Retrying...`);
        allClientStatusesFinal = false; // Keep polling for network errors
      }
    }

    // Only wait if it's not the last attempt AND we are still waiting for results to finalize
    if (attempt < MAX_POLLING_ATTEMPTS - 1 && !allClientStatusesFinal) {
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
    }
  }

  if (!fullApiResponse) {
    console.warn(`\nNo API response was successfully retrieved for test ID ${testId} after ${MAX_POLLING_ATTEMPTS} attempts.`);
    process.exit(1); // Exit if no response was ever successfully retrieved
  } else {
    console.log('\n--- Full API Response Retrieved ---');
  }

  // --- 3. Save Full Response to a JSON file ---
  console.log('\n--- Saving Full API Response to File ---');
  try {
    writeFileSync(outputJsonFilePath, JSON.stringify(fullApiResponse, null, 2), 'utf-8');
    console.log(`Successfully saved full API response to: ${outputJsonFilePath}`);
  } catch (error: any) {
    console.error(`Error saving full API response to file ${outputJsonFilePath}:`, error.message);
    process.exit(1);
  }

  console.log('\n--- Retrieval Complete ---');
}

// Execute the main function
getFullEmailOnAcidResults();