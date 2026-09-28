import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && prefersDark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    mockMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a moon (switch to dark) when currently light", async () => {
    const { ThemeToggle } = await import("@/components/theme-toggle");
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
  });

  it("clicking switches to dark: adds the class, saves it, and flips the icon", async () => {
    const { ThemeToggle } = await import("@/components/theme-toggle");
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(
      screen.getByRole("button", { name: /switch to light mode/i }),
    ).toBeInTheDocument();
  });

  it("starts dark when the device prefers dark and nothing's been chosen yet", async () => {
    mockMatchMedia(true);
    const { ThemeToggle } = await import("@/components/theme-toggle");
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: /switch to light mode/i }),
    ).toBeInTheDocument();
  });

  it("clicking twice returns to the original theme", async () => {
    const { ThemeToggle } = await import("@/components/theme-toggle");
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    fireEvent.click(screen.getByRole("button", { name: /switch to light mode/i }));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
