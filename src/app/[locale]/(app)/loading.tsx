import { PageSkeleton } from "@/components/ui/PageSkeleton";

/** Shown inside the app shell while a page's data loads; hubs add their own so their tabs stay put. */
export default function Loading() {
  return <PageSkeleton variant="table" />;
}
