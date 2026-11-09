"use client";

import { Ellipsis, Menu as MenuIcon, PauseCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Sheet,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  useToast,
} from "@/components/ui";

/** Developer-only gallery: the interactive primitives (everything that needs client state). */
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function Showcase() {
  const { toast } = useToast();
  const [voidOpen, setVoidOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [simpleOpen, setSimpleOpen] = useState(false);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="g-tabs" className="flex flex-col gap-3">
        <h2 id="g-tabs" className="text-lg font-semibold">
          Tabs
        </h2>
        <Tabs defaultValue="overview">
          <TabsList label="Unit sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="documents">Documents and certificates of analysis</TabsTrigger>
            <TabsTrigger value="locked" disabled>
              Locked
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">Overview panel. Arrow keys move between tabs.</TabsContent>
          <TabsContent value="history">History panel with the custody timeline.</TabsContent>
          <TabsContent value="documents">Documents panel.</TabsContent>
        </Tabs>
      </section>

      <section aria-labelledby="g-dialogs" className="flex flex-col gap-3">
        <h2 id="g-dialogs" className="text-lg font-semibold">
          Dialogs, sheets and menus
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Dialog
            trigger={<Button>Open dialog</Button>}
            title="Example dialog"
            description="Focus is trapped here. Press Escape to close; focus returns to the button."
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="primary">Save changes</Button>
                </DialogClose>
              </>
            }
          >
            <Field label="Location name" hint="Shown on labels">
              {(control) => <Input defaultValue="Room 4, shelf B" {...control} />}
            </Field>
          </Dialog>

          <Button variant="danger" icon={<Trash2 />} onClick={() => setVoidOpen(true)}>
            Void record…
          </Button>
          <ConfirmDialog
            open={voidOpen}
            onOpenChange={setVoidOpen}
            title="Void unit U-0042?"
            description="Voiding writes a permanent record with your name and reason. It cannot be undone."
            confirmLabel="Void unit"
            requireReason
            reasonMinLength={10}
            typeToConfirm="VOID"
            onConfirm={async ({ reason }) => {
              await wait(600);
              toast({ tone: "success", title: "Unit voided", description: reason });
            }}
          />

          <Button variant="secondary" icon={<PauseCircle />} onClick={() => setFailOpen(true)}>
            Release hold (fails)
          </Button>
          <ConfirmDialog
            open={failOpen}
            onOpenChange={setFailOpen}
            title="Release hold?"
            description="This demonstrates the error display: the request always fails."
            confirmLabel="Release hold"
            tone="primary"
            onConfirm={async () => {
              await wait(400);
              throw new Error("demo failure");
            }}
          />

          <Button variant="secondary" onClick={() => setSimpleOpen(true)}>
            Simple confirmation
          </Button>
          <ConfirmDialog
            open={simpleOpen}
            onOpenChange={setSimpleOpen}
            title="Archive experiment?"
            description="You can restore it later from the archive."
            confirmLabel="Archive"
            tone="primary"
            onConfirm={() => {
              toast({ tone: "info", title: "Archived" });
            }}
          />

          <Sheet
            side="left"
            trigger={<Button variant="secondary">Open left sheet</Button>}
            title="Navigation"
            description="The mobile drawer pattern."
          >
            <nav aria-label="Demo navigation">
              <ul className="flex flex-col gap-1 text-sm">
                <li>Dashboard</li>
                <li>Units</li>
                <li>Experiments</li>
              </ul>
            </nav>
          </Sheet>
          <Sheet
            side="right"
            trigger={
              <IconButton label="Open details sheet" variant="secondary">
                <MenuIcon />
              </IconButton>
            }
            title="Details"
          >
            Right-hand sheet content.
          </Sheet>

          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Row actions" variant="secondary">
                <Ellipsis />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Unit U-0042</MenuLabel>
              <MenuItem onSelect={() => toast({ title: "Hold requested" })}>Place on hold</MenuItem>
              <MenuItem onSelect={() => toast({ title: "Label queued" })}>Print label</MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={() => setVoidOpen(true)}>
                Void record…
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </section>

      <section aria-labelledby="g-toast" className="flex flex-col gap-3">
        <h2 id="g-toast" className="text-lg font-semibold">
          Toast and dismissible banner
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() =>
              toast({ tone: "success", title: "Saved", description: "Your changes were recorded." })
            }
          >
            Show success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                tone: "danger",
                title: "Could not save",
                description: "The server refused the change. Nothing was modified.",
              })
            }
          >
            Show error toast
          </Button>
        </div>
        <Banner tone="info" title="Dismissible banner" dismissible>
          Click the close button to remove this banner.
        </Banner>
      </section>

      <Toaster />
    </div>
  );
}
