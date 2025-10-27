// src/utils/service-factory.ts
import { IEmailPreviewService } from '../interfaces/i-email-preview-service';
import { EmailOnAcidService } from '../services/email-on-acid-service';
//import { LitmusService } from '../services/litmus-service';

export function getEmailPreviewService(
  serviceName: string,
  apiKey: string,
  accountPassword?: string
): IEmailPreviewService {
  switch (serviceName.toLowerCase()) {
    case 'emailonacid':
      if (!accountPassword) {
        throw new Error('EmailOnAcidService requires an API key and an account password.');
      }
      return new EmailOnAcidService(apiKey, accountPassword);
    case 'litmus':
      //return new LitmusService(apiKey);
    default:
      throw new Error(`Unsupported email preview service: ${serviceName}`);
  }
}