import type { PushKey } from '@/push/strings';
import type { MessageKey } from '../en';
import data from './te.json';

/**
 * te: the app's words, translated from English (28 Nov). The words live in
 * te.json; a key missing there shows in English.
 */
export const te: Partial<Record<MessageKey, string>> = data.app;

export const tePush: Partial<Record<PushKey, string>> = data.push;
