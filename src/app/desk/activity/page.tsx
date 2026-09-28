import { getActivityPage, getActivityCount, describeAuditAction } from "@/domains/activity";
import { parsePage, paginationMeta, DEFAULT_PAGE_SIZE } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";

export const metadata = { title: "Activity" };

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: rawPage } = await searchParams;
  const totalCount = await getActivityCount();
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const entries = await getActivityPage(meta.skip, meta.pageSize);

  return (
    <div>
      <h1 className="text-xl font-semibold">Activity</h1>
      <p className="mt-1 text-sm text-gray-600">
        A record of who changed what, and when — pricing changes, settings
        updates, and lead status changes. {DEFAULT_PAGE_SIZE} per page.
      </p>

      {entries.length === 0 ? (
        <p className="mt-8 text-sm text-gray-600">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3 text-sm">
              <p className="text-gray-900">
                <span className="font-medium">
                  {entry.user?.name ?? entry.user?.email ?? "Unknown user"}
                </span>{" "}
                — {describeAuditAction(entry.action)}
                {entry.entityId ? (
                  <span className="text-gray-500">
                    {" "}
                    ({entry.entityType} {entry.entityId})
                  </span>
                ) : null}
              </p>
              <p className="text-gray-500">
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(p) => (p === 1 ? "/desk/activity" : `/desk/activity?page=${p}`)}
      />
    </div>
  );
}
