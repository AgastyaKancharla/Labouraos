import type { PushKey } from '@/push/strings';
import type { MessageKey } from '../en';
import data from './ta.json';

/**
 * ta: the app's words, translated from English (28 Nov). The words live in
 * ta.json; a key missing there shows in English.
 */
export const ta: Partial<Record<MessageKey, string>> = data.app;

export const taPush: Partial<Record<PushKey, string>> = data.push;
