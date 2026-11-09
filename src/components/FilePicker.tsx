"use client";

import { Trash2 } from "lucide-react";
import { Banner } from "@/components/ui/Banner";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/FormControls";
import { IconButton } from "@/components/ui/IconButton";
import { ACCEPTED_UPLOAD_TYPES, formatFileSize } from "@/components/experiment/document-upload";
import { MAX_UPLOAD_BYTES } from "@/lib/file-types";

/**
 * Several files chosen in a form and sent once the record exists. Picking the same file twice adds it
 * once; each file can be taken out again; one over the size limit is flagged (the server refuses it
 * anyway). The strings come from the caller, so the picker reads in whatever the form is about.
 */
export function FilePicker({
  files,
  onChange,
  label,
  hint,
  chosenLabel,
  removeLabel,
  tooLargeText,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label: string;
  hint: string;
  /** Names the list of chosen files for screen readers. */
  chosenLabel: string;
  removeLabel: (name: string) => string;
  tooLargeText: string;
}) {
  const add = (picked: FileList | null) => {
    if (!picked) return;
    const known = new Set(files.map((file) => `${file.name}:${file.size}`));
    onChange([...files, ...[...picked].filter((file) => !known.has(`${file.name}:${file.size}`))]);
  };

  return (
    <div className="space-y-3">
      <Field label={label} hint={hint}>
        {(control) => (
          <Input
            type="file"
            multiple
            accept={ACCEPTED_UPLOAD_TYPES}
            onChange={(event) => {
              add(event.target.files);
              // Picking the same file again must still fire a change.
              event.target.value = "";
            }}
            {...control}
          />
        )}
      </Field>
      {files.length > 0 ? (
        <ul aria-label={chosenLabel} className="divide-y divide-border text-sm">
          {files.map((file) => (
            <li
              key={`${file.name}:${file.size}`}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="min-w-0 wrap-break-word">
                {file.name}
                <span className="text-fg-secondary"> · {formatFileSize(file.size)}</span>
              </span>
              <IconButton
                label={removeLabel(file.name)}
                variant="ghost"
                onClick={() => onChange(files.filter((f) => f !== file))}
              >
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {files.some((file) => file.size > MAX_UPLOAD_BYTES) ? (
        <Banner tone="warning">{tooLargeText}</Banner>
      ) : null}
    </div>
  );
}
