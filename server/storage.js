/** Atomic single-writer snapshot storage for a SMALL classroom server.
 * SQLite on a durable disk, or libSQL/Turso HTTP on ephemeral hosting.
 * A compare-and-swap fences a previous server during replacement. No blind retries.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class StorageError extends Error {
  constructor(message = 'Le stockage est momentanément indisponible. Aucune nouvelle mise n’est acceptée.', code = 'STORAGE_UNAVAILABLE') {
    super(message); this.status = 503; this.code = code;
  }
}

export class SnapshotStore {
  constructor({ filename = ':memory:', remoteUrl = '', remoteToken = '', fetchImpl = fetch, allowHttp = false } = {}) {
    this.owner = randomUUID(); this.revision = 0; this.lost = false; this.fetchImpl = fetchImpl;
    if (remoteUrl) {
      const u = new URL(remoteUrl.replace(/^(libsql|turso):/, 'https:'));
      if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:'))) throw new Error('Adresse de base distante invalide. HTTPS requis.');
      if (!remoteToken) throw new Error('TURSO_AUTH_TOKEN est requis.');
      this.endpoint = `${u.origin}/v2/pipeline`; this.remoteToken = remoteToken; this.mode = 'turso';
    } else {
      if (filename !== ':memory:') {
        mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
      }
      this.db = new DatabaseSync(filename, { timeout: 5000 });
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if (filename !== ':memory:') { try { chmodSync(filename, 0o600); } catch { /* Windows ACLs apply. */ } }
      this.mode = filename === ':memory:' ? 'memory-test' : 'sqlite';
    }
  }
  async query(sql, args = []) {
    if (this.db) {
      const statement = this.db.prepare(sql);
      if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return { rows: statement.all(...args), affected: 0 };
      const result = statement.run(...args); return { rows: [], affected: Number(result.changes) };
    }
    const typed = args.map(v => v === null ? { type: 'null' } : typeof v === 'number' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) });
    let response, packet;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.remoteToken}` },
        redirect: 'error', signal: AbortSignal.timeout(12000),
        body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: typed, want_rows: true } }, { type: 'close' }] })
      });
      if (!response.ok) throw new StorageError();
      packet = await response.json();
    } catch { throw new StorageError(); }
    const result = packet.results?.[0];
    if (result?.type !== 'ok' || result.response?.type !== 'execute') throw new StorageError();
    const raw = result.response.result;
    const rows = (raw.rows || []).map(row => Object.fromEntries(row.map((v, i) => [raw.cols[i].name, v.type === 'null' ? null : v.type === 'integer' || v.type === 'float' ? Number(v.value) : v.value])));
    return { rows, affected: Number(raw.affected_row_count || 0) };
  }
  async open(emptyState) {
    await this.query('CREATE TABLE IF NOT EXISTS cr_snapshot (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, owner TEXT NOT NULL, payload TEXT NOT NULL)');
    await this.query('INSERT INTO cr_snapshot (id, revision, owner, payload) VALUES (1, 0, ?, ?) ON CONFLICT(id) DO NOTHING', ['', JSON.stringify(emptyState)]);
    // Only the latest process may write. Claim and read one atomic revision.
    for (let i = 0; i < 8; i++) {
      const row = (await this.query('SELECT revision, payload FROM cr_snapshot WHERE id = 1')).rows[0];
      const claimed = await this.query('UPDATE cr_snapshot SET owner = ?, revision = revision + 1 WHERE id = 1 AND revision = ? RETURNING revision, payload', [this.owner, row.revision]);
      if (claimed.rows.length) {
        this.revision = claimed.rows[0].revision;
        const data = JSON.parse(claimed.rows[0].payload);
        if (data.schema !== 2) throw new Error('Version de données incompatible : migration nécessaire.');
        return data;
      }
    }
    throw new StorageError('Un autre serveur utilise déjà cette base.', 'STORAGE_CONFLICT');
  }
  async save(data) {
    if (this.lost) throw new StorageError('Cette instance a été remplacée. Actualise le site.', 'STORAGE_CONFLICT');
    const commitId = randomUUID(); data.lastCommit = commitId;
    const payload = JSON.stringify(data);
    if (Buffer.byteLength(payload) > 32 * 1024 * 1024) throw new StorageError('Le stockage de classe doit être archivé avant de continuer.', 'STORAGE_CAPACITY');
    let result;
    try {
      result = await this.query('UPDATE cr_snapshot SET payload = ?, revision = revision + 1 WHERE id = 1 AND owner = ? AND revision = ? RETURNING revision', [payload, this.owner, this.revision]);
    } catch (error) {
      // A lost HTTP reply is not proof that COMMIT failed. Read the unique commit ID.
      try {
        const row = (await this.query('SELECT revision, owner, payload FROM cr_snapshot WHERE id = 1')).rows[0];
        if (row && row.owner === this.owner && JSON.parse(row.payload).lastCommit === commitId) { this.revision = row.revision; return; }
        if (row?.owner !== this.owner) this.lost = true;
      } catch { this.lost = true; } // Fail closed on an ambiguous write. Restart reloads the durable truth.
      throw error;
    }
    if (!result.rows.length) { this.lost = true; throw new StorageError('Cette instance a été remplacée. Actualise le site.', 'STORAGE_CONFLICT'); }
    this.revision = result.rows[0].revision;
  }
  async checkOwner() {
    if (this.lost) return false;
    const row = (await this.query('SELECT owner FROM cr_snapshot WHERE id = 1')).rows[0];
    if (row?.owner !== this.owner) this.lost = true;
    return !this.lost;
  }
  close() { this.db?.close(); }
}
