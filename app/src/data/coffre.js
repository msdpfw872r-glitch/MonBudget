/**
 * coffre.js — Base de l'app chiffrée sur l'appareil.
 *
 * Version : 0.10.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Après le déverrouillage (Face ID ou phrase de passe), toutes les données sont déchiffrées EN MÉMOIRE ;
 * chaque écriture est aussitôt chiffrée (AES-GCM, clé des données) dans la table IndexedDB « coffre ».
 * Dans IndexedDB il n'y a donc que : { id: nom illisible (HMAC), iv, ct }. Au verrouillage, la
 * mémoire est simplement abandonnée.
 * Même interface que les autres bases (db.js), avec le suivi des changements pour la synchronisation.
 *
 * Historique :
 *   0.10.0 FRE (Fidag)  Première version.
 */

import { STORES, openRawMemoryDb, withTracking } from './db.js';
import { docId, encryptJson, decryptJson, ChiffrementError } from '../core/chiffrement.js';

const LOCAL_NS = 'local:';
const aad = (k) => `coffre/${k}/v1`;

/**
 * Ouvre la base chiffrée.
 * @param {object} phys  base physique (openPhysicalDb, ou openRawMemoryDb(PHYSICAL_STORES) en test)
 * @param {{aes: CryptoKey, hmac: CryptoKey}} keys  clé des données ouverte
 * @param {{now?: () => number}} [opts]
 */
export async function openVaultDb(phys, keys, { now } = {}) {
  const mem = openRawMemoryDb();
  for (const box of await phys.getAll('coffre')) {
    let rec;
    try {
      rec = await decryptJson(keys, box, aad(box.id));
    } catch {
      throw new ChiffrementError('Les données de cet appareil ne s’ouvrent pas avec cette clé.');
    }
    if (rec.store in STORES) await mem.put(rec.store, rec.data);
  }
  return withTracking(encryptedBase(mem, phys, keys), now);
}

/** Base en mémoire dont chaque écriture est recopiée chiffrée dans la table « coffre ». */
function encryptedBase(mem, phys, keys) {
  const keyOf = (s, id) => docId(keys, LOCAL_NS + s, id);
  const seal = async (s, obj) => {
    const id = await keyOf(s, obj.id);
    return { id, ...(await encryptJson(keys, { store: s, data: obj }, aad(id))) };
  };
  return {
    kind: 'coffre',
    get: (s, id) => mem.get(s, id),
    getAll: (s) => mem.getAll(s),
    count: (s) => mem.count(s),
    countWhere: (s, f, v) => mem.countWhere(s, f, v),
    getAllWhere: (s, f, v) => mem.getAllWhere(s, f, v),
    async put(s, obj) {
      await mem.put(s, obj);
      await phys.put('coffre', await seal(s, obj));
      return obj;
    },
    async putMany(s, objs) {
      await mem.putMany(s, objs);
      const boxes = [];
      for (const o of objs) boxes.push(await seal(s, o));
      if (boxes.length) await phys.putMany('coffre', boxes);
      return objs.length;
    },
    async delete(s, id) {
      await mem.delete(s, id);
      await phys.delete('coffre', await keyOf(s, id));
    },
    async clear(s) {
      const ids = (await mem.getAll(s)).map((o) => o.id);
      await mem.clear(s);
      const ks = [];
      for (const id of ids) ks.push(await keyOf(s, id));
      if (ks.length) await phys.deleteMany('coffre', ks);
    },
    close() {},
  };
}

/**
 * Reprend les données des anciennes tables en clair (avant la version 0.10.0) dans la base chiffrée,
 * puis vide ces tables. Les dates de modification sont gardées.
 * @returns {Promise<number>} nombre d'éléments repris
 */
export async function migratePlain(phys, db) {
  let n = 0;
  for (const s of Object.keys(STORES)) {
    const all = await phys.getAll(s);
    if (!all.length) continue;
    await db.raw.putMany(s, all);
    await phys.clear(s);
    n += all.length;
  }
  return n;
}

/** Y a-t-il des données chiffrées sur l'appareil ? */
export async function hasVaultData(phys) {
  return (await phys.count('coffre')) > 0;
}

/** Efface tout ce qui est sur l'appareil (déconnexion). */
export async function wipeDevice(phys) {
  for (const s of [...Object.keys(STORES), 'coffre', 'appareil']) await phys.clear(s);
}
