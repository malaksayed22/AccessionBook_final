/**
 * Prisma's `contains` passes the text to LIKE, where `%` and `_` are wildcards. Escape them so a
 * member who types "50%" or "A_1" searches for exactly that. Use for every free-text list search.
 */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}
