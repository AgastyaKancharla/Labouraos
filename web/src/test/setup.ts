import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { sessionStore } from '../auth/session';

afterEach(() => {
  cleanup();
  sessionStore.clear('logout');
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});
