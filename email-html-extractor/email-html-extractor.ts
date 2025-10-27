import * as fs from 'fs/promises';
import { google, gmail_v1 } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';

// Define the type for the configuration file
interface Config {
  auth: {
    scopes: string[];
    keyfilePath: string;
  };
  email: {
    messageId: string; // The unique ID of the email message
  };
}

// Define the type for the extracted email data
interface EmailHTMLData {
  id: string;
  html: string;
  timestamp: number | null;
}

/**
 * Loads the configuration from a JSON file.
 * @param filepath The path to the config file.
 * @returns The parsed Config object or null if an error occurred.
 */
async function loadConfig(filepath = 'config.json'): Promise<Config | null> {
  try {
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data) as Config;
  } catch (error) {
    console.error(`Error loading config file: ${error}`);
    return null;
  }
}

/**
 * Extracts the HTML content from a given email message payload.
 * Handles both multipart and single-part email structures.
 * @param payload The payload of the email message.
 * @returns The HTML content as a string, or null if not found.
 */
function getHtmlFromPayload(payload: gmail_v1.Schema$MessagePart): string | null {
  if (payload.mimeType === 'text/html') {
    if (payload.body && payload.body.data) {
      // Decode Base64-encoded HTML
      return Buffer.from(payload.body.data, 'base64').toString('utf8');
    }
  }

  // Recursively search in parts for multipart emails
  if (payload.parts) {
    for (const part of payload.parts) {
      const html = getHtmlFromPayload(part);
      if (html) {
        return html;
      }
    }
  }

  return null;
}

/**
 * Finds a specific email by its unique message ID.
 * @param auth The authenticated Gmail client.
 * @param messageId The unique ID of the email to find.
 * @returns An array containing a single EmailHTMLData object, or an empty array if not found.
 */
async function getEmailHtmlById(
  auth: any, // The authenticated client type from @google-cloud/local-auth
  messageId: string
): Promise<EmailHTMLData[]> {
  const gmail = google.gmail({ version: 'v1', auth });
  
  try {
    const fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    
    const payload = fullMessage.data.payload;
    if (!payload) {
      console.log(`Email with ID "${messageId}" has no payload.`);
      return [];
    }

    let receivedTimestamp: number | null = null;
    if (payload.headers) {
      const dateHeader = payload.headers.find(header => header.name === 'Date');
      if (dateHeader && dateHeader.value) {
        receivedTimestamp = new Date(dateHeader.value).getTime();
      }
    }

    const html = getHtmlFromPayload(payload);
    
    if (html) {
      return [{ id: messageId, html, timestamp: receivedTimestamp }];
    } else {
      console.log(`Email with ID "${messageId}" does not contain HTML content.`);
      return [];
    }
  } catch (error) {
    console.error(`Error processing email with ID "${messageId}":`, error);
    return [];
  }
}

/**
 * Saves a string to a file.
 * @param html The string content to save.
 * @param filename The name of the file to save to.
 */
async function saveHTMLToFile(html: string, filename: string): Promise<void> {
  try {
    await fs.writeFile(filename, html);
    console.log(`HTML saved to ${filename}`);
  } catch (err) {
    console.error(`Error saving HTML to file: ${err}`);
  }
}

/**
 * Main function to run the email extraction and file saving process.
 */
async function run(): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error('Failed to load configuration. Exiting.');
    return;
  }

  const auth = await authenticate({
    scopes: config.auth.scopes,
    keyfilePath: config.auth.keyfilePath,
  });

  const messageId = config.email.messageId;

  const htmls = await getEmailHtmlById(auth, messageId);
  
  if (htmls.length > 0) {
    const emailData = htmls[0];
    const timestamp = emailData.timestamp || Date.now();
    const outputFilename = `email_${emailData.id}_${timestamp}.html`;
    await saveHTMLToFile(emailData.html, outputFilename);
  } else {
    console.log(`No email found with ID "${messageId}".`);
  }
}

if (require.main === module) {
  run().catch(console.error);
}
