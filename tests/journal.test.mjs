/**
 * journal.test.mjs — Tests du journal, des totaux du mois et de l'export.
 * Lancer : npm test
 *
 * Version : 0.5.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version.
 *   0.5.2  FRE (Fidag)  Détail d'un montant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { journal, monthSummary, monthsWithData, shiftMonth, exportMonth, counts, detailOperations, totalOf, summaryByMonth } from '../app/src/core/journal.js';
import { parseCsv } from '../app/src/core/csv.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
let n = 0;
const tx = (date, amount, personId, categoryId, extra = {}) => ({
  id: `t${++n}`, date, amount, personId, categoryId, status: 'classee', accountId: 'ubs', description: `OP ${n}`, currency: 'CHF', ...extra,
});

/** Octobre : rente, loyer, achats des deux cartes, facture de carte, virement, une opération à trier. */
const DATA = [
  tx('2026-10-31', 2390, 'papa', 'rente-avs'),
  tx('2026-10-28', 1820.5, 'maman', 'rente-lpp-2e-pilier'),
  tx('2026-10-02', -2550, 'menage', 'logement-loyer-hypotheque'),
  tx('2026-10-03', -64.8, 'menage', 'alimentation-et-courses', { accountId: 'carte-ubs-maman', cardBillId: 'bill' }),
  tx('2026-10-10', -23.5, 'maman', 'pharmacie', { accountId: 'carte-ubs-maman', cardBillId: 'bill' }),
  tx('2026-10-05', -120, 'papa', 'voiture', { accountId: 'carte-ubs-papa', cardBillId: 'bill' }),
  tx('2026-10-12', -30.2, 'menage', 'alimentation-et-courses', { accountId: 'carte-ubs-papa', cardBillId: 'bill' }),
  { ...tx('2026-10-26', -238.5, null, 'paiement-facture-carte'), id: 'bill', isCardBillPayment: true },
  tx('2026-10-15', -500, 'menage', 'virement-sortant'),
  tx('2026-10-20', -45.15, null, null, { status: 'a-trier' }),
  tx('2026-09-30', -99.99, 'maman', 'cadeaux'),
  tx('2026-11-02', -10, 'papa', 'restaurants'),
];

test('mois disponibles et navigation entre les mois', () => {
  assert.deepEqual(monthsWithData(DATA), ['2026-11', '2026-10', '2026-09']);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-10', 0), '2026-10');
});

test('journal : mois, personne, du plus récent au plus ancien', () => {
  const oct = journal(DATA, { month: '2026-10' });
  assert.equal(oct.length, 10);
  assert.equal(oct[0].date, '2026-10-31');
  assert.deepEqual(journal(DATA, { month: '2026-10', personId: 'maman' }).map((t) => t.amount), [1820.5, -23.5]);
});

test('totaux justes : virements et facture de carte exclus, achats par carte comptés une fois', () => {
  const s = monthSummary(DATA, seed.categories, { month: '2026-10' });
  assert.equal(s.income, 4210.5);
  // 2550 + 64.80 + 23.50 + 120 + 30.20 = 2788.50 (ni la facture 238.50, ni le virement 500)
  assert.equal(s.expenses, 2788.5);
  assert.equal(s.balance, 1422);
  assert.equal(s.excluded.count, 2, 'facture + virement');
  assert.deepEqual(s.toSort, { count: 1, total: -45.15 });
  assert.deepEqual(s.byPerson.map((p) => [p.personId, p.expenses, p.income]),
    [['menage', 2645, 0], ['papa', 120, 2390], ['maman', 23.5, 1820.5]]);
  assert.deepEqual(s.byCategory.slice(0, 3).map((c) => [c.categoryId, c.total, c.count]),
    [['logement-loyer-hypotheque', 2550, 1], ['voiture', 120, 1], ['alimentation-et-courses', 95, 2]]);
  assert.equal(s.byCategory.at(-1).type, 'recette', 'les rentrées après les dépenses');
});

test('totaux pour une personne', () => {
  const s = monthSummary(DATA, seed.categories, { month: '2026-10', personId: 'maman' });
  assert.equal(s.income, 1820.5);
  assert.equal(s.expenses, 23.5);
  assert.equal(s.balance, 1797);
});

test('mois vide : tout à zéro', () => {
  const s = monthSummary(DATA, seed.categories, { month: '2025-01' });
  assert.deepEqual([s.income, s.expenses, s.balance, s.byPerson.length, s.toSort.count], [0, 0, 0, 0, 0]);
});

test('arrondis : 0.10 + 0.20 ne donne pas 0.30000000000000004', () => {
  const s = monthSummary([tx('2026-10-01', -0.1, 'papa', 'divers'), tx('2026-10-02', -0.2, 'papa', 'divers')], seed.categories, { month: '2026-10' });
  assert.equal(s.expenses, 0.3);
});

test('une catégorie supprimée ne fait pas planter les totaux (pas comptée)', () => {
  const cats = new Map(seed.categories.map((c) => [c.id, c]));
  assert.equal(counts(tx('2026-10-01', -5, 'papa', 'inconnue'), cats), false);
});

test('export du mois pour Numbers / Excel', () => {
  const text = exportMonth(DATA, {
    month: '2026-10',
    categories: seed.categories,
    people: seed.people,
    accounts: seed.accounts,
  });
  assert.ok(text.startsWith('﻿'), 'BOM pour les accents dans Excel');
  const rows = parseCsv(text);
  assert.deepEqual(rows[0], ['Date', 'Compte', 'Pour qui', 'Catégorie', 'Texte de la banque', 'Montant', 'Monnaie', 'Compté dans les totaux']);
  assert.deepEqual(rows[1].slice(0, 4), ['02.10.2026', 'UBS', 'Ménage', 'Logement (loyer / hypothèque)']);
  assert.equal(rows[1][5], '-2550.00');
  const bill = rows.find((r) => r[5] === '-238.50');
  assert.equal(bill[7], 'non');
  const toSort = rows.find((r) => r[5] === '-45.15');
  assert.deepEqual(toSort.slice(2, 4), ['À trier', 'À trier']);
  assert.deepEqual(rows.at(-1).filter(Boolean), ['Reste', '1422.00']);
  assert.equal(rows.length, 1 + 10 + 3);
});

test('détail d’un montant : la liste redonne exactement le montant affiché', () => {
  const f = { from: '2026-10-01', to: '2026-10-31' };
  const s = monthSummary(DATA, seed.categories, f);
  const d = (what, ff = f) => detailOperations(DATA, seed.categories, ff, what);
  assert.equal(totalOf(d({ kind: 'income' })), s.income);
  assert.equal(-totalOf(d({ kind: 'expenses' })), s.expenses);
  assert.equal(totalOf(d({ kind: 'balance' })), s.balance);
  for (const c of s.byCategory) {
    assert.equal(Math.abs(totalOf(d({ kind: 'category', id: c.categoryId }))), c.total, c.categoryId);
  }
  for (const p of s.byPerson.filter((x) => x.expenses)) {
    assert.equal(-totalOf(d({ kind: 'person', id: p.personId })), p.expenses, p.personId);
  }
  assert.equal(d({ kind: 'excluded' }).length, s.excluded.count);
  assert.deepEqual(d({ kind: 'toSort' }).map((t) => t.amount), [-45.15]);
  assert.deepEqual(d({ kind: 'category', id: 'alimentation-et-courses' }).map((t) => t.amount), [-30.2, -64.8], 'du plus récent au plus ancien');
  // Une case du tableau « Mois par mois »
  const [, oct] = summaryByMonth(DATA, seed.categories, { from: '2026-09-01', to: '2026-10-31' });
  assert.equal(-totalOf(d({ kind: 'expenses' }, { from: '2026-10-01', to: '2026-10-31' })), oct.expenses);
  // Pour une personne
  assert.deepEqual(d({ kind: 'expenses' }, { ...f, personId: 'maman' }).map((t) => t.amount), [-23.5]);
  assert.deepEqual(d({ kind: 'inconnu' }), []);
});
