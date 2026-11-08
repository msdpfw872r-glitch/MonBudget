/**
 * format.js — Affichage en français de Suisse : montants et dates.
 *
 * Version : 0.2.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.2.0  FRE (Fidag)  Première version : formatCHF, formatAmount, formatDateLong, formatMonth.
 */

const APOS = '’'; // apostrophe typographique ’
const MINUS = '−'; // signe moins −

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

/** 1234.5 → "1’234.50" (valeur absolue, sans signe). */
function groupDigits(n) {
  const cents = Math.round(Math.abs(n) * 100);
  const units = Math.floor(cents / 100).toString();
  const dec = (cents % 100).toString().padStart(2, '0');
  return units.replace(/\B(?=(\d{3})+(?!\d))/g, APOS) + '.' + dec;
}

/** -1234.5 → "CHF −1’234.50" ; 1234.5 → "CHF 1’234.50". */
export function formatCHF(n, currency = 'CHF') {
  const sign = Math.round(n * 100) < 0 ? MINUS : '';
  return `${currency} ${sign}${groupDigits(n)}`;
}

/** Montant signé pour les listes : "+ 2’390.00" / "− 64.80". */
export function formatAmount(n) {
  const c = Math.round(n * 100);
  if (c === 0) return '0.00';
  return (c < 0 ? MINUS : '+') + ' ' + groupDigits(n);
}

function toDate(d) {
  if (d instanceof Date) return d;
  // "AAAA-MM-JJ" → date locale (évite le décalage de fuseau de new Date("AAAA-MM-JJ"))
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return new Date(d);
}

/** "mardi 14 octobre" (option capital : "Mardi 14 octobre"). */
export function formatDateLong(d, { capital = false } = {}) {
  const x = toDate(d);
  const s = `${JOURS[x.getDay()]} ${x.getDate()} ${MOIS[x.getMonth()]}`;
  return capital ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "Novembre 2026". */
export function formatMonth(d) {
  const x = toDate(d);
  const m = MOIS[x.getMonth()];
  return m[0].toUpperCase() + m.slice(1) + ' ' + x.getFullYear();
}
