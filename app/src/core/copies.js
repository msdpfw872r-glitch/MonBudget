/**
 * copies.js — Copies de sécurité en ligne : horodatées, chiffrées, 10 au plus, avec un commentaire.
 *
 * Version : 0.12.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Une copie = la sauvegarde complète (sauvegarde.js) compressée (gzip) puis chiffrée (clé des données),
 * découpée en morceaux (un document Firestore ne dépasse pas 1 Mo) :
 *   users/{uid}/copies/{id}               { v, createdAt (ms), parts, iv, ct = { comment, counts, appVersion, device } }
 *   users/{uid}/copies/{id}/parts/{n}     { iv, ct = morceau n }
 * Le commentaire et le contenu ne sont jamais lisibles par Firebase. Au-delà de 10 copies, la plus
 * ancienne est supprimée. Interface « remote » : listCopies, putCopy, getCopyParts, deleteCopy.
 * Ne dépend pas du navigateur (Node 22 et Safari 16.4+ : CompressionStream).
 *
 * Historique :
 *   0.12.0 FRE (Fidag)  Première version.
 */

import * as K from './chiffrement.js';
import { createBackup, readBackup } from './sauvegarde.js';

export const MAX_COPIES = 10;
export const MAX_COMMENT = 200;
const PART_SIZE = 600 * 1024; // octets chiffrés par morceau (≈ 800 Ko en base64)

const aadMeta = (uid, id) => `users/${uid}/copies/${id}/v1`;
const aadPart = (uid, id, n) => `users/${uid}/copies/${id}/parts/${n}/v1`;

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

/**
 * Fait une copie en ligne de toutes les données.
 * @returns {Promise<{id: string, createdAt: number, comment: string, counts: object, removed: string[]}>}
 */
export async function createCloudCopy(db, remote, keys, { uid, comment = '', device = '', appVersion = '', now = new Date() }) {
  const note = String(comment ?? '').trim().slice(0, MAX_COMMENT);
  const { text, backup } = await createBackup(db, { now, appVersion });
  const packed = await gzip(new TextEncoder().encode(text));
  const createdAt = now.getTime();
  const id = `${createdAt}-${[...K.randomBytes(3)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const parts = [];
  for (let i = 0, n = 0; i < Math.max(packed.length, 1); i += PART_SIZE, n++) {
    parts.push({ n, ...(await K.encryptBytes(keys, packed.subarray(i, i + PART_SIZE), aadPart(uid, id, n))) });
  }
  const meta = { comment: note, counts: backup.counts, appVersion, device };
  await remote.putCopy(id, { v: 1, createdAt, parts: parts.length, ...(await K.encryptJson(keys, meta, aadMeta(uid, id))) }, parts);
  // 10 au plus : les plus anciennes partent.
  const all = (await remote.listCopies()).sort((a, b) => b.createdAt - a.createdAt);
  const removed = [];
  for (const old of all.slice(MAX_COPIES)) {
    await remote.deleteCopy(old.id, old.parts);
    removed.push(old.id);
  }
  return { id, createdAt, ...meta, removed };
}

/**
 * Copies en ligne, de la plus récente à la plus ancienne (commentaire et nombres déchiffrés).
 * @returns {Promise<Array<{id, createdAt, parts, comment, counts, appVersion, device, readable}>>}
 */
export async function listCloudCopies(remote, keys, { uid }) {
  const out = [];
  for (const c of await remote.listCopies()) {
    try {
      out.push({ id: c.id, createdAt: c.createdAt, parts: c.parts, readable: true, ...(await K.decryptJson(keys, c, aadMeta(uid, c.id))) });
    } catch {
      out.push({ id: c.id, createdAt: c.createdAt, parts: c.parts, readable: false, comment: '', counts: null });
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Relit une copie : renvoie la sauvegarde vérifiée (comme un fichier), prête pour restoreBackup. */
export async function readCloudCopy(remote, keys, { uid, id, parts }) {
  const list = (await remote.getCopyParts(id, parts)).sort((a, b) => a.n - b.n);
  if (list.length !== parts) throw new K.ChiffrementError('Cette copie est incomplète et ne peut pas être utilisée.');
  const chunks = [];
  for (const p of list) chunks.push(await K.decryptBytes(keys, p, aadPart(uid, id, p.n)));
  const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return readBackup(new TextDecoder().decode(await gunzip(all)));
}

export async function deleteCloudCopy(remote, { id, parts }) {
  await remote.deleteCopy(id, parts);
}
