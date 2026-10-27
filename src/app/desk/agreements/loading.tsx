import { ListSkeleton } from "@/components/kit";

// AR-11: keep the shared desk layout responsive while this area streams in.
export default function AgreementsLoading() {
  return <ListSkeleton label="Loading agreements…" />;
}
