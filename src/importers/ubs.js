/**
 * ubs.js — Import de l'export « Transactions » de l'e-banking UBS (Excel .xlsx).
 *
 * Version : 0.1.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Format reconnu (en-têtes en français, une ligne par opération) :
 *   Date de transaction | Numéro de compte ou de carte | Description |
 *   Revenu ou dépense   | Montant | Monnaie | Catégorie
 *
 * Le fichier peut contenir à la fois le compte (IBAN) et des cartes UBS (****1234).
 *
 * Historique :
 *   0.1.0  FRE (Fidag)  Première version, d'après un export anonymisé d'octobre 2026.
 */

import { fold, parseAmount, parseDateCH, fingerprint } from '../core/text.js';

export const FORMAT_ID = 'ubs-transactions-xlsx';
export const FORMAT_LABEL = 'UBS — export des transactions (Excel)';

/** Colonnes attendues → noms possibles de l'en-tête (comparés sans accents ni casse). */
const COLUMNS = {
  date: ['Date de transaction'],
  accountRef: ['Numéro de compte ou de carte'],
  description: ['Description'],
  direction: ['Revenu ou dépense'],
  amount: ['Montant'],
  currency: ['Monnaie'],
  bankCategory: ['Catégorie'],
};
const REQUIRED = ['date', 'description', 'amount'];

/** Catégories UBS qui indiquent un paiement de facture de carte (à ne pas compter deux fois). */
const CARD_BILL_CATEGORIES = ['FACTURES DE CARTE DE CREDIT'];
const CARD_BILL_WORDS = /\bFACTURE CARTE\b|\bDECOMPTE CARTE\b|\bSWISSCARD\b/;

function findHeader(rows) {
  const limit = Math.min(rows.length, 25);
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map((c) => fold(c));
    const map = {};
    for (const [key, names] of Object.entries(COLUMNS)) {
      const idx = cells.findIndex((c) => names.some((n) => fold(n) === c));
      if (idx >= 0) map[key] = idx;
    }
    if (REQUIRED.every((k) => k in map) && ('direction' in map || 'accountRef' in map)) return { row: r, map };
  }
  return null;
}

/** Vrai si ces lignes ressemblent à un export UBS. */
export function detect(rows) {
  return findHeader(rows) !== null;
}

function isBlank(row) {
  return !row || row.every((c) => c == null || String(c).trim() === '');
}

/**
 * Transforme les lignes d'un export UBS en opérations normalisées.
 * @param {any[][]} rows  lignes de la première feuille
 * @returns {{format: string, transactions: object[], warnings: string[], period: {from: string, to: string}|null, accounts: string[]}}
 */
export function parse(rows) {
  const header = findHeader(rows);
  if (!header) throw new Error("Ce fichier ne ressemble pas à un export UBS (colonnes « Date de transaction », « Description », « Montant » introuvables).");
  const { row: headerRow, map } = header;
  const get = (row, key) => (key in map ? row[map[key]] : null);

  const transactions = [];
  const warnings = [];
  const seen = new Map();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlank(row)) continue;
    const line = r + 1;
    try {
      const date = parseDateCH(get(row, 'date'));
      const description = String(get(row, 'description') ?? '').trim();
      let amount = parseAmount(get(row, 'amount'));
      const direction = fold(get(row, 'direction'));
      if (direction.startsWith('DEPENSE') && amount > 0) {
        amount = -amount;
        warnings.push(`Ligne ${line} : dépense avec un montant positif, signe corrigé.`);
      } else if (direction.startsWith('REVENU') && amount < 0) {
        amount = -amount;
        warnings.push(`Ligne ${line} : revenu avec un montant négatif, signe corrigé.`);
      }
      const accountRef = String(get(row, 'accountRef') ?? '').trim();
      const accountKind = /^\*+\d+$|\*{2,}/.test(accountRef.replace(/\s/g, '')) ? 'carte' : 'compte';
      const currency = String(get(row, 'currency') ?? 'CHF').trim() || 'CHF';
      const bankCategory = String(get(row, 'bankCategory') ?? '').trim() || null;
      const isCardBillPayment =
        accountKind === 'compte' &&
        amount < 0 &&
        (CARD_BILL_CATEGORIES.includes(fold(bankCategory)) || CARD_BILL_WORDS.test(fold(description)));

      const base = { date, amount, accountRef, description };
      const key = fingerprint(base, 0);
      const occurrence = seen.get(key) || 0;
      seen.set(key, occurrence + 1);

      transactions.push({
        id: fingerprint(base, occurrence),
        source: FORMAT_ID,
        date,
        accountRef,
        accountKind,
        description,
        amount,
        currency,
        bankCategory,
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
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    accounts: [...new Set(transactions.map((t) => t.accountRef))],
  };
}

/**
 * Garde seulement les opérations pas encore importées.
 * @param {Iterable<string>} existingIds  empreintes déjà enregistrées
 */
export function onlyNew(transactions, existingIds) {
  const known = new Set(existingIds);
  return transactions.filter((t) => !known.has(t.id));
}
