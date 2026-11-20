import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy*/waitFor wait up to 1 s by default. With every file running in parallel the first render
// of a heavy screen (settings, debts) sometimes took longer on the dev machine (B5 item 12); the
// query still fails if the element never appears.
configure({ asyncUtilTimeout: 4_000 });

afterEach(() => {
  cleanup();
});

// jsdom has no layout: give the browser APIs that cmdk, Radix and the tooth chart call a no-op
// stand-in (tests check behaviour and accessibility, not sizes).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
