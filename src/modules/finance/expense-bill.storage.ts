import {
  AgreementDocumentStorage,
  SupabaseAgreementDocumentStorage,
  sharedMemoryAgreementDocumentStorage,
} from '../consent/agreement-document.storage';

/**
 * Bills and receipts attached to expenses. They are documents kept with the
 * books, so they use the same private document store as signed agreements
 * (Supabase Storage when AGREEMENT_STORAGE_MODE is "supabase", which production
 * requires), under their own `expense-bills/` folder.
 */
export const EXPENSE_BILL_STORAGE = 'EXPENSE_BILL_STORAGE';
export type ExpenseBillStorage = AgreementDocumentStorage;

export const BILL_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
export const MAX_BILL_BYTES = 10 * 1024 * 1024;

export function expenseBillStorageFactory(): ExpenseBillStorage {
  return process.env.AGREEMENT_STORAGE_MODE === 'supabase'
    ? new SupabaseAgreementDocumentStorage()
    : sharedMemoryAgreementDocumentStorage;
}
