/**
 * factures.test.mjs — Tests : un fichier de carte importé = une facture (rattachement par fichier).
 * Lancer : npm test
 *
 * Version : 0.18.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-15
 *
 * Historique :
 *   0.18.0 FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as C from '../app/src/core/cartes.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const buy = (id, importId, date, amount, accountId = 'mastercard') => ({ id, importId, accountId, date, amount, description: id, status: 'a-trier' });

async function base() {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  // Fichier de février (3 achats, 100.–) et fichier de mars (2 achats, 50.–) ; paiement de la facture reçu sur la carte.
  await db.putMany('transactions', [
    buy('f1', 'imp-fev', '2026-02-02', -30), buy('f2', 'imp-fev', '2026-02-10', -20), buy('f3', 'imp-fev', '2026-02-15', -50),
    buy('m1', 'imp-mars', '2026-02-20', -25), buy('m2', 'imp-mars', '2026-03-10', -25),
    { ...buy('pay', 'imp-mars', '2026-02-23', 100), status: 'classee', categoryId: 'paiement-facture-carte' },
  ]);
  return db;
}
const bill = (id, date, amount) => ({ id, accountId: 'bcvs', date, amount, description: 'LSV SWISSCARD', isCardBillPayment: true,
  status: 'classee', categoryId: 'paiement-facture-carte' });

test('un fichier = une facture : le bon fichier, même si une autre suite d’achats ferait le même total', async () => {
  const db = await base();
  await db.put('transactions', bill('lsv-mars', '2026-03-23', -50));
  // L'ancienne méthode (suite continue la plus ancienne) aurait pris f1 + f2 (30 + 20) du fichier de février.
  assert.deepEqual(C.findExactRun(await db.get('transactions', 'lsv-mars'), await C.candidates(db, await db.get('transactions', 'lsv-mars'))).map((t) => t.id), ['f1', 'f2']);
  assert.equal(await C.autoLinkAll(db), 1);
  const linked = (await db.getAllWhere('transactions', 'cardBillId', 'lsv-mars')).map((t) => t.id).sort();
  assert.deepEqual(linked, ['m1', 'm2'], 'les achats du fichier de mars');
  assert.equal((await db.get('transactions', 'pay')).cardBillId ?? null, null, 'le paiement reçu n’est pas un achat');
});

test('dans l’autre ordre (banque d’abord, carte ensuite) et facture de février', async () => {
  const db = await base();
  await db.putMany('transactions', [bill('lsv-fev', '2026-02-23', -100), bill('lsv-mars', '2026-03-23', -50)]);
  assert.equal(await C.autoLinkAll(db), 2);
  assert.deepEqual((await db.getAllWhere('transactions', 'cardBillId', 'lsv-fev')).map((t) => t.id).sort(), ['f1', 'f2', 'f3']);
  assert.equal((await C.billsToCheck(db)).length, 0);
});

test('fichier trop ancien ou total différent : pas rattaché par fichier', async () => {
  const db = await base();
  await db.put('transactions', bill('lsv-tard', '2026-05-30', -50)); // plus de 45 jours après le 10 mars
  const b = await db.get('transactions', 'lsv-tard');
  assert.equal(C.findImportGroup(b, await C.candidates(db, b)), null);
  const groups = C.importGroups(await C.candidates(db, b));
  assert.deepEqual(groups.map((g) => [g.importId, g.cents, g.from, g.to]), [['imp-mars', -5000, '2026-02-20', '2026-03-10'], ['imp-fev', -10000, '2026-02-02', '2026-02-15']]);
});
