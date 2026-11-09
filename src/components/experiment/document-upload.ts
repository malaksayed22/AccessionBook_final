/** What the document pickers accept; the server checks the file's bytes again and is the authority. */
export const ACCEPTED_UPLOAD_TYPES = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.docx,.xlsx";

/** "1.4 MB", "820 KB": a size a person can read. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** What a procedure's controlled document may be: PDF or Word. */
export const ACCEPTED_SOP_TYPES =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
