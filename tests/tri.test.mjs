/**
 * tri.test.mjs — Tests de l'ordre des opérations à trier et de la recherche de catégorie.
 * Lancer : npm test
 *
 * Version : 0.4.5
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.4.2  FRE (Fidag)  Première version.
 *   0.4.4  FRE (Fidag)  Ordre des catégories.
 *   0.4.5  FRE (Fidag)  Ordre et recherche des personnes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderPending, countByMerchant, searchCategories, lastUsedByCategory, orderCategories, lastUsedBy, orderByUse } from '../app/src/core/tri.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const tx = (id, date, merchantKey) => ({ id, date, merchantKey });

test('ordre : par date, ou commerces fréquents d’abord', () => {
  const list = [
    tx('a', '2026-10-05', 'COOP CITY'),
    tx('b', '2026-10-01', 'TWINT UBS TWINT ZURICH'),
    tx('c', '2026-10-03', 'MIGROS M SION'),
    tx('d', '2026-10-02', 'TWINT UBS TWINT ZURICH'),
    tx('e', '2026-10-04', 'MIGROS M SION'),
    tx('f', '2026-10-06', 'TWINT UBS TWINT ZURICH'),
  ];
  assert.deepEqual(orderPending(list, 'date').map((t) => t.id), ['b', 'd', 'c', 'e', 'a', 'f']);
  assert.deepEqual(orderPending(list, 'frequent').map((t) => t.id), ['b', 'd', 'f', 'c', 'e', 'a']);
  assert.equal(countByMerchant(list).get('TWINT UBS TWINT ZURICH'), 3);
  assert.equal(list[0].id, 'a', 'la liste d’origine n’est pas modifiée');
});

test('recherche de catégorie : sans accents, plusieurs mots, début du nom d’abord', () => {
  const names = (q) => searchCategories(seed.categories, q).map((c) => c.name);
  assert.deepEqual(names('caisse mal'), ['Caisse maladie (primes)', 'Remboursement caisse maladie']);
  assert.deepEqual(names('ENERGIE'), ['Énergie et charges']);
  assert.equal(names('rente')[0], 'Rente AVS', 'les noms qui commencent par « rente » d’abord');
  assert.ok(names('rente').includes('3e pilier / rente viagère'));
  assert.deepEqual(names('   '), []);
  assert.deepEqual(names('xyz'), []);
  const archived = seed.categories.map((c) => (c.id === 'dons' ? { ...c, archived: true } : c));
  assert.deepEqual(searchCategories(archived, 'dons'), [], 'les catégories mises de côté ne sont pas proposées');
});

test('catégories : derniers utilisés ou de A à Z', () => {
  const cats = [
    { id: 'pharmacie', name: 'Pharmacie' },
    { id: 'energie', name: 'Énergie et charges' },
    { id: 'alim', name: 'Alimentation et courses' },
    { id: 'dons', name: 'Dons' },
  ];
  const txs = [
    { status: 'classee', categoryId: 'pharmacie', classifiedAt: '2026-11-08T10:00:00Z' },
    { status: 'classee', categoryId: 'alim', classifiedAt: '2026-11-09T08:00:00Z' },
    { status: 'a-trier', categoryId: 'dons', classifiedAt: '2026-11-09T09:00:00Z' },
    { status: 'classee', categoryId: 'pharmacie' }, // ancienne opération sans date
  ];
  const rules = [{ categoryId: 'pharmacie', lastUsedAt: '2026-11-09T07:00:00Z' }];
  const last = lastUsedByCategory(txs, rules);
  assert.equal(last.get('pharmacie'), '2026-11-09T07:00:00Z');
  assert.equal(last.has('dons'), false, 'une opération pas encore triée ne compte pas');
  assert.deepEqual(orderCategories(cats, 'recent', last).map((c) => c.id), ['alim', 'pharmacie', 'dons', 'energie']);
  assert.deepEqual(orderCategories(cats, 'alpha').map((c) => c.name), ['Alimentation et courses', 'Dons', 'Énergie et charges', 'Pharmacie']);
});

test('personnes : derniers utilisés, de A à Z, recherche', () => {
  const people = [{ id: 'maman', name: 'Maman' }, { id: 'papa', name: 'Papa' }, { id: 'menage', name: 'Ménage' }, { id: 'eloise', name: 'Éloïse' }];
  const txs = [
    { status: 'classee', personId: 'papa', classifiedAt: '2026-11-08T10:00:00Z' },
    { status: 'classee', personId: 'menage', classifiedAt: '2026-11-09T10:00:00Z' },
  ];
  const last = lastUsedBy(txs, [], 'personId');
  assert.deepEqual(orderByUse(people, 'recent', last).map((p) => p.id), ['menage', 'papa', 'eloise', 'maman']);
  assert.deepEqual(orderByUse(people, 'alpha').map((p) => p.name), ['Éloïse', 'Maman', 'Ménage', 'Papa']);
  assert.deepEqual(searchCategories(people, 'elo').map((p) => p.id), ['eloise'], 'la recherche marche aussi pour les personnes');
});
