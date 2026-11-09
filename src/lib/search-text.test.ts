import { describe, expect, it } from "vitest";
import { likeEscape } from "./search-text";

describe("likeEscape", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(likeEscape("50%")).toBe("50\\%");
    expect(likeEscape("A_1")).toBe("A\\_1");
    expect(likeEscape("back\\slash")).toBe("back\\\\slash");
    expect(likeEscape("plain text")).toBe("plain text");
  });
});
