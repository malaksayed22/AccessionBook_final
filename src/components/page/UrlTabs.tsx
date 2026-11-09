"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";

/*
 * Usage (a server page hands in the panels as nodes):
 *   <UrlTabs label="Profile sections" initial="general" defaultId="general"
 *     tabs={[{ id: "general", label: "General" }, { id: "security", label: "Security" }]}
 *     panels={{ general: <General />, security: <Security /> }} />
 *
 * Switches between server-rendered panels without a round trip and keeps the choice in the URL
 * (`?tab=security`), so a link, a reload and `router.refresh()` after an action all land on the same
 * tab. The default tab leaves the URL clean.
 */
export type UrlTab = { id: string; label: string };

export function UrlTabs({
  label,
  initial,
  defaultId,
  tabs,
  panels,
  className,
}: {
  label: string;
  initial: string;
  defaultId: string;
  tabs: UrlTab[];
  panels: Record<string, ReactNode>;
  className?: string;
}) {
  const [value, setValue] = useState(initial);

  const select = (next: string) => {
    if (!tabs.some((tab) => tab.id === next)) return;
    setValue(next);
    const url = new URL(window.location.href);
    if (next === defaultId) url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <Tabs value={value} onValueChange={select} className={className}>
      <TabsList label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="pt-6">
          {panels[tab.id]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
