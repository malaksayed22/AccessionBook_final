import { beforeEach, describe, expect, it } from "vitest";
import { getOrganizationDetail } from "@/features/organization/queries";
import {
  readOrganizationDocument,
  uploadOrganizationDocument,
} from "@/features/organization/documents";
import { createOrganization } from "@/features/organization/service";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createLab, resetDatabase } from "./helpers";

type Lab = Awaited<ReturnType<typeof createLab>>;

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error, `expected an AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const file = { fileName: "licence.txt", bytes: Buffer.from("Licence LIC-1\n") };
const pages = { inbound: 1, outbound: 1, units: 1, tests: 1 };

describe("organization documents", () => {
  let lab: Lab;
  let organizationId: number;

  beforeEach(async () => {
    await resetDatabase();
    lab = await createLab();
    organizationId = (
      await createOrganization(lab.admin, {
        address: "1 Test Street, Quebec City",
        name: "Acme Labs",
      })
    ).id;
  });

  it("lets an administrator add a document, and anyone signed in download it", async () => {
    const { documentId } = await uploadOrganizationDocument(lab.admin, organizationId, {
      ...file,
      label: "Licence 2026",
    });
    const row = await prisma.organizationAttachment.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(row).toMatchObject({ label: "Licence 2026", userId: lab.admin.id });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

    const read = await readOrganizationDocument(lab.member, organizationId, documentId);
    expect(read.body.toString()).toBe("Licence LIC-1\n");

    // It is on the organization's page, and in its activity.
    const detail = await getOrganizationDetail(lab.member, organizationId, pages);
    expect(detail?.documents).toMatchObject([{ id: documentId, label: "Licence 2026" }]);
    expect(detail?.activity.some((a) => a.summary.includes("Licence 2026"))).toBe(true);
  });

  it("names the document after its file when no name is given", async () => {
    const { documentId } = await uploadOrganizationDocument(lab.admin, organizationId, file);
    expect(
      (await prisma.organizationAttachment.findUniqueOrThrow({ where: { id: documentId } })).label
    ).toBe("licence.txt");
  });

  it("refuses members, unknown organizations and files that are not on the allow-list", async () => {
    await expectCode(uploadOrganizationDocument(lab.member, organizationId, file), "FORBIDDEN");
    await expectCode(uploadOrganizationDocument(lab.admin, 999_999, file), "NOT_FOUND");
    await expectCode(
      uploadOrganizationDocument(lab.admin, organizationId, {
        fileName: "page.html",
        bytes: Buffer.from("<script>alert(1)</script>"),
      }),
      "VALIDATION"
    );
    expect(await prisma.organizationAttachment.count()).toBe(0);
  });

  it("does not serve a document under another organization", async () => {
    const other = await createOrganization(lab.admin, {
      address: "1 Test Street, Quebec City",
      name: "Other Org",
    });
    const { documentId } = await uploadOrganizationDocument(lab.admin, organizationId, file);
    await expectCode(readOrganizationDocument(lab.admin, other.id, documentId), "NOT_FOUND");
  });
});
