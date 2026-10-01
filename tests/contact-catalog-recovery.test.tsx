import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const m = vi.hoisted(() => ({
  catalog: vi.fn(),
  create: vi.fn(),
  limited: vi.fn(),
}));
vi.mock("@/domains/pricing", () => ({ getPublishedApplianceTypes: m.catalog }));
vi.mock("@/domains/leads", () => ({ createLead: m.create }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: m.limited }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
import { submitLead } from "@/app/(public)/contact/actions";
import { leadFormSchemaForCatalog } from "@/domains/leads/schema";
const input = {
  accountType: "individual",
  isPropertyManager: false,
  contactName: "Pat Customer",
  phone: "5551234567",
  email: "pat@example.test",
  applianceTypeIds: [],
  quantity: 1,
  desiredTerm: "month-to-month",
  consent: true,
  website: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.catalog.mockResolvedValue([]);
  m.create.mockResolvedValue({ id: "lead" });
  m.limited.mockReturnValue(false);
});
afterEach(cleanup);
it("saves a general enquiry when no types are published, preserving consent", async () => {
  expect(await submitLead(input)).toEqual({ status: "success" });
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({
      applianceTypeIds: [],
      consent: true,
      contactName: "Pat Customer",
    }),
  );
  expect(await submitLead({ ...input, consent: false })).toMatchObject({
    status: "error",
  });
  expect(m.create).toHaveBeenCalledTimes(1);
});
it("still requires appliance selection when catalog options exist and rejects stale/private IDs", async () => {
  m.catalog.mockResolvedValue([{ id: "published" }]);
  expect(await submitLead(input)).toMatchObject({ status: "error" });
  expect(
    await submitLead({ ...input, applianceTypeIds: ["private"] }),
  ).toMatchObject({ status: "error" });
  expect(m.create).not.toHaveBeenCalled();
  expect(
    await submitLead({ ...input, applianceTypeIds: ["published"] }),
  ).toEqual({ status: "success" });
});
it("preserves honeypot and rate-limit protections before catalog reads", async () => {
  expect(await submitLead({ ...input, website: "spam" })).toEqual({
    status: "success",
  });
  expect(m.catalog).not.toHaveBeenCalled();
  m.limited.mockReturnValue(true);
  expect(await submitLead(input)).toMatchObject({ status: "error" });
  expect(m.catalog).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
});
it("reports catalog failures without claiming a saved enquiry", async () => {
  m.catalog.mockRejectedValue(new Error("catalog unavailable"));
  expect(await submitLead(input)).toMatchObject({ status: "error" });
  expect(m.create).not.toHaveBeenCalled();
});
it("client and server catalog schemas agree on empty selection", () => {
  expect(leadFormSchemaForCatalog(false).safeParse(input).success).toBe(true);
  expect(leadFormSchemaForCatalog(true).safeParse(input).success).toBe(false);
});
// The rendered client uses its real resolver and the real mocked-DB action.
import { ContactForm } from "@/app/(public)/contact/contact-form";
it("submits the empty-catalog form through the real client resolver", async () => {
  render(<ContactForm applianceTypes={[]} />);
  expect(
    screen.getByText(/No appliance options are listed/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Your name/), {
    target: { value: "Pat Customer" },
  });
  fireEvent.change(screen.getByLabelText(/Phone number/), {
    target: { value: "5551234567" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree/ }));
  fireEvent.click(screen.getByRole("button", { name: "Request a quote" }));
  await waitFor(() => expect(m.create).toHaveBeenCalledTimes(1));
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({ applianceTypeIds: [] }),
  );
});
