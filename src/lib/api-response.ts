import { NextResponse } from "next/server";

export function jsonAuthError(err: unknown) {
  const message = err instanceof Error ? err.message : "FORBIDDEN";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (message === "DESTROYED") {
    return NextResponse.json({ error: "Cannot modify a destroyed unit" }, { status: 409 });
  }
  if (message === "HOLD") {
    return NextResponse.json(
      {
        error:
          "This unit is on quality hold. Release the hold before transferring, deriving, changing stage, or destroying it.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ error: "Permission denied" }, { status: 403 });
}
