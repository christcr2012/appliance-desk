import { RecordSkeleton } from "@/components/kit";

// AR-11: keep the shared desk layout responsive while this area streams in.
export default function PrivacyLoading() {
  return <RecordSkeleton label="Loading privacy…" />;
}
