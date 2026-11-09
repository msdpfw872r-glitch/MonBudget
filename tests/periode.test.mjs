/**
 * periode.test.mjs — Tests des périodes d'analyse et de la recherche d'opérations.
 * Lancer : npm test
 *
 * Version : 0.5.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.5.1  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { periodFor, shiftPeriod, periodLabel, shiftLabel, mondayOf, monthsIn, inPeriod } from '../app/src/core/periode.js';
import { journal, monthSummary, searchOperations, summaryByMonth, exportMonth } from '../app/src/core/journal.js';
import { parseCsv } from '../app/src/core/csv.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));

test('semaine : du lundi au dimanche', () => {
  assert.equal(mondayOf('2026-10-14'), '2026-10-12'); // mercredi → lundi
  assert.equal(mondayOf('2026-10-18'), '2026-10-12'); // dimanche → lundi d'avant
  assert.equal(mondayOf('2026-10-12'), '2026-10-12');
  const w = periodFor('semaine', '2026-10-14');
  assert.deepEqual([w.from, w.to], ['2026-10-12', '2026-10-18']);
  assert.equal(periodLabel(w), 'Semaine du 12 au 18 octobre 2026');
  const w2 = periodFor('semaine', '2026-10-01');
  assert.equal(periodLabel(w2), 'Semaine du 28 septembre au 4 octobre 2026');
  assert.deepEqual([shiftPeriod(w, 1).from, shiftPeriod(w, -1).to], ['2026-10-19', '2026-10-11']);
  assert.equal(shiftLabel(w, -1), 'Semaine précédente');
});

test('mois, année : bornes, libellés, précédent / suivant', () => {
  const m = periodFor('mois', '2026-02-10');
  assert.deepEqual([m.from, m.to], ['2026-02-01', '2026-02-28']);
  assert.equal(periodFor('mois', '2028-02-10').to, '2028-02-29', 'année bissextile');
  assert.equal(periodLabel(m), 'Février 2026');
  assert.equal(periodLabel(shiftPeriod(m, -2)), 'Décembre 2025');
  assert.equal(shiftLabel(m, 1), 'Mars');
  const y = periodFor('annee', '2026-07-04');
  assert.deepEqual([y.from, y.to], ['2026-01-01', '2026-12-31']);
  assert.equal(periodLabel(y), 'Année 2026');
  assert.equal(shiftLabel(y, -1), '2025');
});

test('dates libres : ordre corrigé, décalage de même durée', () => {
  const p = periodFor('libre', '2026-10-01', { from: '2026-10-28', to: '2026-10-03' });
  assert.deepEqual([p.from, p.to], ['2026-10-03', '2026-10-28'], 'les dates inversées sont remises dans l’ordre');
  assert.equal(periodLabel(p), 'Du 3 au 28 octobre 2026');
  assert.equal(periodLabel({ kind: 'libre', from: '2026-09-15', to: '2026-10-14' }), 'Du 15 septembre au 14 octobre 2026');
  assert.equal(periodLabel({ kind: 'libre', from: '2025-12-15', to: '2026-01-14' }), 'Du 15 décembre 2025 au 14 janvier 2026');
  assert.equal(periodLabel({ kind: 'libre', from: '2026-10-05', to: '2026-10-05' }), 'Le 5 octobre 2026');
  const next = shiftPeriod({ kind: 'libre', from: '2026-10-01', to: '2026-10-10' }, 1);
  assert.deepEqual([next.from, next.to], ['2026-10-11', '2026-10-20']);
  const bad = periodFor('libre', '2026-10-14', { from: 'n’importe quoi', to: '' });
  assert.deepEqual([bad.from, bad.to], ['2026-10-01', '2026-10-31'], 'dates invalides → le mois');
});

test('mois couverts par une période', () => {
  assert.deepEqual(monthsIn({ from: '2025-11-15', to: '2026-02-03' }), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(inPeriod('2026-10-12', periodFor('semaine', '2026-10-14')), true);
});

let n = 0;
const tx = (date, amount, personId, categoryId, description, extra = {}) => ({
  id: `t${++n}`, date, amount, personId, categoryId, description, status: 'classee', accountId: 'ubs', ...extra,
});
const DATA = [
  tx('2026-09-30', -99.99, 'maman', 'cadeaux', 'FLEURISTE DU MIDI'),
  tx('2026-10-03', -64.8, 'menage', 'alimentation-et-courses', 'MIGROS M SION 03.10.2026'),
  tx('2026-10-12', -30.2, 'menage', 'alimentation-et-courses', 'COOP CITY SION'),
  tx('2026-10-14', 2390, 'papa', 'rente-avs', 'CAISSE AVS RENTE'),
  tx('2026-10-15', -500, 'menage', 'virement-sortant', 'VIREMENT EPARGNE'),
  tx('2026-11-02', -42.1, 'papa', 'restaurants', 'CAFÉ DE LA PAIX'),
  tx('2026-11-03', -12, null, null, 'TWINT *UBS TWINT Zürich', { status: 'a-trier' }),
];

test('journal et totaux sur une période quelconque', () => {
  const w = periodFor('semaine', '2026-10-14');
  assert.deepEqual(journal(DATA, w).map((t) => t.description), ['VIREMENT EPARGNE', 'CAISSE AVS RENTE', 'COOP CITY SION']);
  const s = monthSummary(DATA, seed.categories, periodFor('annee', '2026-01-01'));
  assert.equal(s.expenses, 237.09); // 99.99 + 64.80 + 30.20 + 42.10 (ni le virement ni l'opération à trier)
  assert.equal(s.income, 2390);
  assert.equal(s.toSort.count, 1);
});

test('mois par mois sur l’année, bornes respectées', () => {
  const rows = summaryByMonth(DATA, seed.categories, { from: '2026-09-15', to: '2026-11-30' });
  assert.deepEqual(rows.map((r) => [r.month, r.income, r.expenses]), [['2026-09', 0, 99.99], ['2026-10', 2390, 95], ['2026-11', 0, 42.1]]);
  const part = summaryByMonth(DATA, seed.categories, { from: '2026-10-10', to: '2026-10-31' });
  assert.deepEqual(part.map((r) => r.expenses), [30.2], 'du 10 octobre seulement');
});

test('chercher des opérations : commerce, catégorie, personne, montant, date, sans accents', () => {
  const ctx = {
    categoriesById: new Map(seed.categories.map((c) => [c.id, c])),
    peopleById: new Map(seed.people.map((p) => [p.id, p])),
    accountsById: new Map(seed.accounts.map((a) => [a.id, a])),
  };
  const find = (q) => searchOperations(DATA, q, ctx).map((t) => t.id);
  assert.deepEqual(find('migros'), ['t2']);
  assert.deepEqual(find('sion'), ['t2', 't3']);
  assert.deepEqual(find('coop sion'), ['t3'], 'tous les mots doivent correspondre');
  assert.deepEqual(find('alimentation'), ['t2', 't3'], 'par catégorie');
  assert.deepEqual(find('papa'), ['t4', 't6'], 'par personne');
  assert.deepEqual(find('64.80'), ['t2'], 'par montant');
  assert.deepEqual(find('64,8'), ['t2'], 'montant avec une virgule');
  assert.deepEqual(find('cafe'), ['t6'], 'sans accent');
  assert.deepEqual(find('14.10.2026'), ['t4'], 'par date');
  assert.deepEqual(find('à trier'), ['t7']);
  assert.deepEqual(find('   ').length, DATA.length, 'recherche vide : tout');
  assert.deepEqual(find('zzz'), []);
});

test('export d’une période et d’un résultat de recherche', () => {
  const opts = { categories: seed.categories, people: seed.people, accounts: seed.accounts };
  const week = parseCsv(exportMonth(DATA, { ...opts, ...periodFor('semaine', '2026-10-14') }));
  assert.equal(week.length, 1 + 3 + 3);
  const found = searchOperations(DATA, 'sion', { categoriesById: new Map(seed.categories.map((c) => [c.id, c])) });
  const rows = parseCsv(exportMonth(DATA, { ...opts, list: found }));
  assert.equal(rows.length, 1 + 2 + 3);
  assert.deepEqual(rows.at(-2).filter(Boolean), ['Dépenses', '-95.00']);
});
