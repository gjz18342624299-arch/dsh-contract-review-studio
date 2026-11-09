import {readFile, writeFile, mkdir, readdir, lstat, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SCHEMA = 'office-capture/v1';
export const CAPTURE_TTL_MS = 600000;

// Existing clients persist captureId as versions[].sourceCapture in browser storage.
// The server cannot enumerate those references: legacy and default captures MUST
// remain durable. Only explicitly opted-in temporary captures may be collected.
export function createCaptureStorage(directory, {now = Date.now} = {}) {
  const root = join(directory, 'captures');
  let sweepPromise;
  let lastSweep = -Infinity;
  const temporary = meta => meta?.schema === SCHEMA && meta.retention === 'temporary';
  const expired = meta => temporary(meta) && Number.isFinite(meta.at) &&
    meta.at >= 0 && now() - meta.at >= CAPTURE_TTL_MS;
  const path = (id, ext) => {
    if (!ID.test(id || '')) throw Error('快照编号无效');
    return join(root, id + ext);
  };
  async function removeRegular(file) {
    try {
      // Never recurse or follow links when collecting our own temporary pair.
      if ((await lstat(file)).isFile()) await unlink(file);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async function removeTemporary(id) {
    if (!(await lstat(root)).isDirectory()) return;
    if (!(await lstat(path(id, '.json'))).isFile()) return;
    // Remove the body first, keeping the marker retryable if deletion fails.
    await removeRegular(path(id, '.docx'));
    await removeRegular(path(id, '.json'));
  }
  return {
    async save(bytes, details, {temporary: isTemporary = false} = {}) {
      await mkdir(root, {recursive: true});
      const id = randomUUID();
      const meta = {schema: SCHEMA, retention: isTemporary ? 'temporary' : 'persistent',
        sha256: createHash('sha256').update(bytes).digest('hex'), at: now(),
        fileId: details.id, name: details.name};
      let bodyWritten = false;
      try {
        await writeFile(path(id, '.docx'), bytes, {flag: 'wx', mode: 0o600});
        bodyWritten = true;
        await writeFile(path(id, '.json'), JSON.stringify(meta), {flag: 'wx', mode: 0o600});
      } catch (e) {
        // Roll back only this invocation's newly-created body, never other data.
        if (bodyWritten) await removeRegular(path(id, '.docx')).catch(() => {});
        throw e;
      }
      return {id, ...meta};
    },
    async load(id) {
      const meta = JSON.parse(await readFile(path(id, '.json'), 'utf8'));
      if (temporary(meta) && (!Number.isFinite(meta.at) || meta.at < 0 || expired(meta))) {
        // A malformed temporary timestamp must not turn into an immortal capture.
        // Only valid expired markers are eligible for deletion.
        if (expired(meta)) await removeTemporary(id).catch(() => {});
        throw Error('快照已过期');
      }
      const bytes = await readFile(path(id, '.docx'));
      if (!/^[a-f0-9]{64}$/.test(meta.sha256 || '') ||
          createHash('sha256').update(bytes).digest('hex') !== meta.sha256) {
        throw Error('快照摘要校验失败');
      }
      return {...meta, bytes};
    },
    async sweep() {
      // Request-driven, throttled and single-flight; no process-lifetime timer.
      if (sweepPromise) return sweepPromise;
      if (now() - lastSweep < 60000) return;
      lastSweep = now();
      sweepPromise = (async () => {
        try {
          if (!(await lstat(root)).isDirectory()) return;
          for (const entry of await readdir(root, {withFileTypes: true})) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const id = entry.name.slice(0, -5);
            if (!ID.test(id)) continue;
            try {
              const meta = JSON.parse(await readFile(path(id, '.json'), 'utf8'));
              if (expired(meta)) await removeTemporary(id);
            } catch { /* Unknown, malformed or inaccessible files are not ours to delete. */ }
          }
        } catch { /* A cleanup failure must not break downloads or capture creation. */ }
      })();
      try { await sweepPromise; } finally { sweepPromise = undefined; }
    }
  };
}
