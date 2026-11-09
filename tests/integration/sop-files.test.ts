import { beforeEach, describe, expect, it } from "vitest";
import { attachSopFile, readSopFile } from "@/features/sop/files";
import { getSop } from "@/features/sop/queries";
import { createSop, updateSop } from "@/features/sop/service";
import { AppError } from "@/server/errors";
import { createLab, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("procedure documents", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("attaches a PDF to the draft, freezes it on approval, and serves it to every member", async () => {
    const sop = await createSop(lab.admin, {
      code: "SOP-010",
      title: "Harvest",
      body: "Summary: cut, hang and dry. The steps are in the document.",
    });
    expect(
      (await failure(attachSopFile(lab.member, sop.id, { fileName: "sop.pdf", bytes: PDF }))).code
    ).toBe("FORBIDDEN");
    expect(
      (await failure(attachSopFile(lab.admin, sop.id, { fileName: "scan.png", bytes: PNG })))
        .details
    ).toMatchObject({ reason: "sopFileType" });

    await attachSopFile(lab.admin, sop.id, { fileName: "SOP-010 Harvest.pdf", bytes: PDF });
    await updateSop(lab.admin, sop.id, { action: "approve" });

    // A version in effect never changes: a new document needs a new version.
    expect(
      (await failure(attachSopFile(lab.admin, sop.id, { fileName: "v2.pdf", bytes: PDF }))).details
    ).toMatchObject({ reason: "sopNoDraft" });

    const detail = (await getSop(lab.member, sop.id))!;
    expect(detail.effective).toMatchObject({
      fileName: "SOP-010 Harvest.pdf",
      fileSize: PDF.length,
    });
    const file = await readSopFile(sop.id, 1);
    expect(file.mime).toBe("application/pdf");
    expect(Buffer.from(file.body).equals(PDF)).toBe(true);
    await expect(readSopFile(sop.id, 2)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
