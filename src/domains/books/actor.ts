import type { Prisma } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";

/** Only scheduled books code uses automatic; equipment may use its already-authorized command. */
export type BooksWriter =
  | { kind: "person"; userId: string }
  | { kind: "automatic" }
  | { kind: "equipment"; userId: string };

export async function assertBooksWriter(
  tx: Prisma.TransactionClient,
  writer: BooksWriter,
  roles: Array<"OWNER" | "ADMIN"> = ["OWNER"],
) {
  if (writer.kind === "automatic") return;
  if (writer.kind === "equipment")
    return assertActiveTeamActor(tx, writer.userId, ["OWNER", "ADMIN"]);
  return assertActiveTeamActor(tx, writer.userId, roles);
}

export function booksAuditActor(writer: BooksWriter) {
  return {
    userId: writer.kind === "automatic" ? null : writer.userId,
    by: writer.kind === "automatic" ? "automatic" : "person",
  };
}
