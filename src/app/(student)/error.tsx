"use client";

import { Button, ErrorState } from "@/components/ui";

export default function StudentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="This page couldn't load."
      action={
        <Button size="sm" onClick={() => reset()}>
          Reload page
        </Button>
      }
    >
      The server returned an error while reading your course data. Work you saved in an assignment is
      not affected. Try again, and tell your TA if it keeps happening.
    </ErrorState>
  );
}
