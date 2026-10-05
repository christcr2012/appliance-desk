import fs from "node:fs";

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

const schemaPath = "prisma/schema.prisma";
let schema = fs.readFileSync(schemaPath, "utf8");

schema = replaceOnce(
  schema,
  '  isHighValue Boolean @default(false)\n',
  '  isHighValue Boolean @default(false)\n  // Batch E: policy version that produced the frozen score/reasons, plus the latest real human/message contact.\n  scoringPolicyVersion Int @default(1)\n  lastRealContactAt DateTime?\n',
  "Lead scoring/contact fields",
);

schema = replaceOnce(
  schema,
  '  autoRenewEnabled Boolean @default(false)\n',
  '  autoRenewEnabled Boolean @default(false)\n  // Batch E: durable automation pause state and versioned, owner-editable lead scoring policy.\n  pausedAutomations Json @default("[]")\n  leadScoringPolicy Json @default("{\\\"version\\\":1,\\\"termPoints\\\":{\\\"month-to-month\\\":0,\\\"6-month\\\":10,\\\"12-month\\\":20},\\\"additionalUnitPoints\\\":5,\\\"businessAccountPoints\\\":10,\\\"multiUnitPropertyManagerPoints\\\":25,\\\"highValueThreshold\\\":30}")\n',
  "BusinessSettings Batch E fields",
);

schema = replaceOnce(
  schema,
  '  deliveryBlocked   Boolean @default(false)\n',
  '  deliveryBlocked   Boolean @default(false)\n  confirmedAt          DateTime?\n  confirmTokenHash     String?\n  confirmExpiresAt     DateTime?\n',
  "LaunchSubscriber confirmation fields",
);

const batchEModels = `\n// ---------------------------------------------------------------------------\n// Batch E — durable automation and communications evidence\n// ---------------------------------------------------------------------------\n\nenum AutomationRunState {\n  RUNNING\n  SUCCEEDED\n  FAILED\n  UNKNOWN\n  SKIPPED\n}\n\nmodel AutomationRun {\n  id            String             @id @default(cuid())\n  ruleKey       String\n  runKey        String\n  state         AutomationRunState @default(RUNNING)\n  environment   String\n  startedAt     DateTime           @default(now())\n  finishedAt    DateTime?\n  budgetSeconds Int                @default(300)\n  counts        Json?\n  error         String?\n\n  @@unique([ruleKey, runKey])\n  @@index([ruleKey, startedAt])\n}\n\nenum MessageChannel {\n  EMAIL\n  SMS\n}\n\nenum MessagePurpose {\n  TRANSACTIONAL\n  MARKETING\n}\n\nenum MessageState {\n  PENDING\n  ACCEPTED\n  FAILED\n  UNKNOWN\n  NOT_SENT\n  DELIVERED\n  BOUNCED\n  COMPLAINED\n  SUPPRESSED\n}\n\nmodel MessageDelivery {\n  id                String         @id @default(cuid())\n  idempotencyKey    String         @unique\n  channel           MessageChannel\n  purpose           MessagePurpose\n  templateKey       String\n  recipientType     String\n  recipientId       String?\n  recipientAddress  String\n  subjectType       String?\n  subjectId         String?\n  state             MessageState   @default(PENDING)\n  providerMessageId String?        @unique\n  attempts          Int            @default(1)\n  lastError         String?\n  requestedAt       DateTime       @default(now())\n  acceptedAt        DateTime?\n  deliveredAt       DateTime?\n  updatedAt         DateTime       @updatedAt\n\n  @@index([recipientType, recipientId, requestedAt])\n  @@index([subjectType, subjectId])\n  @@index([state, requestedAt])\n}\n\nmodel ProviderEvent {\n  id          String   @id @default(cuid())\n  provider    String\n  eventId     String\n  type        String\n  receivedAt  DateTime @default(now())\n  processedAt DateTime?\n  summary     Json?\n\n  @@unique([provider, eventId])\n}\n\nmodel MarketingSuppression {\n  id        String         @id @default(cuid())\n  channel   MessageChannel\n  address   String\n  reason    String\n  source    String\n  createdAt DateTime       @default(now())\n\n  @@unique([channel, address])\n}\n`;

schema = replaceOnce(
  schema,
  '// Batch C P1-B: the next asset-number sequence per prefix. Numbers are never reused.\n',
  batchEModels + '\n// Batch C P1-B: the next asset-number sequence per prefix. Numbers are never reused.\n',
  "Batch E model insertion point",
);
fs.writeFileSync(schemaPath, schema);

const manifestPath = "src/domains/backup/manifest.ts";
let manifest = fs.readFileSync(manifestPath, "utf8");
manifest = replaceOnce(
  manifest,
  '  LaunchDelivery: "launchDelivery",\n  AssetNumberCounter: "assetNumberCounter",\n',
  '  LaunchDelivery: "launchDelivery",\n  AutomationRun: "automationRun",\n  MessageDelivery: "messageDelivery",\n  ProviderEvent: "providerEvent",\n  MarketingSuppression: "marketingSuppression",\n  AssetNumberCounter: "assetNumberCounter",\n',
  "backup Batch E models",
);
fs.writeFileSync(manifestPath, manifest);
