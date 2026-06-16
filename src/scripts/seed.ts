import { randomBytes } from "node:crypto";
import { env } from "../config/env";
import { closeMongo, connectMongo } from "../db/mongo";
import { createApiKey, Role } from "../models/ApiKey";

/**
 * Seed one admin key and one client key. Prints the RAW keys exactly once —
 * only the hashes are stored. Re-running is safe: existing keyIds are skipped.
 *
 * Usage: npm run seed
 */
function generateKey(prefix: string): string {
  return `sllm_${prefix}_${randomBytes(24).toString("hex")}`;
}

async function seedKey(
  keyId: string,
  role: Role,
  name: string,
  rawKey: string,
): Promise<void> {
  try {
    await createApiKey({ keyId, rawKey, role, name });
    // eslint-disable-next-line no-console
    console.log(`\n${role.toUpperCase()} key (keyId=${keyId}):\n  ${rawKey}`);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      // eslint-disable-next-line no-console
      console.log(`\nkeyId=${keyId} already exists — skipped.`);
    } else {
      throw err;
    }
  }
}

async function main(): Promise<void> {
  await connectMongo();

  const adminRaw = env.adminBootstrapKey || generateKey("admin");
  const clientRaw = generateKey("client");

  await seedKey("admin-1", "admin", "bootstrap admin", adminRaw);
  await seedKey("client-1", "client", "demo client", clientRaw);

  // eslint-disable-next-line no-console
  console.log(
    "\nStore these now — only their hashes are kept in MongoDB.\n",
  );

  await closeMongo();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("seed failed:", (err as Error).message);
  process.exit(1);
});
