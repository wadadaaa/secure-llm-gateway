import { Db, MongoClient } from "mongodb";
import { env } from "../config/env";

let client: MongoClient | null = null;
let db: Db | null = null;

/** Connect once and create indexes. Idempotent. */
export async function connectMongo(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(env.mongoUri, {
    serverSelectionTimeoutMS: 5_000,
  });
  await client.connect();
  db = client.db(env.mongoDb);

  // Indexes: fast key lookup by hash, and audit queries by time.
  await db.collection("apiKeys").createIndex({ keyHash: 1 }, { unique: true });
  await db.collection("apiKeys").createIndex({ keyId: 1 }, { unique: true });
  await db.collection("auditLogs").createIndex({ timestamp: -1 });

  return db;
}

/** Get the connected database. Throws if not connected yet. */
export function getDb(): Db {
  if (!db) throw new Error("Mongo not connected — call connectMongo() first");
  return db;
}

/** Liveness check used by /healthz. Returns true if Mongo answers a ping. */
export async function pingMongo(): Promise<boolean> {
  try {
    if (!db) return false;
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
