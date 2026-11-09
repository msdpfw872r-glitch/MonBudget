/**
 * db.js — Stockage des données sur l'appareil (IndexedDB), sans dépendance.
 *
 * Version : 0.8.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Deux moteurs avec la même interface (toutes les méthodes renvoient une promesse) :
 *   - openDb()        : IndexedDB, dans Safari / le navigateur ;
 *   - openMemoryDb()  : en mémoire, pour les tests dans Node.
 *
 * Interface : get(store, id), getAll(store), put(store, obj), putMany(store, objs),
 *             delete(store, id), clear(store), count(store), countWhere(store, champ, valeur),
 *             getAllWhere(store, champ, valeur), close().
 *
 * Suivi des changements (synchronisation, voir docs/specs/synchro.md) : sur les tables synchronisées,
 * chaque écriture reçoit `updatedAt` (ms) et une entrée dans `outbox` ; une suppression laisse une
 * entrée `outbox` « deleted ». `db.raw` écrit sans suivi (données reçues du cloud).
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version : stores et index du modèle de données (schéma 1).
 *   0.4.0  FRE (Fidag)  Schéma 2 : index merchantKey et cardBillId (rattachement aux factures de carte).
 *   0.8.2  FRE (Fidag)  Schéma 3 : table outbox, updatedAt et traces de suppression (synchronisation).
 */

export const DB_NAME = 'mon-budget';
export const SCHEMA_VERSION = 3;

/** Stores et champs indexés (voir CLAUDE.md § 4, modèle de données). */
export const STORES = {
  people: [],
  accounts: [],
  categories: ['type'],
  transactions: ['accountId', 'personId', 'categoryId', 'status', 'date', 'importId', 'ruleId', 'merchantKey', 'cardBillId'],
  rules: ['merchantKey', 'personId', 'categoryId'],
  imports: ['accountId'],
  settings: [],
  outbox: [],
};

/** Tables envoyées au cloud (chiffrées). `settings` et `outbox` restent sur l'appareil. */
export const SYNCED_STORES = ['people', 'accounts', 'categories', 'transactions', 'rules', 'imports'];
/** Tables mises dans une sauvegarde fichier. */
export const BACKUP_STORES = Object.keys(STORES).filter((s) => s !== 'outbox');

const isSynced = (s) => SYNCED_STORES.includes(s);
const outboxId = (store, id) => `${store}/${id}`;

/**
 * Ajoute le suivi des changements à une base (mêmes méthodes, plus `raw` et `now`).
 * @param {object} base  base sans suivi
 * @param {() => number} [now]  horloge (ms), remplaçable dans les tests
 */
export function withTracking(base, now = () => Date.now()) {
  let last = 0;
  // Dates strictement croissantes sur l'appareil (deux écritures dans la même milliseconde restent ordonnées).
  const stamp = () => { const t = Math.max(now(), last + 1); last = t; return t; };
  const entry = (store, recId, updatedAt, deleted) => ({ id: outboxId(store, recId), store, recId, updatedAt, deleted });
  return {
    ...base,
    kind: base.kind,
    raw: base,
    now: stamp,
    async put(s, obj) {
      if (!isSynced(s)) return base.put(s, obj);
      const t = stamp();
      const rec = { ...obj, updatedAt: t };
      await base.put(s, rec);
      await base.put('outbox', entry(s, obj.id, t, false));
      return rec;
    },
    async putMany(s, objs) {
      if (!isSynced(s)) return base.putMany(s, objs);
      const recs = objs.map((o) => ({ ...o, updatedAt: stamp() }));
      await base.putMany(s, recs);
      await base.putMany('outbox', recs.map((r) => entry(s, r.id, r.updatedAt, false)));
      return recs.length;
    },
    async delete(s, id) {
      await base.delete(s, id);
      if (isSynced(s)) await base.put('outbox', entry(s, id, stamp(), true));
    },
    async clear(s) {
      if (isSynced(s)) {
        const all = await base.getAll(s);
        if (all.length) await base.putMany('outbox', all.map((o) => entry(s, o.id, stamp(), true)));
      }
      await base.clear(s);
    },
    // Les méthodes de lecture appellent base (this = la base suivie ne change rien).
    countWhere: (s, f, v) => base.countWhere(s, f, v),
    getAllWhere: (s, f, v) => base.getAllWhere(s, f, v),
  };
}

const reqToPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function checkStore(name) {
  if (!(name in STORES)) throw new Error(`Store inconnu : ${name}`);
}

/** Ouvre (et crée au besoin) la base IndexedDB. */
export function openDb(factory = globalThis.indexedDB, name = DB_NAME) {
  if (!factory) return Promise.reject(new Error('Le stockage de cet appareil n’est pas disponible.'));
  return new Promise((resolve, reject) => {
    const open = factory.open(name, SCHEMA_VERSION);
    open.onupgradeneeded = () => {
      const idb = open.result;
      for (const [store, indexes] of Object.entries(STORES)) {
        const os = idb.objectStoreNames.contains(store)
          ? open.transaction.objectStore(store)
          : idb.createObjectStore(store, { keyPath: 'id' });
        for (const field of indexes) if (!os.indexNames.contains(field)) os.createIndex(field, field);
      }
    };
    open.onblocked = () => reject(new Error('Fermez les autres fenêtres de Mon Budget puis réessayez.'));
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const idb = open.result;
      // Une nouvelle version de l'app demande la base : on libère la place.
      idb.onversionchange = () => idb.close();
      resolve(withTracking(wrapIdb(idb)));
    };
  });
}

function wrapIdb(idb) {
  const run = (store, mode, fn) => {
    checkStore(store);
    const tx = idb.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Enregistrement annulé'));
    });
  };
  const hasIndex = (store, field) => STORES[store].includes(field);
  return {
    kind: 'indexeddb',
    get: (s, id) => run(s, 'readonly', (os) => os.get(id)),
    getAll: (s) => run(s, 'readonly', (os) => os.getAll()),
    put: (s, obj) => run(s, 'readwrite', (os) => { os.put(obj); return obj; }),
    putMany: (s, objs) => run(s, 'readwrite', (os) => { for (const o of objs) os.put(o); return objs.length; }),
    delete: (s, id) => run(s, 'readwrite', (os) => { os.delete(id); }),
    clear: (s) => run(s, 'readwrite', (os) => { os.clear(); }),
    count: (s) => run(s, 'readonly', (os) => os.count()),
    async countWhere(s, field, value) {
      if (hasIndex(s, field)) return run(s, 'readonly', (os) => os.index(field).count(value));
      return (await this.getAll(s)).filter((o) => o[field] === value).length;
    },
    async getAllWhere(s, field, value) {
      if (hasIndex(s, field)) return run(s, 'readonly', (os) => os.index(field).getAll(value));
      return (await this.getAll(s)).filter((o) => o[field] === value);
    },
    close: () => idb.close(),
  };
}

/** Base en mémoire (tests), avec suivi des changements. Copie les objets comme IndexedDB le fait. */
export function openMemoryDb({ now } = {}) {
  return withTracking(openRawMemoryDb(), now);
}

/** Base en mémoire sans suivi. */
export function openRawMemoryDb() {
  const data = Object.fromEntries(Object.keys(STORES).map((s) => [s, new Map()]));
  const copy = (o) => (o === undefined ? undefined : structuredClone(o));
  const map = (s) => { checkStore(s); return data[s]; };
  const sorted = (s) => [...map(s).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => copy(v));
  return {
    kind: 'memory',
    async get(s, id) { return copy(map(s).get(id)); },
    async getAll(s) { return sorted(s); },
    async put(s, obj) {
      if (obj?.id === undefined) throw new Error('Objet sans id');
      map(s).set(obj.id, copy(obj));
      return obj;
    },
    async putMany(s, objs) { for (const o of objs) await this.put(s, o); return objs.length; },
    async delete(s, id) { map(s).delete(id); },
    async clear(s) { map(s).clear(); },
    async count(s) { return map(s).size; },
    async countWhere(s, field, value) { return [...map(s).values()].filter((o) => o[field] === value).length; },
    async getAllWhere(s, field, value) { return sorted(s).filter((o) => o[field] === value); },
    close() {},
  };
}
