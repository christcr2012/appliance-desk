import { ListSkeleton } from "@/components/kit";

// This is the final fallback for any desk route without a more-specific loading file.
// The signed-in navigation stays mounted while the page streams in.
export default function DeskLoading() {
  return <ListSkeleton label="Loading desk…" />;
}
