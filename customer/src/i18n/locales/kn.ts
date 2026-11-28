import type { PushKey } from '@/push/strings';
import type { MessageKey } from '../en';
import data from './kn.json';

/**
 * kn: the app's words, translated from English (28 Nov). The words live in
 * kn.json; a key missing there shows in English.
 */
export const kn: Partial<Record<MessageKey, string>> = data.app;

export const knPush: Partial<Record<PushKey, string>> = data.push;
