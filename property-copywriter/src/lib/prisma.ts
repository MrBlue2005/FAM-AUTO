import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const cachedPrisma = globalForPrisma.prisma;
const cachedClientMatchesSchema = typeof (
  cachedPrisma as PrismaClient & {
    descriptionTemplate?: { findMany?: unknown };
  } | undefined
)?.descriptionTemplate?.findMany === "function";

export const prisma = cachedPrisma && cachedClientMatchesSchema
  ? cachedPrisma
  : new PrismaClient({
      adapter: new PrismaBetterSqlite3({
        url: process.env.DATABASE_URL || "file:./dev.db",
      }),
    });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;