/**
 * store.js — Ouverture unique de la base de l'appareil, avec les données de départ.
 *
 * Version : 0.10.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version : IndexedDB + seed.json + navigator.storage.persist().
 *   0.4.0  FRE (Fidag)  Ajout des nouveaux éléments de départ aux bases existantes (cartes UBS).
 *   0.10.0 FRE (Fidag)  Base physique de schéma 4 (transition vers le coffre chiffré).
 */

import { openPhysicalDb, withTracking } from '../src/data/db.js';
import { installSeed, upgradeSeed } from '../src/core/reglages.js';

let ready = null;

/** Renvoie la base, prête à l'emploi (ouverte une seule fois). */
export function getDb() {
  if (!ready) {
    ready = (async () => {
      // Transition (0.10.0) : anciennes tables en clair ; le coffre chiffré est branché à l'étape suivante.
      const db = withTracking(await openPhysicalDb());
      const seed = await (await fetch('./src/data/seed.json')).json();
      if (!(await installSeed(db, seed))) await upgradeSeed(db, seed);
      // Demande à Safari de ne pas effacer les données quand l'appareil manque de place.
      try { await navigator.storage?.persist?.(); } catch { /* sans gravité */ }
      return db;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}
