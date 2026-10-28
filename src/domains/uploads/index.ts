import { prisma } from "@/lib/prisma";

type UploadUser = { id: string; role?: string; archivedAt?: unknown };

/** Token paths are exact app namespaces, never client-selected arbitrary folders. */
export async function canUploadPhoto(
  user: UploadUser,
  pathname: string,
): Promise<boolean> {
  if (
    user.archivedAt ||
    !user.id ||
    pathname.length > 1024 ||
    /[%\\\x00-\x1f\x7f]/.test(pathname)
  )
    return false;
  const segments = pathname.split("/");
  const filename = segments.at(-1);
  if (!filename || filename === "." || filename === "..") return false;
  const manager = user.role === "OWNER" || user.role === "ADMIN";
  const operational = manager || user.role === "STAFF";
  if (segments.length === 2 && segments[0] === "appliance-types")
    return manager;
  if (segments.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(segments[1]!))
    return false;
  const id = segments[1]!;
  if (segments[0] === "bank-statements" && manager) {
    return (await prisma.cashAccount.findFirst({where:{id,active:true},select:{id:true}}))!==null;
  }
  if (segments[0] === "accounting-confirmations" && user.role === "OWNER") {
    return (await prisma.accountingDelivery.findUnique({where:{id},select:{id:true}}))!==null;
  }
  if (segments[0] === "jobs" && operational) {
    return (
      (await prisma.job.findUnique({ where: { id }, select: { id: true } })) !==
      null
    );
  }
  if (segments[0] === "appliances" && manager) {
    return (
      (await prisma.appliance.findFirst({
        where: { id, archivedAt: null },
        select: { id: true },
      })) !== null
    );
  }
  // Purchase receipts: the folder is the form's random draft key (new purchase) or an existing
  // purchase id (pages added later). Verified again against storage when the purchase is saved.
  if (segments[0] === "expenses" && operational) {
    const row = await prisma.expense.findUnique({ where: { id }, select: { submittedByUserId: true, status: true } });
    return !!row && row.status !== "VOID" && (manager || row.submittedByUserId === user.id);
  }
  if (segments[0] === "purchases") return manager && id.length >= 8 && id.length <= 100;
  if (segments[0] === "tax-filings" && user.role === "OWNER") {
    return (
      (await prisma.taxFilingPeriod.findFirst({
        where: { id, status: "OPEN" }, select: { id: true },
      })) !== null
    );
  }
  // VAULT-1: business-record files go only to an existing record's folder, and
  // only the owner uploads them (admins may read allowed records, never write).
  // ACCT-1: an accountant may upload to a record the owner shared with them —
  // and only that record (registerUploadedRecordFile re-checks the share).
  if (segments[0] === "records" && user.role === "OWNER") {
    return (
      (await prisma.businessPaperwork.findUnique({
        where: { id },
        select: { id: true },
      })) !== null
    );
  }
  if (segments[0] === "records" && user.role === "ACCOUNTANT") {
    return (
      (await prisma.businessPaperwork.findUnique({
        where: { id },
        select: { shareWithAccountant: true },
      }))?.shareWithAccountant === true
    );
  }
  if (segments[0] === "tax-exemptions" && user.role === "OWNER") {
    return (
      (await prisma.customer.findFirst({
        where: { id, archivedAt: null },
        select: { id: true },
      })) !== null
    );
  }
  if (segments[0] === "maintenance-requests") {
    if (manager) {
      return (
        (await prisma.customer.findFirst({
          where: { id, archivedAt: null },
          select: { id: true },
        })) !== null
      );
    }
    if ((user.role ?? "CUSTOMER") === "CUSTOMER") {
      return (
        (await prisma.customer.findFirst({
          where: { id, userId: user.id, archivedAt: null },
          select: { id: true },
        })) !== null
      );
    }
  }
  return false;
}