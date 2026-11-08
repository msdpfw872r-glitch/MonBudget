/**
 * tri.test.mjs — Tests de l'ordre des opérations à trier et de la recherche de catégorie.
 * Lancer : npm test
 *
 * Version : 0.4.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.4.2  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderPending, countByMerchant, searchCategories } from '../app/src/core/tri.js';

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
