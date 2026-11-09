"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";

export type UnitTabId = "overview" | "history" | "lineage" | "quality" | "documents";

type TabDefinition = { id: UnitTabId; label: string; count?: number };

/**
 * The page's tabs. The panels are rendered on the server and handed in as nodes; this only switches
 * between them. The chosen tab lives in the URL (`?tab=history`) so a link, a reload and the
 * refresh after an action all land on the same tab, without asking the server for the page again.
 */
export function UnitTabs({
  label,
  initial,
  tabs,
  panels,
}: {
  label: string;
  initial: UnitTabId;
  tabs: TabDefinition[];
  panels: Record<UnitTabId, ReactNode>;
}) {
  const [value, setValue] = useState<UnitTabId>(initial);

  const select = (next: string) => {
    const id = tabs.find((tab) => tab.id === next)?.id;
    if (!id) return;
    setValue(id);
    const url = new URL(window.location.href);
    if (id === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <Tabs value={value} onValueChange={select}>
      <TabsList label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
            {tab.count !== undefined ? (
              <span className="rounded-full bg-sunken px-2 text-xs text-fg-secondary tabular-nums">
                {tab.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          {panels[tab.id]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
