/**
 * store.js — Base de l'app : disponible seulement quand l'app est déverrouillée.
 *
 * Version : 0.10.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * getDb() attend le déverrouillage (les écrans peuvent l'appeler à tout moment) ; openWithKeys()
 * ouvre la base chiffrée (coffre.js) avec la clé des données ; lockDb() l'oublie.
 * physicalDb() donne l'accès brut à IndexedDB (clés de l'appareil, effacement).
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version : IndexedDB + seed.json + navigator.storage.persist().
 *   0.4.0  FRE (Fidag)  Ajout des nouveaux éléments de départ aux bases existantes (cartes UBS).
 *   0.10.0 FRE (Fidag)  Base physique de schéma 4 (transition vers le coffre chiffré).
 *   0.10.2 FRE (Fidag)  Base chiffrée ouverte au déverrouillage, oubliée au verrouillage.
 */

import { openPhysicalDb } from '../src/data/db.js';
import { openVaultDb, migratePlain } from '../src/data/coffre.js';
import { installSeed, upgradeSeed } from '../src/core/reglages.js';

let phys = null;
let current = null; // base déverrouillée
let waiting = [];   // écrans qui attendent le déverrouillage

/** Accès brut à IndexedDB (tables « coffre » et « appareil »). */
export async function physicalDb() {
  if (!phys) {
    phys = openPhysicalDb();
    phys.catch(() => { phys = null; });
    // Demande à Safari de ne pas effacer les données quand l'appareil manque de place.
    try { await navigator.storage?.persist?.(); } catch { /* sans gravité */ }
  }
  return phys;
}

/** La base de l'app ; attend que l'app soit déverrouillée. */
export function getDb() {
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => waiting.push(resolve));
}

export const isUnlocked = () => Boolean(current);

/** Ouvre la base chiffrée avec la clé des données (après Face ID ou phrase de passe). */
export async function openWithKeys(keys) {
  const p = await physicalDb();
  const db = await openVaultDb(p, keys);
  await migratePlain(p, db); // données d'avant la version 0.10 : reprises puis effacées en clair
  const seed = await (await fetch('./src/data/seed.json')).json();
  if (!(await installSeed(db, seed))) await upgradeSeed(db, seed);
  current = db;
  const w = waiting;
  waiting = [];
  for (const resolve of w) resolve(db);
  return db;
}

/** Oublie la base déchiffrée (verrouillage). */
export function lockDb() {
  if (current) current.onChange = null;
  current = null;
}
