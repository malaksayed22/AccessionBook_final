import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createUser, resetDatabase } from "./helpers";

describe("schema constraints", () => {
  beforeEach(resetDatabase);

  it("allocates ids from sequences", async () => {
    const first = await createUser("First");
    const second = await createUser("Second");
    expect(second.id).toBe(first.id + 1);
  });

  it("is a UTF-8 database that round-trips accents, symbols and non-Latin text", async () => {
    const rows = await prisma.$queryRaw<Array<{ encoding: string }>>`
      SELECT pg_encoding_to_char(encoding) AS encoding
      FROM pg_database WHERE datname = current_database()`;
    expect(rows[0]?.encoding).toBe("UTF8");

    const text = "Détruit → Québec · 検査 · ✓";
    const org = await prisma.organization.create({ data: { name: text } });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).name).toBe(
      text
    );
  });

  it("stores timestamps with a time zone", async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; data_type: string }>>`
      SELECT table_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name IN ('createdAt', 'updatedAt', 'effectiveAt', 'recordedAt')
        AND data_type LIKE 'timestamp%'`;
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((r) => r.data_type === "timestamp with time zone")).toBe(true);
  });

  it("sets createdAt and maintains updatedAt", async () => {
    const user = await createUser("Clock");
    expect(user.createdAt).toBeInstanceOf(Date);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const updated = await prisma.user.update({ where: { id: user.id }, data: { initials: "CK" } });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(user.updatedAt.getTime());
  });

  describe("case-insensitive uniqueness", () => {
    it("rejects user names that differ only by case", async () => {
      await createUser("Amira");
      await expect(createUser("aMIRA", { email: "other@example.com" })).rejects.toThrow();
    });

    it("rejects emails that differ only by case, but allows several members without one", async () => {
      await createUser("One", { email: "Person@Example.com" });
      await expect(createUser("Two", { email: "person@example.com" })).rejects.toThrow();
      await prisma.user.create({ data: { name: "NoEmailA" } });
      await prisma.user.create({ data: { name: "NoEmailB" } });
    });

    it("rejects organization and unit names that differ only by case", async () => {
      await prisma.organization.create({ data: { name: "Université Laval" } });
      await expect(
        prisma.organization.create({ data: { name: "université laval" } })
      ).rejects.toThrow();
      await prisma.biologicalUnit.create({ data: { name: "P1", type: "PLANT" } });
      await expect(
        prisma.biologicalUnit.create({ data: { name: "p1", type: "PLANT" } })
      ).rejects.toThrow();
    });
  });

  describe("native enums", () => {
    it("refuses a value outside the enum, even from raw SQL", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "User" ("name", "permissions", "updatedAt") VALUES ('Eve', 'SUPERUSER', now())`
        )
      ).rejects.toThrow();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "BiologicalUnit" ("name", "type", "updatedAt") VALUES ('X', 'TREE', now())`
        )
      ).rejects.toThrow();
    });
  });

  describe("physical sanity", () => {
    it("rejects a negative location capacity and shipment quantity", async () => {
      await expect(
        prisma.location.create({ data: { name: "Bad", capacity: -1 } })
      ).rejects.toThrow();
    });
  });
});
