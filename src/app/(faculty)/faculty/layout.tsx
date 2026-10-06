import type { ReactNode } from "react";
import { AreaShell } from "../../_shell/area-shell";

export default function FacultyLayout({ children }: { children: ReactNode }) {
  return (
    <AreaShell area="faculty">
      {children}
    </AreaShell>
  );
}
