/**
 * entretien.test.mjs — Tests : relire les opérations à trier après une mise à jour ; filtres et ordres du Journal.
 * Lancer : npm test
 *
 * Version : 0.16.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-15
 *
 * Historique :
 *   0.16.0 FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as E from '../app/src/core/entretien.js';
import * as J from '../app/src/core/journal.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));

test('mise à jour : opérations à trier relues (carte, NOTPROVIDED) puis classées par les règles ; le tri à la main reste', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await db.put('rules', { id: 'r-conf', merchantKey: 'CONFISERIE EXEMPLE', personId: 'maman', categoryId: 'alimentation-et-courses' });
  await db.putMany('transactions', [
    { id: 'camt|CH01|R1|0', date: '2026-01-05', status: 'a-trier', amount: -36, merchant: 'Titulaire Exemple', merchantKey: 'TITULAIRE EXEMPLE',
      description: 'Paiement 31.12.2025 14:50 Confiserie Exemple SA Numéro de carte: 000000******0000 · Titulaire Exemple · …', bankCategory: 'Virement émis' },
    { id: 'camt|CH01|R2|0', date: '2026-01-06', status: 'a-trier', amount: -300, merchant: 'Titulaire Exemple', merchantKey: 'TITULAIRE EXEMPLE',
      description: 'Retrait BM 22.01.2026 18:27 BR Exempleville Numéro de carte: 000000******0000 · Titulaire Exemple' },
    { id: 'camt|CH01|R3|0', date: '2026-01-07', status: 'a-trier', amount: -6, merchant: 'NOTPROVIDED', merchantKey: 'NOTPROVIDED', description: 'Frais Conto Pack · NOTPROVIDED' },
    { id: 'camt|CH01|R4|0', date: '2026-01-08', status: 'classee', personId: 'papa', categoryId: 'divers', amount: -36, merchant: 'Titulaire Exemple',
      merchantKey: 'TITULAIRE EXEMPLE', description: 'Paiement 01.01.2026 10:00 Confiserie Exemple SA Numéro de carte: 0000' },
    { id: 'ubs-1', date: '2026-01-09', status: 'a-trier', amount: -5, merchant: null, merchantKey: 'CONFISERIE EXEMPLE SA', description: 'CONFISERIE EXEMPLE SA' },
  ]);
  const r = await E.refreshPending(db);
  assert.deepEqual(r, { relues: 4, corrigees: 3, classees: 2 });
  const a = await db.get('transactions', 'camt|CH01|R1|0');
  assert.deepEqual([a.merchant, a.merchantKey, a.bankCategory, a.status, a.personId], ['Confiserie Exemple SA', 'CONFISERIE EXEMPLE SA', 'Paiement par carte', 'classee', 'maman']);
  assert.equal((await db.get('transactions', 'camt|CH01|R2|0')).merchant, 'Retrait au bancomat');
  assert.equal((await db.get('transactions', 'camt|CH01|R3|0')).merchant, 'Frais Conto Pack');
  assert.equal((await db.get('transactions', 'camt|CH01|R4|0')).personId, 'papa', 'triée à la main : pas touchée');
  assert.equal((await db.get('transactions', 'ubs-1')).status, 'classee', 'les règles servent aussi aux autres banques');
  assert.deepEqual(await E.refreshPending(db), { relues: 2, corrigees: 0, classees: 0 }, 'rien de plus la 2e fois');
});

test('Journal : triées / à trier, catégorie, ordres', () => {
  const cats = new Map([['a', { name: 'Alimentation' }], ['v', { name: 'Voiture' }]]);
  const list = [
    { id: '1', date: '2026-11-03', amount: -50, status: 'classee', categoryId: 'v', description: 'GARAGE' },
    { id: '2', date: '2026-11-01', amount: -10, status: 'classee', categoryId: 'a', description: 'COOP' },
    { id: '3', date: '2026-11-02', amount: 2390, status: 'classee', categoryId: 'a', description: 'RENTE' },
    { id: '4', date: '2026-11-04', amount: -99, status: 'a-trier', description: 'BOUTIQUE' },
  ];
  const ids = (l) => l.map((t) => t.id);
  assert.deepEqual(ids(J.filterOperations(list, { status: 'classee' })), ['1', '2', '3']);
  assert.deepEqual(ids(J.filterOperations(list, { status: 'a-trier' })), ['4']);
  assert.deepEqual(ids(J.filterOperations(list, { categoryId: 'a' })), ['2', '3']);
  const ctx = { categoriesById: cats, nameOf: (t) => t.description };
  assert.deepEqual(ids(J.sortOperations(list, 'date-desc', ctx)), ['4', '1', '3', '2']);
  assert.deepEqual(ids(J.sortOperations(list, 'date-asc', ctx)), ['2', '3', '1', '4']);
  assert.deepEqual(ids(J.sortOperations(list, 'montant-desc', ctx)), ['4', '1', '2', '3']);
  assert.deepEqual(ids(J.sortOperations(list, 'montant-asc', ctx)), ['3', '2', '1', '4']);
  assert.deepEqual(ids(J.sortOperations(list, 'nom', ctx)), ['4', '2', '1', '3']);
  assert.deepEqual(ids(J.sortOperations(list, 'categorie', ctx)), ['3', '2', '1', '4'], 'à trier à la fin');
});
