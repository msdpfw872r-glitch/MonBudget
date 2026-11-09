/**
 * synchro.js — Synchronisation chiffrée : coffre (clés) et moteur (fusion « dernière écriture gagnante »).
 *
 * Version : 0.8.4
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Voir docs/specs/synchro.md. Ne dépend ni du navigateur ni de Firebase : le cloud est un objet
 * « remote » (adaptateur Firestore dans l'app, faux cloud en mémoire dans les tests) :
 *   remote.getKey(nom) → enveloppe | null          remote.setKey(nom, enveloppe)
 *   remote.listKeys() → [{ name, ...enveloppe }]
 *   remote.pull(curseur | null) → { docs: [{ docId, v, iv, ct, updatedAt, deleted }], cursor }
 *        (documents écrits APRÈS le curseur ; cursor = nouveau curseur, opaque)
 *   remote.push([{ docId, v, iv, ct, updatedAt, deleted }])  (un lot, au plus BATCH documents)
 *
 * Historique :
 *   0.8.4  FRE (Fidag)  Première version.
 */

import { SYNCED_STORES } from '../data/db.js';
import * as K from './chiffrement.js';

export const BATCH = 400;
export const SYNC_SETTINGS_ID = 'sync';

const aadFor = (uid, docId) => `users/${uid}/records/${docId}/v1`;

// ---------- Coffre : la clé des données ----------

/** Le cloud a-t-il déjà une clé (coffre créé sur un autre appareil) ? */
export async function vaultExists(remote) {
  return Boolean(await remote.getKey('passphrase'));
}

/**
 * Crée le coffre (premier appareil) : nouvelle DEK enveloppée par la phrase de passe.
 * @returns {Promise<{aes: CryptoKey, hmac: CryptoKey}>}
 */
export async function createVault(remote, passphrase, { now = new Date() } = {}) {
  if (await vaultExists(remote)) throw new K.ChiffrementError('Le coffre existe déjà. Utilisez votre phrase de passe pour l’ouvrir.');
  const raw = K.generateDek();
  try {
    await remote.setKey('passphrase', await K.wrapWithPassphrase(raw, passphrase, { now }));
    return await K.openDek(raw);
  } finally {
    raw.fill(0);
  }
}

/** Ouvre le coffre avec la phrase de passe. */
export async function unlockWithPassphrase(remote, passphrase) {
  const env = await remote.getKey('passphrase');
  if (!env) throw new K.ChiffrementError('Aucun coffre dans le cloud. Créez-le d’abord.');
  return K.openDek(await K.unwrapWithPassphrase(env, passphrase));
}

/**
 * Ajoute (ou remplace) la passkey de cet appareil. Demande la phrase de passe :
 * la clé ouverte n'est pas exportable.
 * @param {{credentialId: Uint8Array, prfSalt: Uint8Array, prfSecret: Uint8Array, label?: string}} pk
 * @returns {Promise<string>} nom du document de l'enveloppe
 */
export async function addPasskey(remote, passphrase, pk, { now = new Date() } = {}) {
  const env = await remote.getKey('passphrase');
  if (!env) throw new K.ChiffrementError('Aucun coffre dans le cloud. Créez-le d’abord.');
  const raw = await K.unwrapWithPassphrase(env, passphrase);
  try {
    const name = await K.passkeyDocName(pk.credentialId);
    await remote.setKey(name, await K.wrapWithPrf(raw, pk.prfSecret, { credentialId: pk.credentialId, prfSalt: pk.prfSalt, label: pk.label ?? '', now }));
    return name;
  } finally {
    raw.fill(0);
  }
}

/** Enveloppe d'une passkey (pour lire prfSalt avant de demander Face ID). */
export async function passkeyEnvelope(remote, credentialId) {
  return remote.getKey(await K.passkeyDocName(credentialId));
}

/** Ouvre le coffre avec le secret PRF d'une passkey. */
export async function unlockWithPasskey(remote, credentialId, prfSecret) {
  const env = await passkeyEnvelope(remote, credentialId);
  if (!env) throw new K.ChiffrementError('Face ID n’est pas encore prêt sur cet appareil. Utilisez la phrase de passe.');
  return K.openDek(await K.unwrapWithPrf(env, prfSecret));
}

/** Change la phrase de passe (les passkeys restent valables : même DEK). */
export async function changePassphrase(remote, oldPassphrase, newPassphrase, { now = new Date() } = {}) {
  const env = await remote.getKey('passphrase');
  const raw = await K.unwrapWithPassphrase(env, oldPassphrase);
  try {
    await remote.setKey('passphrase', await K.wrapWithPassphrase(raw, newPassphrase, { now }));
  } finally {
    raw.fill(0);
  }
}

// ---------- Moteur ----------

async function syncState(db) {
  return (await db.get('settings', SYNC_SETTINGS_ID)) ?? { id: SYNC_SETTINGS_ID, cursor: null, joinedAt: null, lastSyncAt: null };
}

async function decryptDoc(keys, uid, doc) {
  const rec = await K.decryptJson(keys, doc, aadFor(uid, doc.docId));
  // Le contenu doit correspondre à son nom de document (pas d'échange de documents).
  if (!SYNCED_STORES.includes(rec.store) || (await K.docId(keys, rec.store, rec.id)) !== doc.docId) {
    throw new K.ChiffrementError('Un document du cloud ne correspond pas à son nom.');
  }
  return rec;
}

/** Applique un enregistrement venu du cloud, sans le renvoyer. */
async function applyRemote(db, rec) {
  if (rec.deleted) await db.raw.delete(rec.store, rec.id);
  else await db.raw.put(rec.store, { ...rec.data, id: rec.id, updatedAt: rec.updatedAt });
}

/** Met tout ce qui est sur l'appareil dans la file d'envoi (sauf `skip`). */
async function enqueueAll(db, skip = new Set()) {
  let n = 0;
  for (const store of SYNCED_STORES) {
    const entries = [];
    for (const o of await db.getAll(store)) {
      const id = `${store}/${o.id}`;
      if (skip.has(id)) continue;
      let updatedAt = o.updatedAt;
      if (typeof updatedAt !== 'number') {
        // Donnée d'avant le suivi des changements : on lui donne une date maintenant.
        updatedAt = db.now();
        await db.raw.put(store, { ...o, updatedAt });
      }
      entries.push({ id, store, recId: o.id, updatedAt, deleted: false });
    }
    if (entries.length) await db.raw.putMany('outbox', entries);
    n += entries.length;
  }
  return n;
}

/**
 * Relit ce qui a changé dans le cloud et le fusionne.
 * Premier passage sur un appareil (`joinedAt` vide) : si le cloud contient déjà des données, elles
 * gagnent ; ce qui n'existe que sur l'appareil est ensuite envoyé. Si le cloud est vide, tout
 * l'appareil est envoyé (migration des données existantes).
 */
async function pull(db, remote, keys, uid, state) {
  if (state.replaceCloud) return replaceCloud(db, remote, keys, uid, state);
  const joining = !state.joinedAt;
  const { docs, cursor } = await remote.pull(joining ? null : state.cursor);
  let applied = 0;
  let kept = 0;
  const seen = new Set();
  for (const doc of docs) {
    const rec = await decryptDoc(keys, uid, doc);
    const key = `${rec.store}/${rec.id}`;
    seen.add(key);
    const pending = await db.get('outbox', key);
    if (joining) {
      await applyRemote(db, rec);
      if (pending) await db.raw.delete('outbox', key);
      applied++;
      continue;
    }
    const local = await db.get(rec.store, rec.id);
    const localTime = pending?.updatedAt ?? local?.updatedAt ?? -Infinity;
    if (rec.updatedAt > localTime) {
      await applyRemote(db, rec);
      if (pending) await db.raw.delete('outbox', key);
      applied++;
    } else if (rec.updatedAt === localTime) {
      // Même modification (notre propre envoi revenu) : rien à faire.
      if (pending) await db.raw.delete('outbox', key);
    } else {
      // La version de l'appareil est plus récente : elle partira (si ce n'est pas déjà prévu).
      if (!pending) {
        const updatedAt = local?.updatedAt ?? db.now();
        await db.raw.put('outbox', { id: key, store: rec.store, recId: rec.id, updatedAt, deleted: !local });
      }
      kept++;
    }
  }
  let migrated = 0;
  if (joining) {
    // Tout ce qui n'est que sur l'appareil part dans le cloud.
    await db.raw.clear('outbox');
    migrated = await enqueueAll(db, seen);
  }
  return { cursor: cursor ?? state.cursor, applied, kept, migrated, received: docs.length };
}

/**
 * Après la restauration d'une sauvegarde : les données de l'appareil remplacent celles du cloud.
 * Tout est relu ; ce qui est dans le cloud mais pas sur l'appareil y est supprimé.
 */
async function replaceCloud(db, remote, keys, uid, state) {
  const { docs, cursor } = await remote.pull(null);
  const seen = new Set();
  let removed = 0;
  for (const doc of docs) {
    const rec = await decryptDoc(keys, uid, doc);
    const key = `${rec.store}/${rec.id}`;
    seen.add(key);
    if (rec.deleted || (await db.get(rec.store, rec.id))) continue;
    await db.raw.put('outbox', { id: key, store: rec.store, recId: rec.id, updatedAt: Math.max(db.now(), rec.updatedAt + 1), deleted: true });
    removed++;
  }
  // Tout ce qui est sur l'appareil repart, plus récent que le cloud.
  for (const store of SYNCED_STORES) {
    for (const o of await db.getAll(store)) {
      const key = `${store}/${o.id}`;
      if (!(await db.get('outbox', key))) await db.raw.put('outbox', { id: key, store, recId: o.id, updatedAt: o.updatedAt ?? db.now(), deleted: false });
    }
  }
  return { cursor: cursor ?? state.cursor, applied: 0, kept: seen.size - removed, migrated: 0, removed, received: docs.length };
}

/** Chiffre et envoie la file d'attente, par lots. */
async function push(db, remote, keys, uid) {
  const entries = await db.getAll('outbox');
  let sent = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const docs = [];
    for (const e of batch) {
      const rec = e.deleted ? null : await db.get(e.store, e.recId);
      const deleted = !rec;
      const updatedAt = rec?.updatedAt ?? e.updatedAt;
      const docId = await K.docId(keys, e.store, e.recId);
      let data = null;
      if (rec) {
        const { updatedAt: _t, ...rest } = rec; // la date voyage à part
        data = rest;
      }
      const box = await K.encryptJson(keys, { store: e.store, id: e.recId, data, updatedAt, deleted }, aadFor(uid, docId));
      docs.push({ docId, v: 1, ...box, updatedAt, deleted });
    }
    await remote.push(docs);
    // Retirer de la file seulement ce qui n'a pas changé pendant l'envoi.
    for (const e of batch) {
      const cur = await db.get('outbox', e.id);
      if (cur && cur.updatedAt === e.updatedAt && cur.deleted === e.deleted) await db.raw.delete('outbox', e.id);
    }
    sent += batch.length;
  }
  return sent;
}

const running = new WeakMap();

/**
 * Synchronise : relire, fusionner, envoyer. Une seule à la fois par base.
 * @returns {Promise<{received: number, applied: number, kept: number, migrated: number, sent: number}>}
 */
export function syncNow(db, remote, keys, { uid, now = () => new Date() }) {
  if (running.has(db)) return running.get(db);
  const p = (async () => {
    const state = await syncState(db);
    const r = await pull(db, remote, keys, uid, state);
    // Le curseur et l'arrivée sont notés avant l'envoi : un envoi interrompu reprendra depuis outbox.
    await db.put('settings', { ...state, cursor: r.cursor, joinedAt: state.joinedAt ?? now().toISOString(), replaceCloud: false });
    const sent = await push(db, remote, keys, uid);
    await db.put('settings', { ...(await syncState(db)), lastSyncAt: now().toISOString() });
    return { received: r.received, applied: r.applied, kept: r.kept, migrated: r.migrated, removed: r.removed ?? 0, sent };
  })();
  running.set(db, p);
  return p.finally(() => running.delete(db));
}

/** À appeler après une restauration : à la prochaine synchro, l'appareil remplace le cloud. */
export async function markReplaceCloud(db) {
  await db.put('settings', { ...(await syncState(db)), replaceCloud: true });
}

/** Nombre de changements pas encore envoyés. */
export const pendingCount = (db) => db.count('outbox');

/** Oublie l'état de synchro de l'appareil (déconnexion) : la prochaine fois, il « rejoint » à nouveau. */
export async function resetSyncState(db) {
  await db.delete('settings', SYNC_SETTINGS_ID);
}

// ---------- Faux cloud (tests, et essais sans réseau) ----------

/** Cloud en mémoire, même interface que l'adaptateur Firestore. `cursor` = compteur d'écritures. */
export function memoryRemote() {
  const keys = new Map();
  const docs = new Map(); // docId → { ...doc, syncedAt }
  let clock = 0;
  return {
    keys, docs,
    pushes: 0,
    async getKey(name) { return structuredClone(keys.get(name) ?? null); },
    async setKey(name, env) { keys.set(name, structuredClone(env)); },
    async listKeys() { return [...keys.entries()].map(([name, e]) => ({ name, ...structuredClone(e) })); },
    async pull(cursor) {
      const since = cursor ?? 0;
      const out = [...docs.values()].filter((d) => d.syncedAt > since).sort((a, b) => a.syncedAt - b.syncedAt);
      return { docs: out.map(({ syncedAt, ...d }) => structuredClone(d)), cursor: out.length ? out[out.length - 1].syncedAt : cursor };
    },
    async push(list) {
      if (list.length > BATCH) throw new Error('lot trop grand');
      this.pushes++;
      clock++; // un lot = une même heure de serveur
      for (const d of list) docs.set(d.docId, { ...structuredClone(d), syncedAt: clock });
    },
  };
}
