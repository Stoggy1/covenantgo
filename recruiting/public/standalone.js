// Browser-only Recruitment CRM (used on the GitHub link, where there is no server).
// Runs the same core as the office computer, with SQLite inside the browser.
// Data is saved in this browser (IndexedDB) on this device only. No sign-in.
import { createCore } from './core.js';

const CDN = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the database engine. Check the internet connection and reload.'));
    document.head.appendChild(s);
  });
}

// ---- IndexedDB: one key holding the whole database file ----
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('recruitment-crm', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet() {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const r = d.transaction('files').objectStore('files').get('db');
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(bytes) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').put(bytes, 'db');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ---- make sql.js look like Node's built-in SQLite (prepare().get/all/run, exec) ----
const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
function wrap(raw) {
  return {
    exec(sql) { raw.exec(sql); },
    prepare(sql) {
      return {
        all(...args) {
          const st = raw.prepare(sql);
          try {
            st.bind(clean(args));
            const out = [];
            while (st.step()) out.push(st.getAsObject());
            return out;
          } finally { st.free(); }
        },
        get(...args) { return this.all(...args)[0]; },
        run(...args) {
          raw.run(sql, clean(args));
          const changes = raw.getRowsModified();
          const lastInsertRowid = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
          return { changes, lastInsertRowid };
        },
      };
    },
  };
}

export async function startStandalone() {
  await loadScript(CDN + 'sql-wasm.js');
  const SQL = await window.initSqlJs({ locateFile: (f) => CDN + f });
  let saved = null;
  let storageOk = true;
  try { saved = await idbGet(); } catch { storageOk = false; }
  let raw = saved ? new SQL.Database(saved) : new SQL.Database();
  const core = createCore(wrap(raw), {}); // no hooks: the DM script can't run from a web page
  const save = async () => {
    try { await idbSet(raw.export()); } catch { storageOk = false; }
    raw.exec('PRAGMA foreign_keys = ON'); // export() can reset it
  };
  return {
    storageOk: () => storageOk,
    async api(path, method, body, who) {
      const u = new URL(path, 'http://x');
      const out = await core.handle(method, u.pathname, Object.fromEntries(u.searchParams), body, who, true);
      if (method !== 'GET') await save();
      return out;
    },
    backup() { return raw.export(); },
    async restore(bytes) {
      const test = new SQL.Database(bytes);
      try { test.exec('SELECT count(*) FROM creators'); } catch { test.close(); throw new Error("That file isn't a Recruitment CRM backup"); }
      test.close();
      await idbSet(bytes);
    },
    async erase() { await idbSet(new SQL.Database().export()); },
  };
}
