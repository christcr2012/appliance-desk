import { ListSkeleton } from "@/components/kit";

// Help is a desk area too: never show a blank screen while its guides load.
export default function HelpLoading() {
  return <ListSkeleton label="Loading help…"/>;
}
