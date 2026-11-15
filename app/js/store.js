/**
 * store.js — Base de l'app : disponible seulement quand l'app est déverrouillée.
 *
 * Version : 0.18.1
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
 *   0.16.0 FRE (Fidag)  Nouvelle version de l'app : les opérations à trier sont relues (entretien.js).
 *   0.18.1 FRE (Fidag)  … et les factures de carte qui correspondent exactement sont rattachées.
 */

import { openPhysicalDb } from '../src/data/db.js';
import { openVaultDb, migratePlain } from '../src/data/coffre.js';
import { installSeed, upgradeSeed } from '../src/core/reglages.js';
import { refreshPending } from '../src/core/entretien.js';
import { autoLinkAll } from '../src/core/cartes.js';
import { APP_VERSION } from './version.js';

let phys = null;
let current = null; // base déverrouillée
let waiting = [];   // écrans qui attendent le déverrouillage
let updateNote = null; // résultat de la relecture après une mise à jour (affiché une fois sur l'accueil)

/** Message « l'app a été mise à jour » à afficher une fois (puis oublié). */
export function takeUpdateNote() {
  const n = updateNote;
  updateNote = null;
  return n;
}

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
  // Nouvelle version : les opérations à trier sont relues (meilleure lecture des fichiers, règles).
  const app = await db.get('settings', 'app');
  if (app && app.appVersion !== APP_VERSION) {
    try {
      const r = await refreshPending(db);
      r.factures = await autoLinkAll(db); // factures de carte qui correspondent exactement
      if (r.corrigees || r.classees || r.factures) updateNote = { version: APP_VERSION, ...r };
    } catch { /* sans gravité : réessayé à la prochaine ouverture */ }
    await db.put('settings', { ...(await db.get('settings', 'app')), appVersion: APP_VERSION });
  }
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
