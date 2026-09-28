import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// Chris asked (2026-09-27) for auto-logout after inactivity, since the
// owner desk and customer portal previously had no idle timeout at all
// (just a 14-day session). This exercises the real timing/warning/reset
// behavior, not just "it renders."

const signOutMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth-client", () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

describe("IdleLogout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    signOutMock.mockClear();
    pushMock.mockClear();
    refreshMock.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows no warning while comfortably within the timeout", async () => {
    const { IdleLogout } = await import("@/components/idle-logout");
    render(<IdleLogout timeoutMinutes={20} />);

    // Halfway through a 20-minute timeout — no warning, no sign-out.
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(screen.queryByText(/signed out soon/i)).not.toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("shows a warning banner in the last minute before signing out", async () => {
    const { IdleLogout } = await import("@/components/idle-logout");
    render(<IdleLogout timeoutMinutes={20} />);

    // 19 minutes 30 seconds in — 30 seconds left, inside the 1-minute
    // warning window.
    await act(async () => {
      vi.advanceTimersByTime(19 * 60_000 + 30_000);
    });

    expect(screen.getByText(/signed out soon/i)).toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("signs out and redirects to /login?reason=timeout once the timeout elapses", async () => {
    const { IdleLogout } = await import("@/components/idle-logout");
    render(<IdleLogout timeoutMinutes={20} />);

    await act(async () => {
      vi.advanceTimersByTime(20 * 60_000 + 1_000);
    });

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/login?reason=timeout");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("resets the clock on activity, so it never signs out", async () => {
    const { IdleLogout } = await import("@/components/idle-logout");
    render(<IdleLogout timeoutMinutes={20} />);

    // Simulate the person still using the page every 5 minutes.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000);
        fireEvent.keyDown(window, { key: "a" });
      });
    }

    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('"Stay signed in" clears the warning and resets the clock', async () => {
    const { IdleLogout } = await import("@/components/idle-logout");
    render(<IdleLogout timeoutMinutes={20} />);

    await act(async () => {
      vi.advanceTimersByTime(19 * 60_000 + 30_000);
    });
    expect(screen.getByText(/signed out soon/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /stay signed in/i }));
    });
    expect(screen.queryByText(/signed out soon/i)).not.toBeInTheDocument();

    // Well under a full fresh 20 minutes should now be safe.
    await act(async () => {
      vi.advanceTimersByTime(18 * 60_000);
    });
    expect(signOutMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/signed out soon/i)).not.toBeInTheDocument();
  });
});
