import { redirect } from "next/navigation";

/** Retired stub route. Course and roster management live in /admin; policy is set per assignment. */
export default function RetiredPage(): never {
  redirect("/faculty");
}
