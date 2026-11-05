import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redirectToSignIn = vi.fn();
vi.mock("@/session-expiry", () => ({ redirectToSignIn: () => redirectToSignIn() }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  redirectToSignIn.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("session watch", () => {
  it("starts a new sign-in only when the session check answers 401", async () => {
    const { signInAgainIfExpired } = await import("@/session-watch");
    fetchMock.mockResolvedValueOnce({ status: 200 });
    await expect(signInAgainIfExpired()).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(signInAgainIfExpired()).resolves.toBe(false);
    expect(redirectToSignIn).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({ status: 401 });
    await expect(signInAgainIfExpired()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith("/admin/api/session", { cache: "no-store" });
    expect(redirectToSignIn).toHaveBeenCalledTimes(1);
  });

  it("checks when the tab regains focus and on the interval", async () => {
    vi.useFakeTimers();
    const { useSessionWatch, SESSION_CHECK_INTERVAL_MS } = await import("@/session-watch");
    fetchMock.mockResolvedValue({ status: 200 });
    const view = renderHook(() => useSessionWatch());
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue({ status: 401 });
    await vi.advanceTimersByTimeAsync(SESSION_CHECK_INTERVAL_MS);
    expect(redirectToSignIn).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
