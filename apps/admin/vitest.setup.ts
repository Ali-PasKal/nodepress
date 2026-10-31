import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Some test files opt into the Node environment (`// @vitest-environment node`); only touch the DOM
// when one exists.
const hasDom = typeof window !== 'undefined';

afterEach(() => {
  vi.unstubAllGlobals();
  if (hasDom) {
    cleanup();
    window.localStorage.clear();
    document.documentElement.className = '';
  }
});

// jsdom does not implement matchMedia.
if (hasDom && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}
