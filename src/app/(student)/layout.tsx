import type { ReactNode } from "react";
import { AreaShell } from "../_shell/area-shell";

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <AreaShell area="student">
      {children}
    </AreaShell>
  );
}
