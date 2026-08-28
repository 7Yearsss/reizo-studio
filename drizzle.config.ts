import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is used only to generate migration SQL from
 * `src/main/server/db/schema.ts` and to derive types. Migrations are applied
 * at runtime by a small hand-written runner in `db/client.ts` (the
 * sqlite-proxy driver over `node:sqlite` has no drizzle migrator).
 *
 *   npx drizzle-kit generate
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/server/db/schema.ts',
  out: './src/main/server/db/migrations',
});
