/**
 * "Explain Laboura — read this to them" is the business agreement's "In short"
 * from the server (GET /legal/documents/business_agreement), in the owner's
 * language, every number filled from Settings. Only the language labels live here.
 */
export type ScriptLanguage = 'kn' | 'hi' | 'en';

export const SCRIPT_LANGUAGE_LABELS: Record<ScriptLanguage, string> = { kn: 'ಕನ್ನಡ', hi: 'हिंदी', en: 'English' };
