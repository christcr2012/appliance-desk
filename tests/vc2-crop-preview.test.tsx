import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ImageCropPreview } from "@/components/desk/image-crop-preview";

describe("V-C2 crop preview", () => {
  it("shows every shape, uses the focal point and respects decorative", () => {
    const { container } = render(<ImageCropPreview src="/p.webp" alt="A washer" focalX={20} focalY={80} />);
    expect(screen.getByText("Wide banner")).toBeTruthy();
    expect(screen.getByText("Square card")).toBeTruthy();
    expect(screen.getByText("Phone, tall")).toBeTruthy();
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("A washer");
    expect(img.style.objectPosition).toBe("20% 80%");
    cleanup();
    const deco = render(<ImageCropPreview src="/p.webp" alt="A washer" decorative />);
    expect(deco.container.querySelector("img")!.getAttribute("alt")).toBe("");
    expect(screen.getByText(/screen readers skip it/)).toBeTruthy();
  });
});
