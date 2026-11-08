/**
 * text.js — Outils communs : montants, dates, texte des opérations, empreintes.
 *
 * Version : 0.4.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.1.0  FRE (Fidag)  Première version.
 *   0.4.1  FRE (Fidag)  parseDateCH accepte une heure après la date.
 */

/** Enlève les accents et met en majuscules. */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

/**
 * Convertit un montant suisse en nombre : "8'700.00", "-2’550.00", "1 234,50", 125 → 125.
 * @returns {number}
 */
export function parseAmount(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Montant invalide');
    return v;
  }
  let s = String(v ?? '').trim();
  if (!s) throw new Error('Montant vide');
  s = s.replace(/[\s  '’`]/g, '').replace(/^CHF/i, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith('−')) s = '-' + s.slice(1);
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || s === '') throw new Error('Montant invalide : ' + v);
  return negative ? -n : n;
}

/** Montant en centimes entiers (pour comparer sans erreur d'arrondi). */
export function toCents(n) {
  return Math.round(n * 100);
}

/** Numéro de série Excel → 'AAAA-MM-JJ' (système 1900). */
export function excelSerialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Convertit une date suisse en 'AAAA-MM-JJ' : "31.10.2026", "31.10.26", "2026-10-31", ou numéro Excel.
 * @returns {string}
 */
export function parseDateCH(v) {
  if (typeof v === 'number') return excelSerialToIso(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  // Une heure éventuelle après la date (« 03.10.2026 14:22 ») est ignorée.
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return check(y, parseInt(m[2], 10), parseInt(m[1], 10), v);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return check(+m[1], +m[2], +m[3], v);
  throw new Error('Date invalide : ' + v);
}

function check(y, mo, d, original) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error('Date invalide : ' + original);
  }
  return dt.toISOString().slice(0, 10);
}

/**
 * Clé de reconnaissance d'un commerçant, utilisée par les règles retenues.
 * "MIGROS M SION 05.10.2026 CARTE 1234" → "MIGROS M SION CARTE"
 * On enlève dates, heures, numéros de carte masqués et longues suites de chiffres.
 */
export function merchantKey(description) {
  return fold(description)
    .replace(/\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/[X*]{2,}\d*/g, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^A-Z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Empreinte d'une opération, pour reconnaître les doublons d'un import à l'autre.
 * `occurrence` distingue deux opérations identiques le même jour dans un même fichier.
 */
export function fingerprint({ date, amount, accountRef, description }, occurrence = 0) {
  return [date, toCents(amount), fold(accountRef).replace(/\s+/g, ''), merchantKey(description), occurrence].join('|');
}
