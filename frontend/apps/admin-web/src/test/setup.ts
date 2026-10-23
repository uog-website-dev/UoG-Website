import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// React Testing Library only auto-registers cleanup when the test framework
// exposes a global `afterEach`; do it explicitly for vitest's module API.
afterEach(() => {
  cleanup();
});

/**
 * Minimal browser-API stubs so MUI components (Drawer/Modal/ScrollLock)
 * render under jsdom.
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: vi.fn(),
});
