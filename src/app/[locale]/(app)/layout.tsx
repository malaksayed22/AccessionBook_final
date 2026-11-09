import { AppShell } from "@/components/shell/AppShell";
import { sopsEnabled } from "@/features/sop/enabled";
import { requirePageUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <AppShell
      user={{ name: user.name, permissions: user.permissions }}
      hiddenTabs={sopsEnabled() ? [] : ["sops"]}
    >
      {children}
    </AppShell>
  );
}
