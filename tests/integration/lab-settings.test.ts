import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperiment } from "@/features/experiment/service";
import { recordContext } from "@/features/record/common";
import { updateLabSettings } from "@/features/settings/service";
import { changeStage } from "@/features/unit/service";
import { zonedDateKey } from "@/lib/lab-time";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { getLabSettings } from "@/server/settings";
import { createLab, registerOne, resetDatabase } from "./helpers";

vi.mock("next-intl/server", () => import("../stubs/next-intl-server"));

type Lab = Awaited<ReturnType<typeof createLab>>;
const MS_PER_DAY = 86_400_000;
const daysAgo = (n: number) =>
  zonedDateKey(new Date(Date.now() - n * MS_PER_DAY), "America/Toronto");

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  return error as AppError;
}

describe("laboratory settings", () => {
  let lab: Lab;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
  });

  it("are administrators' to change, audited, and default to no limit and EXP", async () => {
    expect(await getLabSettings()).toMatchObject({
      backdateLimitDays: null,
      experimentCodePrefix: "EXP",
    });
    expect((await failure(updateLabSettings(lab.member, { backdateLimitDays: 7 }))).code).toBe(
      "FORBIDDEN"
    );
    await updateLabSettings(lab.admin, {
      licenceNumber: "LIC-QC-0042",
      licenceHolder: "Université Laval",
      licenceClass: "RESEARCH",
      backdateLimitDays: 14,
      experimentCodePrefix: "LAV",
    });
    expect(await getLabSettings()).toMatchObject({
      licenceNumber: "LIC-QC-0042",
      licenceClass: "RESEARCH",
      backdateLimitDays: 14,
      experimentCodePrefix: "LAV",
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "settings" } });
    expect(JSON.stringify(entry.details)).toContain("backdateLimitDays");
    // The licence goes on every record.
    const ctx = await recordContext("en", lab.admin);
    expect(
      ctx.record({ title: "T", subject: "S", qrUrl: "http://x", sections: [] }).meta
    ).toContain("Licence LIC-QC-0042");
  });

  it("refuse an event dated further back than the limit, and code new experiments with the prefix", async () => {
    await updateLabSettings(lab.admin, { backdateLimitDays: 14, experimentCodePrefix: "LAV" });
    const unit = await registerOne(lab, { name: "BACK-1", effectiveAt: daysAgo(10) });
    const tooFar = await failure(
      changeStage(lab.member, unit.id, { toStage: "FLOWERING", effectiveAt: daysAgo(20) })
    );
    expect(tooFar.details).toMatchObject({ reason: "tooFarBack", values: { days: 14 } });
    expect(
      (await failure(registerOne(lab, { name: "BACK-2", effectiveAt: daysAgo(30) }))).details
    ).toMatchObject({
      reason: "tooFarBack",
    });
    await changeStage(lab.member, unit.id, { toStage: "FLOWERING", effectiveAt: daysAgo(5) });

    const experiment = await createExperiment(lab.admin, {
      name: "Prefix trial",
      startDate: daysAgo(0),
      providerMode: "INTERNAL",
    } as never);
    expect(experiment.ecode).toMatch(/^LAV\d+$/);
  });
});
