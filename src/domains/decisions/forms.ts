import { prisma } from "@/lib/prisma";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { listDecisions, type DecisionCard } from "./index";
import { BUSINESS_FACTS, type Audience } from "./registry";
import {
  buildQuestionnaire,
  formFilename,
  formTitle,
  type FormBlock,
  type FormBusiness,
  type FormQuestion,
} from "./form-content";
import { questionnaireDocx, questionnairePdf } from "./form-files";

/**
 * The downloadable questionnaire for one professional (spec section 7): every question with them, or usually
 * theirs, that isn't answered yet. Reading it is allowed for the owner and admins (listDecisions checks the role).
 */
export function formQuestion(card: DecisionCard): FormQuestion {
  return {
    id: card.id,
    title: card.title,
    question: card.question,
    facts: card.facts,
    doingNow: card.current.words,
    why: card.recommended?.why ?? null,
    sources: card.recommended?.sources ?? [],
    options: card.options.map((option) => option.label),
    allowOther: card.allowOther,
  };
}

async function businessFacts(): Promise<FormBusiness> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" }, select: { publicBusinessName: true, booksStartDate: true },
  });
  const name = settings?.publicBusinessName && !settings.publicBusinessName.startsWith("[")
    ? settings.publicBusinessName : "Robinson Appliance Rentals";
  return {
    name,
    place: "Greeley (Weld County), Colorado, USA",
    whatItDoes: BUSINESS_FACTS.replace(/^Robinson Appliance Rentals is /, "").replace(/^a /, "A "),
    startedOn: settings?.booksStartDate ? formatBusinessDate(settings.booksStartDate) : "Not set in the app yet",
  };
}

export type Questionnaire = { blocks: FormBlock[]; title: string; dateKey: string; count: number };

export async function questionnaireFor(actorId: string, audience: Audience, now = new Date()): Promise<Questionnaire> {
  const cards = (await listDecisions(actorId, { audience })).filter((card) => card.state !== "CONFIRMED");
  const dateText = formatBusinessDate(now);
  const blocks = buildQuestionnaire({ audience, dateText, business: await businessFacts(), questions: cards.map(formQuestion) });
  return { blocks, title: formTitle(audience, dateText), dateKey: businessDateKey(now), count: cards.length };
}

export async function questionnaireFile(
  actorId: string, audience: Audience, format: "docx" | "pdf", now = new Date(),
): Promise<{ bytes: Uint8Array; filename: string; contentType: string; count: number }> {
  const form = await questionnaireFor(actorId, audience, now);
  const bytes = format === "docx"
    ? new Uint8Array(await questionnaireDocx(form.blocks, form.title))
    : await questionnairePdf(form.blocks, form.title);
  return {
    bytes,
    filename: formFilename(audience, form.dateKey, format),
    contentType: format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
    count: form.count,
  };
}
