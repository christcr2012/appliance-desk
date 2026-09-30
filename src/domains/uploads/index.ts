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
  if (
    segments[0] === "maintenance-requests" &&
    (user.role ?? "CUSTOMER") === "CUSTOMER"
  ) {
    return (
      (await prisma.customer.findFirst({
        where: { id, userId: user.id, archivedAt: null },
        select: { id: true },
      })) !== null
    );
  }
  return false;
}
