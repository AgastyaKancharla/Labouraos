import type { PushKey } from '@/push/strings';
import type { MessageKey } from '../en';
import data from './hi.json';

/**
 * hi: the app's words, translated from English (28 Nov). The words live in
 * hi.json; a key missing there shows in English.
 */
export const hi: Partial<Record<MessageKey, string>> = data.app;

export const hiPush: Partial<Record<PushKey, string>> = data.push;
