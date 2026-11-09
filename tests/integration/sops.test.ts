import { beforeEach, describe, expect, it } from "vitest";
import { countSopsToSign, getSop, listSops } from "@/features/sop/queries";
import { createSop, updateSop } from "@/features/sop/service";
import { AppError } from "@/server/errors";
import { prisma } from "@/server/db";
import { createLab, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

const BODY = "1. Wear gloves.\n2. Weigh the flower on the calibrated scale.\n3. Record the weight.";

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("standard operating procedures", () => {
  let lab: Lab;
  let qa: Lab["admin"];

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    qa = { ...lab.witness, permissions: "QA" };
  });

  it("is written by quality assurance, takes effect on approval, and is signed by staff", async () => {
    expect(
      (await failure(createSop(lab.member, { code: "SOP-001", title: "Weighing", body: BODY })))
        .code
    ).toBe("FORBIDDEN");
    const sop = await createSop(qa, { code: "SOP-001", title: "Weighing", body: BODY });
    expect(
      (await failure(createSop(qa, { code: "SOP-001", title: "Again", body: BODY }))).details
    ).toMatchObject({ reason: "sopCodeTaken" });

    // A draft is not in effect: nothing to sign yet.
    expect((await failure(updateSop(lab.member, sop.id, { action: "sign" }))).code).toBe(
      "CONFLICT"
    );
    await updateSop(qa, sop.id, { action: "approve" });
    expect(await countSopsToSign(lab.member)).toBe(1);

    await updateSop(lab.member, sop.id, { action: "sign" });
    expect((await failure(updateSop(lab.member, sop.id, { action: "sign" }))).code).toBe(
      "CONFLICT"
    );
    const inspector = { ...lab.outsider, permissions: "INSPECTOR" as const };
    expect((await failure(updateSop(inspector, sop.id, { action: "sign" }))).code).toBe(
      "FORBIDDEN"
    );

    const [row] = await listSops(lab.member);
    // Admin, member, outsider and the QA member must sign; the member has.
    expect(row).toMatchObject({ effective: { version: 1 }, signed: 1, staff: 4, mine: "signed" });
    expect(await countSopsToSign(lab.member)).toBe(0);
  });

  it("supersedes the version in effect with an approved draft, which needs new signatures", async () => {
    const sop = await createSop(qa, { code: "SOP-002", title: "Cleaning", body: BODY });
    await updateSop(qa, sop.id, { action: "approve" });
    await updateSop(lab.member, sop.id, { action: "sign" });

    await updateSop(qa, sop.id, {
      action: "draft",
      body: `${BODY}\n4. Clean the scale.`,
      changeNote: "Added cleaning",
    });
    // Rewriting the draft keeps one draft.
    await updateSop(qa, sop.id, {
      action: "draft",
      body: `${BODY}\n4. Clean the scale with ethanol.`,
      changeNote: "Added cleaning with ethanol",
    });
    let detail = (await getSop(lab.member, sop.id))!;
    expect(detail.effective?.version).toBe(1);
    expect(detail.draft).toMatchObject({ version: 2, changeNote: "Added cleaning with ethanol" });
    expect(detail.mySignature).not.toBeNull();

    await updateSop(qa, sop.id, { action: "approve" });
    detail = (await getSop(lab.member, sop.id))!;
    expect(detail.versions.map((v) => [v.version, v.status])).toEqual([
      [2, "EFFECTIVE"],
      [1, "SUPERSEDED"],
    ]);
    expect(detail.mySignature).toBeNull();
    expect(detail.roster.every((member) => member.signedAt === null)).toBe(true);
    expect((await failure(updateSop(qa, sop.id, { action: "approve" }))).code).toBe("CONFLICT");

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "sop", entityId: sop.id },
      orderBy: { id: "asc" },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "create",
      "approve",
      "sign",
      "draft",
      "draft",
      "approve",
    ]);
  });
});
