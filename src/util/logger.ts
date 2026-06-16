/**
 * Minimal structured logger. Writes JSON lines to stdout/stderr.
 *
 * Security note: callers must never pass secrets, raw API keys, or PII
 * redaction maps to this logger. The audit log (Mongo) is the only place token
 * mappings are stored.
 */

type Fields = Record<string, unknown>;

function emit(stream: NodeJS.WriteStream, level: string, msg: string, fields?: Fields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  stream.write(`${line}\n`);
}

export const logger = {
  info(msg: string, fields?: Fields): void {
    emit(process.stdout, "info", msg, fields);
  },
  warn(msg: string, fields?: Fields): void {
    emit(process.stdout, "warn", msg, fields);
  },
  error(msg: string, fields?: Fields): void {
    emit(process.stderr, "error", msg, fields);
  },
};
