import type { ReactNode } from "react";
import { AreaShell } from "../../_shell/area-shell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AreaShell area="admin">
      {children}
    </AreaShell>
  );
}
