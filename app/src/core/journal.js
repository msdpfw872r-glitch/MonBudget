/**
 * journal.js — Journal et résumé du mois : filtres, totaux, export pour Numbers / Excel.
 *
 * Version : 0.5.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Règles des totaux (CLAUDE.md § 4) :
 *   - les catégories « ne pas compter dans les totaux » (virements, épargne, facture de carte…)
 *     sont exclues ; les achats par carte comptent, jamais le prélèvement de la facture ;
 *   - les opérations pas encore triées ne sont pas comptées (elles sont signalées à part).
 * Montants en centimes entiers pour éviter les erreurs d'arrondi.
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version.
 */

import { toCents } from './text.js';

/** "2026-10-14" → "2026-10". */
export const monthOf = (date) => String(date).slice(0, 7);

/** Mois qui ont des opérations, du plus récent au plus ancien. */
export function monthsWithData(transactions) {
  return [...new Set(transactions.map((t) => monthOf(t.date)))].sort().reverse();
}

/** Mois précédent / suivant : "2026-01" → "2025-12". */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * Opérations d'un mois, filtrées par personne, de la plus récente à la plus ancienne.
 * @param {object} f
 * @param {string} f.month       "AAAA-MM"
 * @param {string|null} [f.personId]  null = tout le monde
 */
export function journal(transactions, { month, personId = null }) {
  return transactions
    .filter((t) => monthOf(t.date) === month && (!personId || t.personId === personId))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Vrai si l'opération compte dans les totaux. */
export function counts(t, categoriesById) {
  if (t.status !== 'classee') return false;
  if (t.isCardBillPayment) return false;
  const c = categoriesById.get(t.categoryId);
  return Boolean(c) && !c.excludeFromTotals;
}

/**
 * Résumé d'un mois.
 * @returns {{
 *   income: number, expenses: number, balance: number,
 *   byPerson: {personId: string, expenses: number, income: number}[],
 *   byCategory: {categoryId: string, type: string, total: number, count: number}[],
 *   excluded: {count: number}, toSort: {count: number, total: number}
 * }} montants en francs (dépenses positives)
 */
export function monthSummary(transactions, categories, { month, personId = null }) {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const list = journal(transactions, { month, personId });
  let income = 0;
  let expenses = 0;
  const persons = new Map();
  const byCat = new Map();
  let excluded = 0;
  let toSortCount = 0;
  let toSortTotal = 0;
  for (const t of list) {
    const cents = toCents(t.amount);
    if (t.status !== 'classee') { toSortCount++; toSortTotal += cents; continue; }
    if (!counts(t, cats)) { excluded++; continue; }
    const p = persons.get(t.personId) ?? { personId: t.personId, expenses: 0, income: 0 };
    if (cents < 0) { expenses -= cents; p.expenses -= cents; } else { income += cents; p.income += cents; }
    persons.set(t.personId, p);
    const c = byCat.get(t.categoryId) ?? { categoryId: t.categoryId, type: cats.get(t.categoryId)?.type, total: 0, count: 0 };
    c.total += cents;
    c.count++;
    byCat.set(t.categoryId, c);
  }
  const fr = (c) => c / 100;
  return {
    income: fr(income),
    expenses: fr(expenses),
    balance: fr(income - expenses),
    byPerson: [...persons.values()]
      .map((p) => ({ ...p, expenses: fr(p.expenses), income: fr(p.income) }))
      .sort((a, b) => b.expenses - a.expenses),
    // Catégories de dépense : la plus grosse d'abord (montant positif) ; rentrées ensuite.
    byCategory: [...byCat.values()]
      .map((c) => ({ ...c, total: fr(Math.abs(c.total)), type: c.type ?? (c.total < 0 ? 'depense' : 'recette') }))
      .sort((a, b) => (a.type === b.type ? b.total - a.total : a.type === 'depense' ? -1 : 1)),
    excluded: { count: excluded },
    toSort: { count: toSortCount, total: fr(toSortTotal) },
  };
}

/** Échappe une cellule pour un fichier « ; » (Numbers, Excel en Suisse). */
function cell(v) {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Fichier du mois pour Numbers ou Excel : séparateur « ; », montants avec un point,
 * dates JJ.MM.AAAA, une ligne par opération, totaux à la fin.
 * @returns {string} texte avec BOM UTF-8 (Excel reconnaît les accents)
 */
export function exportMonth(transactions, { month, personId = null, categories, people, accounts }) {
  const C = new Map(categories.map((c) => [c.id, c]));
  const P = new Map(people.map((p) => [p.id, p]));
  const A = new Map(accounts.map((a) => [a.id, a]));
  const rows = [['Date', 'Compte', 'Pour qui', 'Catégorie', 'Texte de la banque', 'Montant', 'Monnaie', 'Compté dans les totaux']];
  for (const t of [...journal(transactions, { month, personId })].reverse()) {
    const [y, m, d] = t.date.split('-');
    rows.push([
      `${d}.${m}.${y}`,
      A.get(t.accountId)?.name ?? '',
      t.status === 'classee' ? (P.get(t.personId)?.name ?? '') : 'À trier',
      t.status === 'classee' ? (C.get(t.categoryId)?.name ?? '') : 'À trier',
      t.description,
      (toCents(t.amount) / 100).toFixed(2),
      t.currency ?? 'CHF',
      counts(t, C) ? 'oui' : 'non',
    ]);
  }
  const s = monthSummary(transactions, categories, { month, personId });
  rows.push([], ['Rentrées', '', '', '', '', s.income.toFixed(2)], ['Dépenses', '', '', '', '', (-s.expenses).toFixed(2)], ['Reste', '', '', '', '', s.balance.toFixed(2)]);
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
