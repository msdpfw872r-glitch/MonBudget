/**
 * journal.js — Journal et résumé du mois : filtres, totaux, export pour Numbers / Excel.
 *
 * Version : 0.5.2
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
 *   0.5.1  FRE (Fidag)  Périodes quelconques (from / to), recherche d'opérations, mois par mois, export d'une période.
 *   0.5.2  FRE (Fidag)  detailOperations : les opérations qui composent un montant affiché.
 */

import { toCents, fold } from './text.js';
import { monthsIn } from './periode.js';

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
export function journal(transactions, { month = null, from = null, to = null, personId = null }) {
  const inside = month ? (t) => monthOf(t.date) === month : (t) => (!from || t.date >= from) && (!to || t.date <= to);
  return transactions
    .filter((t) => inside(t) && (!personId || t.personId === personId))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/**
 * Cherche des opérations : chaque mot tapé doit se trouver dans le texte de la banque, le nom du
 * commerce, la catégorie, la personne, le compte, la date (JJ.MM.AAAA) ou le montant (« 64.80 », « 64,80 »).
 * Sans tenir compte des accents ni des majuscules.
 * @param {{categoriesById?: Map, peopleById?: Map, accountsById?: Map, nameOf?: (t) => string}} [ctx]
 */
export function searchOperations(list, query, ctx = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((t) => {
    const [y, m, d] = t.date.split('-');
    const amount = (Math.abs(toCents(t.amount)) / 100).toFixed(2);
    const hay = fold([
      t.description,
      ctx.nameOf?.(t),
      t.status === 'classee' ? ctx.categoriesById?.get(t.categoryId)?.name : 'à trier',
      ctx.peopleById?.get(t.personId)?.name,
      ctx.accountsById?.get(t.accountId)?.name,
      `${d}.${m}.${y}`,
      amount, amount.replace('.', ','),
    ].filter(Boolean).join(' | '));
    return words.every((w) => hay.includes(w));
  });
}

/** Totaux par mois sur une période (pour l'année ou des dates libres). */
export function summaryByMonth(transactions, categories, { from, to, personId = null }) {
  return monthsIn({ from, to }).map((month) => {
    const lo = from > `${month}-01` ? from : `${month}-01`;
    const hi = to < `${month}-31` ? to : `${month}-31`;
    const s = monthSummary(transactions, categories, { from: lo, to: hi, personId });
    return { month, income: s.income, expenses: s.expenses, balance: s.balance };
  });
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
export function monthSummary(transactions, categories, { month = null, from = null, to = null, personId = null }) {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const list = journal(transactions, { month, from, to, personId });
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
export function exportMonth(transactions, { month = null, from = null, to = null, personId = null, list = null, categories, people, accounts }) {
  const C = new Map(categories.map((c) => [c.id, c]));
  const P = new Map(people.map((p) => [p.id, p]));
  const A = new Map(accounts.map((a) => [a.id, a]));
  const rows = [['Date', 'Compte', 'Pour qui', 'Catégorie', 'Texte de la banque', 'Montant', 'Monnaie', 'Compté dans les totaux']];
  // `list` : opérations déjà choisies (par ex. le résultat d'une recherche).
  for (const t of [...(list ?? journal(transactions, { month, from, to, personId }))].reverse()) {
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
  const s = list ? summaryOf(list, categories) : monthSummary(transactions, categories, { month, from, to, personId });
  rows.push([], ['Rentrées', '', '', '', '', s.income.toFixed(2)], ['Dépenses', '', '', '', '', (-s.expenses).toFixed(2)], ['Reste', '', '', '', '', s.balance.toFixed(2)]);
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/** Totaux d'une liste d'opérations déjà choisie (résultat de recherche). */
export function summaryOf(list, categories) {
  return monthSummary(list, categories, {});
}

/**
 * Opérations qui composent un montant affiché (pour « toucher un montant → voir le détail »).
 * Le total de la liste renvoyée est exactement le montant affiché.
 * @param {object} f  période et personne : { from, to, personId }
 * @param {{kind: 'income'|'expenses'|'balance'|'category'|'person'|'excluded'|'toSort', id?: string}} what
 * @returns {object[]} du plus récent au plus ancien
 */
export function detailOperations(transactions, categories, f, what) {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const list = journal(transactions, f);
  const counted = (t) => counts(t, cats);
  const keep = {
    income: (t) => counted(t) && t.amount > 0,
    expenses: (t) => counted(t) && t.amount < 0,
    balance: counted,
    category: (t) => counted(t) && t.categoryId === what.id,
    person: (t) => counted(t) && t.personId === what.id && t.amount < 0,
    excluded: (t) => t.status === 'classee' && !counted(t),
    toSort: (t) => t.status !== 'classee',
  }[what.kind];
  return keep ? list.filter(keep) : [];
}

/** Total d'une liste d'opérations, en francs (centimes exacts). */
export function totalOf(list) {
  return list.reduce((s, t) => s + toCents(t.amount), 0) / 100;
}
