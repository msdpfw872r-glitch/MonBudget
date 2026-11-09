/**
 * bcvs.js — Import du relevé de compte BCVs (Banque Cantonale du Valais), fichier CSV.
 *
 * Version : 0.7.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Format reconnu (d'après un vrai fichier de novembre 2026, structure seulement) :
 *   - en tête, quelques lignes : « Relevé de compte jusqu'au: JJ.MM.AAAA », « N° de compte: K 0000.00.00 »,
 *     « Description: Compte Privé », « Solde: CHF … », nom et adresse ;
 *   - puis le tableau : Date ; Libellé ; Montant ; Valeur (dates JJ.MM.AA, montants signés « -150.00 ») ;
 *   - séparateur « ; », accents Windows (lus par csv.js).
 * Le prélèvement de la facture de carte (« Débit LSV SWISSCARD … ») est reconnu.
 *
 * Historique :
 *   0.7.0  FRE (Fidag)  Première version.
 */

import { fold, parseAmount, parseDateCH, fingerprint } from '../core/text.js';

export const FORMAT_ID = 'bcvs-csv';
export const FORMAT_LABEL = 'BCVs — relevé de compte';

const HEAD = { date: ['DATE'], description: ['LIBELLE', 'TEXTE', 'BUCHUNGSTEXT'], amount: ['MONTANT', 'BETRAG'], value: ['VALEUR', 'VALUTA'] };

/** Prélèvement de la facture d'une carte de crédit (à ne pas compter deux fois). */
const CARD_BILL_WORDS = /\bSWISSCARD\b|\bVISECA\b|\bCORNERCARD\b|\bCORNER BANCA\b|\bCARD CENTER\b|\bFACTURE CARTE\b|\bDECOMPTE CARTE\b/;

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = (rows[r] || []).map((c) => fold(c));
    const idx = (names) => cells.findIndex((c) => names.includes(c));
    const map = { date: idx(HEAD.date), description: idx(HEAD.description), amount: idx(HEAD.amount), value: idx(HEAD.value) };
    if (map.date >= 0 && map.description >= 0 && map.amount >= 0) return { row: r, map };
  }
  return null;
}

/** Valeur écrite après « libellé : » dans les lignes au-dessus du tableau. */
function meta(rows, headerRow, pattern) {
  for (let r = 0; r < headerRow; r++) {
    const line = (rows[r] || []).join(' ');
    const m = pattern.exec(line);
    if (m) return m[1].replace(/;+$/, '').trim();
  }
  return '';
}

/** Vrai si ces lignes ressemblent à un relevé BCVs. */
export function detect(rows) {
  const h = findHeader(rows);
  if (!h) return false;
  // En-tête propre à la BCVs : « Relevé de compte » et « N° de compte » au-dessus du tableau.
  const above = rows.slice(0, h.row).map((r) => fold((r || []).join(' '))).join(' | ');
  return /RELEVE DE COMPTE/.test(above) && /N.? ?DE COMPTE/.test(above);
}

/**
 * @returns {{format: string, transactions: object[], warnings: string[], period: object|null, accounts: string[]}}
 */
export function parse(rows) {
  const h = findHeader(rows);
  if (!h) throw new Error('Ce fichier ne ressemble pas à un relevé BCVs (colonnes « Date », « Libellé », « Montant » introuvables).');
  const { row: headerRow, map } = h;
  const accountRef = meta(rows, headerRow, /N\S{0,2}\s*de compte\s*:\s*([^;]+)/i) || 'BCVS';
  const transactions = [];
  const warnings = [];
  const seen = new Map();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.every((c) => String(c ?? '').trim() === '')) continue;
    const line = r + 1;
    try {
      const date = parseDateCH(row[map.date]);
      const description = String(row[map.description] ?? '').trim();
      const amount = parseAmount(row[map.amount]);
      const isCardBillPayment = amount < 0 && CARD_BILL_WORDS.test(fold(description));
      const base = { date, amount, accountRef, description };
      const key = fingerprint(base, 0);
      const occurrence = seen.get(key) || 0;
      seen.set(key, occurrence + 1);
      transactions.push({
        id: fingerprint(base, occurrence),
        source: FORMAT_ID,
        date,
        accountRef,
        accountKind: 'compte',
        description,
        amount,
        currency: 'CHF',
        bankCategory: null,
        isCardBillPayment,
        sourceLine: line,
      });
    } catch (err) {
      warnings.push(`Ligne ${line} ignorée : ${err.message}`);
    }
  }
  const dates = transactions.map((t) => t.date).sort();
  return {
    format: FORMAT_ID,
    transactions,
    warnings,
    period: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
    accounts: [...new Set(transactions.map((t) => t.accountRef))],
  };
}
