import { LoadingState } from "@/components/ui";

export default function StudentLoading() {
  return (
    <div className="space-y-6">
      <div aria-hidden="true" className="h-6 w-48 rounded-sm bg-surface-2" />
      <LoadingState label="Loading page" lines={5} />
    </div>
  );
}
