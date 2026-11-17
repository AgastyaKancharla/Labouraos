import { INestApplication } from '@nestjs/common';
import { LegalDocumentService } from '../modules/legal/legal-document.service';

/**
 * The hash of the Job Seeker Terms text a page would show in this language (GET /legal/documents
 * → hash). The consent step requires it (the server refuses a text that changed while it was read).
 */
export async function jobSeekerTermsHash(app: INestApplication, language: 'en' = 'en'): Promise<string> {
  return (await app.get(LegalDocumentService).render('job_seeker_terms', language)).hash;
}
