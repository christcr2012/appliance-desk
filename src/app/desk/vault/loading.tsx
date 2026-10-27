import { ListSkeleton } from "@/components/kit";

// AR-11: keep the shared desk layout responsive while this area streams in.
export default function VaultLoading() {
  return <ListSkeleton label="Loading logins vault…" />;
}
