/**
 * sauvegarde.js — Sauvegarde et restauration de toutes les données, rappel de sauvegarde.
 *
 * Version : 0.8.6
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Fichier : MonBudget_AAAA-MM-JJ_HH-MM-SS-mmm.json (heure locale, jusqu'à la milliseconde : deux
 * sauvegardes n'ont jamais le même nom). Contenu : toutes les données + règles + versions.
 * Restaurer remplace TOUTES les données ; en cas d'échec en cours de route, l'état d'avant est remis.
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.6.0  FRE (Fidag)  Première version.
 *   0.8.2  FRE (Fidag)  La table outbox (synchronisation) n'est pas mise dans la sauvegarde.
 *   0.8.4  FRE (Fidag)  Après une restauration, la prochaine synchro remplace les données du cloud.
 *   0.8.6  FRE (Fidag)  Le réglage « appareil » (passkey de cet iPad) reste sur l'appareil.
 */

import { BACKUP_STORES as STORE_NAMES, SCHEMA_VERSION } from '../data/db.js';
import { ReglageError, DATA_VERSION } from './reglages.js';

export const BACKUP_FORMAT = 'mon-budget-sauvegarde';
export const BACKUP_FORMAT_VERSION = 1;
export const REMINDER_DAYS = 30;
const SYNC_ID = 'sync';
/** Réglages propres à l'appareil (synchro, passkey) : jamais dans une sauvegarde. */
const DEVICE_IDS = [SYNC_ID, 'appareil'];

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** « MonBudget_2026-11-09_14-03-27-123.json » (heure locale de l'appareil). */
export function backupFileName(now = new Date()) {
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  return `MonBudget_${d}_${t}.json`;
}

/** Nombre d'éléments par genre, pour l'affichage. */
export function countsOf(data) {
  return {
    transactions: data.transactions?.length ?? 0,
    rules: data.rules?.length ?? 0,
    people: data.people?.length ?? 0,
    accounts: data.accounts?.length ?? 0,
    categories: data.categories?.length ?? 0,
    imports: data.imports?.length ?? 0,
  };
}

async function readAll(db) {
  const data = {};
  for (const store of STORE_NAMES) data[store] = await db.getAll(store);
  // L'état de synchro est propre à chaque appareil : il ne voyage pas dans la sauvegarde.
  data.settings = data.settings.filter((o) => !DEVICE_IDS.includes(o.id));
  return data;
}

/**
 * Crée la sauvegarde complète.
 * @returns {Promise<{fileName: string, text: string, backup: object}>}
 */
export async function createBackup(db, { now = new Date(), appVersion = '' } = {}) {
  const data = await readAll(db);
  const backup = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    createdAt: now.toISOString(),
    counts: countsOf(data),
    data,
  };
  return { fileName: backupFileName(now), text: JSON.stringify(backup), backup };
}

/** Note que la sauvegarde a été faite (pour le rappel). */
export async function markBackupDone(db, now = new Date()) {
  const s = await db.get('settings', 'app');
  await db.put('settings', { ...(s ?? { id: 'app' }), lastBackupAt: now.toISOString() });
}

/**
 * Lit et vérifie un fichier de sauvegarde. Les messages d'erreur sont en mots simples.
 * @returns {{createdAt: string, appVersion: string, counts: object, data: object}}
 */
export function readBackup(text) {
  let b;
  try {
    b = JSON.parse(String(text ?? '').replace(/^﻿/, ''));
  } catch {
    throw new ReglageError('Ce fichier n’est pas une sauvegarde de Mon Budget. Choisissez un fichier « MonBudget_… ».');
  }
  if (!b || b.format !== BACKUP_FORMAT || typeof b.data !== 'object' || !b.data) {
    throw new ReglageError('Ce fichier n’est pas une sauvegarde de Mon Budget. Choisissez un fichier « MonBudget_… ».');
  }
  if (b.formatVersion > BACKUP_FORMAT_VERSION || b.schemaVersion > SCHEMA_VERSION) {
    throw new ReglageError('Cette sauvegarde vient d’une version plus récente de l’app. Mettez d’abord l’app à jour, puis réessayez.');
  }
  for (const store of STORE_NAMES) {
    const list = b.data[store] ?? [];
    if (!Array.isArray(list) || list.some((o) => !o || typeof o !== 'object' || o.id === undefined || o.id === null)) {
      throw new ReglageError('Cette sauvegarde est abîmée et ne peut pas être utilisée. Essayez une autre sauvegarde.');
    }
  }
  if (!(b.data.categories ?? []).length || !(b.data.people ?? []).length) {
    throw new ReglageError('Cette sauvegarde est incomplète et ne peut pas être utilisée. Essayez une autre sauvegarde.');
  }
  const data = Object.fromEntries(STORE_NAMES.map((s) => [s, b.data[s] ?? []]));
  data.settings = data.settings.filter((o) => !DEVICE_IDS.includes(o.id));
  return { createdAt: b.createdAt ?? null, appVersion: b.appVersion ?? '', counts: countsOf(data), data };
}

async function replaceAll(db, data) {
  for (const store of STORE_NAMES) {
    await db.clear(store);
    if (data[store]?.length) await db.putMany(store, data[store]);
  }
}

/**
 * Remplace TOUTES les données par celles de la sauvegarde.
 * Si quelque chose échoue en cours de route, les données d'avant sont remises.
 */
export async function restoreBackup(db, backup, now = new Date()) {
  const before = await readAll(db);
  const sync = await db.get('settings', SYNC_ID);
  const device = await db.get('settings', 'appareil');
  try {
    await replaceAll(db, backup.data);
    const s = await db.get('settings', 'app');
    await db.put('settings', {
      ...(s ?? { id: 'app', seededAt: now.toISOString() }),
      id: 'app',
      restoredAt: now.toISOString(),
      // La sauvegarde qu'on vient de remettre est, de fait, sauvegardée.
      lastBackupAt: s?.lastBackupAt ?? backup.createdAt ?? now.toISOString(),
    });
    // Synchronisation : à la prochaine fois, ces données remplacent celles du cloud.
    await db.put('settings', { ...(sync ?? { id: SYNC_ID, cursor: null, joinedAt: null }), replaceCloud: true });
    if (device) await db.put('settings', device);
  } catch (e) {
    await replaceAll(db, before);
    if (sync) await db.put('settings', sync);
    if (device) await db.put('settings', device);
    throw new ReglageError('La restauration n’a pas marché. Vos données d’avant ont été remises. Réessayez.', { cause: e });
  }
  return countsOf(backup.data);
}

/**
 * Faut-il rappeler de sauvegarder ?
 * @returns {{due: boolean, reason: 'jamais'|'ancienne'|'import'|null, days: number|null}}
 */
export function backupReminder(settings, { hasData, now = new Date() }) {
  if (!hasData) return { due: false, reason: null, days: null };
  const last = settings?.lastBackupAt ? new Date(settings.lastBackupAt) : null;
  if (!last) return { due: true, reason: 'jamais', days: null };
  const days = Math.floor((now - last) / 86400000);
  if (days >= REMINDER_DAYS) return { due: true, reason: 'ancienne', days };
  if (settings?.lastImportAt && new Date(settings.lastImportAt) > last) return { due: true, reason: 'import', days };
  return { due: false, reason: null, days };
}
