import type { PushKey } from '@/push/strings';
import type { MessageKey } from '../en';
import data from './ml.json';

/**
 * ml: the app's words, translated from English (28 Nov). The words live in
 * ml.json; a key missing there shows in English.
 */
export const ml: Partial<Record<MessageKey, string>> = data.app;

export const mlPush: Partial<Record<PushKey, string>> = data.push;
