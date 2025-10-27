// src/services/email-on-acid-service.ts
import axios from 'axios';
import { IEmailPreviewService } from '../interfaces/i-email-preview-service';

// Helper function for basic authentication header
function getBasicAuthHeader(apiKey: string, accountPassword: string): string {
  const credentials = Buffer.from(`${apiKey}:${accountPassword}`).toString('base64');
  return `Basic ${credentials}`;
}

export class EmailOnAcidService implements IEmailPreviewService {
  private readonly apiKey: string;
  private readonly accountPassword: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, accountPassword: string) {
    if (!apiKey || !accountPassword) {
      throw new Error('EmailOnAcidService: API key and account password are required for Basic Authentication.');
    }
    this.apiKey = apiKey;
    this.accountPassword = accountPassword;
    this.baseUrl = 'https://api.emailonacid.com';
  }

  /**
   * Injects email HTML content and initiates the test.
   * Returns the test_id from Email on Acid.
   * @param htmlContent The HTML content of the email.
   * @param subject Optional subject for the email preview.
   * @param options Optional additional service-specific options.
   * @returns A promise that resolves to an object containing the EOA `test_id`.
   */
  async injectHtml(
    htmlContent: string,
    subject?: string,
    options?: Record<string, any>
  ): Promise<{ test_id: string }> {
    const headers = {
      'Authorization': getBasicAuthHeader(this.apiKey, this.accountPassword),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const clientsForTestCreation = options?.clients && Array.isArray(options.clients) 
                                   ? options.clients 
                                   : undefined; // Pass undefined to let EOA decide if no specific list is given

    const payload = {
      subject: subject || `Email Test - ${new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })}`,
      html: htmlContent,
      ...(clientsForTestCreation ? { clients: clientsForTestCreation } : {}),
      // Any other options passed via `options` will be spread here.
      // Make sure 'clients' isn't duplicated if it's already in `options`.
      ...options,
    };

    try {
      const response = await axios.post(`${this.baseUrl}/v5/email/tests`, payload, {
        headers,
      });
      if (!response.data || !response.data.id) {
        throw new Error('Email on Acid API did not return a test ID.');
      }
      console.log(`EmailOnAcidService: Test created with ID: ${response.data.id}`);
      return { test_id: response.data.id };
    } catch (error: any) {
      console.error('Error injecting HTML with Email on Acid:', error.message);
      if (axios.isAxiosError(error) && error.response) {
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('Response status:', error.response.status);
      }
      throw new Error(`Failed to inject HTML with Email on Acid: ${error.message}`);
    }
  }

  /**
   * Retrieves preview URLs for specified email clients by polling the API.
   * @param injectionResponse The response object obtained from `injectHtml` (expected to contain test_id).
   * @param emailClients A list of email client identifiers (e.g., 'applemail16_dm', 'm365_w11_dm_dt').
   * @returns A promise that resolves to a dictionary where keys are client names and values are their preview URLs.
   */
  async getPreviewUrls(
    injectionResponse: { test_id: string },
    emailClients: string[]
  ): Promise<Record<string, string>> {
    const { test_id } = injectionResponse;
    if (!test_id) {
      throw new Error('EmailOnAcidService: test_id is required to get preview URLs.');
    }
    if (!emailClients || emailClients.length === 0) {
      console.warn('EmailOnAcidService: No specific emailClients provided for getPreviewUrls. Will return all completed URLs.');
    }

    const headers = {
      'Authorization': getBasicAuthHeader(this.apiKey, this.accountPassword),
      'Accept': 'application/json',
    };

    const extractedUrls: Record<string, string> = {};
    const MAX_POLLING_ATTEMPTS = 60; // Max attempts (60 attempts * 10 seconds = 10 minutes max wait)
    const POLLING_INTERVAL_MS = 10000; // Wait 10 seconds between each polling attempt

    for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
      let allTargetClientsProcessed = true; // Assume true, then set to false if any are pending/missing

      try {
        console.log(`\n  --- Polling Attempt ${attempt + 1}/${MAX_POLLING_ATTEMPTS} for test ID: ${test_id} ---`);
        const response = await axios.get(`${this.baseUrl}/v5/email/tests/${test_id}/results`, {
          headers,
          timeout: POLLING_INTERVAL_MS * 0.9 // Ensure timeout is less than interval
        });
        
        const currentApiResults: Record<string, any> = response.data || {};

        // Determine which clients we *actually* need to poll for (targetClients, or all if none specified)
        const clientsToMonitor = emailClients && emailClients.length > 0 ? emailClients : Object.keys(currentApiResults);

        // If no clients were returned yet, keep polling.
        if (Object.keys(currentApiResults).length === 0 && clientsToMonitor.length > 0) {
            allTargetClientsProcessed = false;
            console.log(`    DEBUG: No client results found in this response yet. Continuing to poll.`);
        }

        // Iterate through the *desired* or *all available* clients to check their status
        for (const targetClientId of clientsToMonitor) {
          const clientResult = currentApiResults[targetClientId]; // Access client data directly by ID

          if (!clientResult) {
            // This target client is not yet in the results object, so we need to continue polling.
            allTargetClientsProcessed = false; 
            console.log(`    DEBUG: Target client "${targetClientId}" not found in current API results object. Continuing to poll.`);
            continue; // Move to next target client
          }

          // Check the status of the found client result
          if (clientResult.status === 'Complete') { 
            // Client is complete. Extract and store ONLY the default screenshot URL.
            if (clientResult.screenshots?.default && typeof clientResult.screenshots.default === 'string') {
              if (extractedUrls[targetClientId] !== clientResult.screenshots.default) {
                  extractedUrls[targetClientId] = clientResult.screenshots.default;
                  console.log(`    SUCCESS: Stored/Updated URL for "${targetClientId}": ${extractedUrls[targetClientId]}`);
              } else {
                  console.log(`    INFO: URL for "${targetClientId}" already captured and is the same. No update needed.`);
              }
            } else {
              // Client is complete, but the URL is missing or not a string. This is an unexpected state.
              console.warn(`    WARNING: Client "${targetClientId}" is 'Complete', but default screenshot URL is missing or invalid. Value: ${clientResult.screenshots?.default}`);
              // Since the URL isn't valid yet, we still consider this client as not fully processed for a URL.
              allTargetClientsProcessed = false; 
            }
          } else if (clientResult.status === 'Failed' || clientResult.status === 'Bounced') { 
            // Client failed or bounced. We consider it processed for the purpose of stopping polling for *this* client.
            if (!extractedUrls[targetClientId]) { // Log failure only if we haven't already marked it as complete
              console.warn(`    FAILED: Client "${targetClientId}" status: ${clientResult.status}. Error: ${clientResult.status_details?.bounce_message || clientResult.error_message || 'No specific error message provided.'}`);
            }
          } else { // Status is 'Processing', 'Pending', or something else not final.
            // Client is still pending, so we need to continue polling overall.
            allTargetClientsProcessed = false;
            console.log(`    Client "${targetClientId}" is still "${clientResult.status}". Continuing to poll.`);
          }
        }

        // After iterating, check if all *desired* clients have reached a final state.
        const finalizedTargetClientsCount = clientsToMonitor.filter(id => {
            const clientData = currentApiResults[id];
            return clientData && (clientData.status === 'Complete' || clientData.status === 'Failed' || clientData.status === 'Bounced');
        }).length;

        if (finalizedTargetClientsCount === clientsToMonitor.length) {
          console.log('\n  All desired client previews have reached a final status (Complete, Failed, or Bounced)! Exiting polling loop.');
          break; // Exit polling loop as we have all necessary data or confirmed failures
        } else {
          const extractedCount = Object.keys(extractedUrls).length;
          const remainingToProcess = clientsToMonitor.filter(id => {
              const clientData = currentApiResults[id];
              // Remaining if not in response OR status is not final
              return !clientData || (clientData.status !== 'Complete' && clientData.status !== 'Failed' && clientData.status !== 'Bounced');
          });
          console.log(`  Overall Progress: ${extractedCount} URLs successfully extracted. ${remainingToProcess.length} clients still pending/not in final state: [${remainingToProcess.join(', ')}]`);
        }

      } catch (error: any) {
        if (axios.isAxiosError(error) && error.response) {
          if (error.response.status === 404) {
            console.warn(`  Polling error: Test results for ${test_id} not yet available (404 Not Found). Retrying...`);
            allTargetClientsProcessed = false; 
          } else if (error.response.status === 401) {
            console.error("  Polling error: Authentication failed. Please check API Key and Account Password.");
            throw error; // Re-throw fatal auth error
          } else {
            console.warn(`  Polling error, status ${error.response.status}: ${error.message}. API Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
            allTargetClientsProcessed = false; 
          }
        } else {
          console.warn(`  Network or unexpected error during polling: ${error.message}. Retrying...`);
          allTargetClientsProcessed = false; 
        }
      }

      // Only wait if it's not the last attempt AND we are still waiting for results to finalize
      if (attempt < MAX_POLLING_ATTEMPTS - 1 && !allTargetClientsProcessed) {
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
      }
    }

    // Final log and return
    if (Object.keys(extractedUrls).length === 0 && emailClients.length > 0) {
      console.warn(`EmailOnAcidService: No completed preview URLs were retrieved for specified clients [${emailClients.join(', ')}] for test ID ${test_id} after ${MAX_POLLING_ATTEMPTS} attempts.`);
    } else if (emailClients.length > 0 && Object.keys(extractedUrls).length < emailClients.length) {
      const missingClients = emailClients.filter(id => !extractedUrls[id]);
      console.warn(`EmailOnAcidService: Only ${Object.keys(extractedUrls).length} of ${emailClients.length} desired client previews completed and had URLs. Missing: [${missingClients.join(', ')}]`);
    } else if (emailClients.length > 0) {
        console.log(`EmailOnAcidService: Successfully retrieved URLs for all ${Object.keys(extractedUrls).length} specified clients.`);
    } else {
        console.log(`EmailOnAcidService: Retrieved URLs for ${Object.keys(extractedUrls).length} clients (no specific clients requested).`);
    }
    
    return extractedUrls;
  }

  async getSupportedClients(): Promise<string[]> {
    const headers = {
      'Authorization': getBasicAuthHeader(this.apiKey, this.accountPassword),
      'Accept': 'application/json',
    };

    try {
      const response = await axios.get(`${this.baseUrl}/v5/email/clients`, { headers });
      const clients = response.data;
      if (clients && typeof clients === 'object') {
        return Object.keys(clients);
      }
      return [];
    } catch (error: any) {
      console.error('Error fetching supported clients from Email on Acid:', error.message);
      if (axios.isAxiosError(error) && error.response) {
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('Response status:', error.response.status);
      }
      return [];
    }
  }
}