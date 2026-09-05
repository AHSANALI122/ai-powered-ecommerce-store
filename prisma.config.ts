import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Direct TCP connection string. Neon's pooled URL works too, but migrations
    // are happiest against the direct (non-pooled) endpoint.
    //
    // Read straight from process.env rather than Prisma's env() helper: env()
    // throws when the variable is absent, which would break `prisma generate`
    // in CI, where codegen is needed but no database exists. Commands that
    // genuinely need a connection (migrate, seed, studio) still fail with
    // Prisma's own clear message.
    url: process.env["DATABASE_URL"] ?? "",
  },
});
