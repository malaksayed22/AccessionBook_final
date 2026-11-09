/** Up to two capital letters for an avatar: first and last word of the name, or the first letter. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [name.trim()[0] ?? "?"];
  return letters.join("").toUpperCase();
}
