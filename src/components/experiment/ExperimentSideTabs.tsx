"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";

export type SideTab = { id: string; label: string; count?: number; panel: ReactNode };

/**
 * The experiment's side sections (tasks, team, documents, related experiments, provenance,
 * receipts, activity) as tabs: one section shows at a time, so the page stays short. The panels are
 * rendered on the server and handed in; this only switches between them.
 */
export function ExperimentSideTabs({ label, tabs }: { label: string; tabs: SideTab[] }) {
  const [value, setValue] = useState(tabs[0]?.id ?? "");
  return (
    <Tabs
      value={value}
      onValueChange={setValue}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm [&_[role=tabpanel]>section]:rounded-none [&_[role=tabpanel]>section]:border-0 [&_[role=tabpanel]>section]:shadow-none"
    >
      <TabsList
        label={label}
        className="flex-wrap gap-1.5 overflow-visible border-b border-border p-3"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="mb-0 min-h-9 rounded-lg border border-border px-3 py-1.5 data-[state=active]:border-accent-soft-border data-[state=active]:bg-accent-soft data-[state=active]:text-accent-text"
          >
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
        <TabsContent key={tab.id} value={tab.id} className="mt-0 rounded-none">
          {tab.panel}
        </TabsContent>
      ))}
    </Tabs>
  );
}
