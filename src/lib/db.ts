import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";

/**
 * Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter; the Neon serverless adapter speaks HTTP/
 * WebSocket rather than holding a TCP pool, which is what makes it safe in a
 * serverless function that may be frozen between requests.
 *
 * The globalThis cache prevents a new client (and a new connection) on every
 * hot reload in development.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: serverEnv().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: serverEnv().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (serverEnv().NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
