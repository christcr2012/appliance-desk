// Runs against CI's throwaway Postgres. Only the external email service is mocked.
import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "@/lib/prisma";
import {
  confirmLaunchSubscription,
  joinLaunchList,
  sendLaunchSequence,
  unsubscribeLaunch,
} from "@/domains/launch";
import { launchSignupSchema } from "@/domains/launch/schema";

const { send } = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ sent: true, outcome: "SENT" }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: send }));
const run = randomBytes(6).toString("hex");
const address = `launch-${run}@example.test`;
let originalSettings: Awaited<
  ReturnType<typeof prisma.launchSettings.findUnique>
>;
let confirmationToken = "";
const confirmationConsentIds: string[] = [];
const input = launchSignupSchema.parse({
  name: "Launch Test",
  email: address,
  city: "Greeley",
  interest: "Washer and dryer",
  source: "instagram",
  consent: true,
});

function tokenFromLatestEmail(): string {
  const latest = send.mock.calls.at(-1)?.[0] as { text?: string } | undefined;
  const match = latest?.text?.match(/\/launch\/confirm\/([a-f0-9]{64})/i);
  if (!match?.[1]) throw new Error("Confirmation email did not contain a token");
  return match[1];
}

beforeEach(() => {
  send.mockClear();
  send.mockResolvedValue({ sent: true, outcome: "SENT" });
});

beforeAll(async () => {
  originalSettings = await prisma.launchSettings.findUnique({
    where: { id: "singleton" },
  });
  await prisma.launchSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  await prisma.launchSettings.update({
    where: { id: "singleton" },
    data: {
      prelaunchMode: true,
      emailEnabled: true,
      postalAddress: "123 Test St, Greeley CO 80631",
      replyToEmail: "test@example.test",
    },
  });
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "test-never-sent");
  vi.stubEnv("RESEND_FROM_EMAIL", "test@example.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://robinsonappliancerentals.com");
});
afterAll(async () => {
  if (confirmationConsentIds.length) {
    await prisma.consentRecord.deleteMany({ where: { id: { in: confirmationConsentIds } } });
  }
  await prisma.launchDelivery.deleteMany({
    where: { subscriber: { email: { endsWith: `${run}@example.test` } } },
  });
  await prisma.launchSubscriber.deleteMany({
    where: { email: { endsWith: `${run}@example.test` } },
  });
  if (originalSettings)
    await prisma.launchSettings.update({
      where: { id: "singleton" },
      data: originalSettings,
    });
  else
    await prisma.launchSettings.update({
      where: { id: "singleton" },
      data: {
        prelaunchMode: true,
        emailEnabled: false,
        postalAddress: "",
        replyToEmail: "",
      },
    });
  vi.unstubAllEnvs();
});

describe("durable launch sequence", () => {
  it("deduplicates concurrent signups, records consent and sends one confirmation request", async () => {
    await Promise.all([
      joinLaunchList(input),
      joinLaunchList({ ...input, email: address.toUpperCase() }),
    ]);
    const rows = await prisma.launchSubscriber.findMany({
      where: { email: address },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("instagram");
    expect(rows[0].consentText).toContain("unsubscribe");
    expect(rows[0].unsubscribeToken).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].confirmedAt).toBeNull();
    expect(rows[0].confirmTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].confirmExpiresAt).toBeInstanceOf(Date);
    const confirmationLifetimeMs =
      rows[0].confirmExpiresAt!.getTime() - rows[0].createdAt.getTime();
    expect(confirmationLifetimeMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(confirmationLifetimeMs).toBeLessThanOrEqual(7.1 * 24 * 60 * 60 * 1000);
    expect(send).toHaveBeenCalledTimes(1);
    confirmationToken = tokenFromLatestEmail();
  });

  it("never starts marketing for an unconfirmed address", async () => {
    send.mockClear();
    expect(await sendLaunchSequence()).toMatchObject({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.launchDelivery.count({
      where: { subscriber: { email: address } },
    })).toBe(0);
  });

  it("confirmation is single-use under concurrency and unlocks exactly one welcome", async () => {
    const results = await Promise.all([
      confirmLaunchSubscription(confirmationToken),
      confirmLaunchSubscription(confirmationToken),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await confirmLaunchSubscription(confirmationToken)).toBe(false);

    const confirmed = await prisma.launchSubscriber.findUniqueOrThrow({ where: { email: address } });
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    expect(confirmed.confirmTokenHash).toBeNull();
    expect(confirmed.confirmExpiresAt).toBeNull();
    const confirmations = await prisma.consentRecord.findMany({
      where: { kind: "launch_email_confirm" },
      select: { id: true, details: true },
    });
    const matching = confirmations.filter(
      (record) =>
        (record.details as { subscriberId?: string } | null)?.subscriberId === confirmed.id,
    );
    expect(matching).toHaveLength(1);
    confirmationConsentIds.push(matching[0]!.id);

    send.mockClear();
    await Promise.all([sendLaunchSequence(), sendLaunchSequence()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].marketing.unsubscribeUrl).toContain(
      "/launch/unsubscribe?token=",
    );
    const row = await prisma.launchSubscriber.findUniqueOrThrow({
      where: { email: address },
      include: { deliveries: true },
    });
    expect(row.nextStep).toBe(1);
    expect(row.nextSendAt.getTime()).toBeGreaterThan(
      Date.now() + 2.9 * 86400000,
    );
    expect(row.deliveries.map((d) => d.status)).toEqual(["SENT"]);
    await sendLaunchSequence();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a provider failure stops this sequence, and another cron does not retry it", async () => {
    await prisma.launchSubscriber.update({
      where: { email: address },
      data: { nextSendAt: new Date(0) },
    });
    send.mockResolvedValueOnce({ sent: false, outcome: "REJECTED" });
    await sendLaunchSequence();
    await sendLaunchSequence();
    expect(send).toHaveBeenCalledTimes(1);
    const row = await prisma.launchSubscriber.findUniqueOrThrow({
      where: { email: address },
    });
    expect(row.deliveryBlocked).toBe(true);
    expect(row.nextStep).toBe(1);
  });

  it("unsubscribe is immediate and repeat signup cannot undo suppression", async () => {
    const row = await prisma.launchSubscriber.findUniqueOrThrow({
      where: { email: address },
    });
    expect(await unsubscribeLaunch(row.unsubscribeToken)).toBe(true);
    expect(await unsubscribeLaunch(row.unsubscribeToken)).toBe(true);
    expect(await unsubscribeLaunch("bad-token")).toBe(false);
    send.mockClear();
    await joinLaunchList(input);
    await sendLaunchSequence();
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await prisma.launchSubscriber.findUniqueOrThrow({
          where: { email: address },
        })
      ).unsubscribedAt,
    ).not.toBeNull();
  });

  it("honeypot submissions and disabled prelaunch do not create subscribers", async () => {
    await joinLaunchList({
      ...input,
      email: `bot-${run}@example.test`,
      website: "spam",
    });
    expect(
      await prisma.launchSubscriber.count({
        where: { email: `bot-${run}@example.test` },
      }),
    ).toBe(0);
    await prisma.launchSettings.update({
      where: { id: "singleton" },
      data: { prelaunchMode: false },
    });
    await expect(
      joinLaunchList({ ...input, email: `closed-${run}@example.test` }),
    ).rejects.toThrow("closed");
  });

  it("finishes all three steps and never schedules a fourth email", async () => {
    await prisma.launchSettings.update({
      where: { id: "singleton" },
      data: { prelaunchMode: true },
    });
    const email = `complete-${run}@example.test`;
    send.mockClear();
    await joinLaunchList({ ...input, email });
    const token = tokenFromLatestEmail();
    expect(await confirmLaunchSubscription(token)).toBe(true);
    send.mockClear();

    for (let step = 0; step < 3; step++) {
      await prisma.launchSubscriber.update({
        where: { email },
        data: { nextSendAt: new Date(0) },
      });
      await sendLaunchSequence();
    }
    await sendLaunchSequence();
    const row = await prisma.launchSubscriber.findUniqueOrThrow({
      where: { email },
      include: { deliveries: true },
    });
    expect(row.nextStep).toBe(3);
    expect(row.deliveries).toHaveLength(3);
    expect(row.deliveries.every((d) => d.status === "SENT")).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
