import type { ReactNode } from "react";
import { AreaShell } from "../../_shell/area-shell";

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return (
    <AreaShell area="research">
      {children}
    </AreaShell>
  );
}
