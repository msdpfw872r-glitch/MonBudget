/**
 * factures.test.mjs — Tests : un fichier de carte importé = une facture (rattachement par fichier).
 * Lancer : npm test
 *
 * Version : 0.24.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-16
 *
 * Historique :
 *   0.18.0 FRE (Fidag)  Première version.
 *   0.18.1 FRE (Fidag)  Le secours « suite d'achats » ne prend pas les achats d'un fichier qui va avec une autre facture.
 *   0.19.0 FRE (Fidag)  Facture vérifiée sans le détail.
 *   0.24.0 FRE (Fidag)  Réparation des rattachements faux ; fichier réimporté en plusieurs fois.
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

test('le secours « suite d’achats » ne vole pas les achats d’un fichier qui correspond à une autre facture', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  const items = [];
  for (let i = 0; i < 14; i++) items.push(buy(`f${i}`, 'i1', `2026-02-${String(2 + i).padStart(2, '0')}`, -10)); // 140.– : pas la facture de février (145.–)
  items.push(buy('m1', 'i2', '2026-02-20', -25), buy('m2', 'i2', '2026-03-10', -27.5)); // 52.50 = facture de mars
  await db.putMany('transactions', [...items, bill('lsv-fev', '2026-02-23', -145), bill('lsv-mars', '2026-03-23', -52.5)]);
  await C.autoLinkAll(db);
  assert.deepEqual((await db.getAllWhere('transactions', 'cardBillId', 'lsv-mars')).map((t) => t.id).sort(), ['m1', 'm2']);
  assert.equal(await db.countWhere('transactions', 'cardBillId', 'lsv-fev'), 0, 'février reste à vérifier (écart de 5.–)');
});

test('facture vérifiée sans le détail : plus signalée, réversible', async () => {
  const db = await base();
  await db.put('transactions', bill('lsv-avril', '2026-04-22', -333.3)); // aucun fichier de carte importé pour avril
  assert.deepEqual((await C.billsToCheck(db)).map((b) => b.id), ['lsv-avril']);
  await C.markBillChecked(db, 'lsv-avril');
  assert.deepEqual(await C.billsToCheck(db), []);
  assert.equal((await C.billStatus(db, await db.get('transactions', 'lsv-avril'))).checked, true);
  await C.markBillChecked(db, 'lsv-avril', false);
  assert.equal((await C.billsToCheck(db)).length, 1);
  await assert.rejects(C.markBillChecked(db, 'inconnue'), /n’existe plus/);
});

test('recherche intelligente : un achat en euros passé sur la facture suivante', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  // Facture de février (23.02) ; facture de mars (23.03, clôture ~16.03).
  // Le 12.03 un achat en euros (19.55) n'est comptabilisé qu'après la clôture : il est sur la facture d'avril.
  await db.putMany('transactions', [
    buy('a1', 'i1', '2026-02-20', -40), buy('a2', 'i1', '2026-03-01', -60), buy('a3', 'i1', '2026-03-08', -30),
    { ...buy('eur', 'i1', '2026-03-12', -19.55), note: 'Montant d’origine : EUR 18.90' },
    buy('a4', 'i1', '2026-03-15', -20),
    buy('a5', 'i1', '2026-03-20', -11), // après la clôture : facture d'avril
    bill('lsv-fev', '2026-02-23', -500), bill('lsv-mars', '2026-03-23', -150),
  ]);
  await C.markBillChecked(db, 'lsv-fev'); // pas de détail pour février
  const b = await db.get('transactions', 'lsv-mars');
  const m = C.findSmartMatch(b, await C.candidates(db, b), { prevBillDate: '2026-02-23' });
  assert.deepEqual(m.items.map((t) => t.id).sort(), ['a1', 'a2', 'a3', 'a4']);
  assert.deepEqual(m.removed.map((t) => t.id), ['eur'], 'l’achat en euros passe sur la facture suivante');
  assert.equal(m.ambiguous, false);
  assert.equal(await C.autoLinkAll(db), 1);
  assert.equal((await C.billStatus(db, b)).complete, true);
  assert.equal((await db.get('transactions', 'eur')).cardBillId ?? null, null, 'reste ouvert pour la facture suivante');
});

test('recherche intelligente : plusieurs combinaisons aussi probables → proposition, pas de rattachement seul', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await db.putMany('transactions', [
    buy('x1', 'i1', '2026-03-01', -10), buy('x2', 'i1', '2026-03-05', -10), buy('x3', 'i1', '2026-03-09', -10),
    bill('lsv', '2026-03-23', -20),
  ]);
  const b = await db.get('transactions', 'lsv');
  const m = C.findSmartMatch(b, await C.candidates(db, b), { prevBillDate: '2026-02-23' });
  assert.equal(m.ambiguous, true);
  assert.equal(m.items.length, 2);
  // L'ancienne recherche (suite continue) trouve x1 + x2 : elle passe avant ; ici on vérifie que la recherche intelligente seule ne décide pas.
});

test('réparation : un fichier qui tombe juste reprend ses achats restés sur une facture pas juste', async () => {
  const db = await base();
  // Rattachement faux d'avant : la facture de mars a pris un achat du fichier de février (f3) et un des siens.
  await db.putMany('transactions', [bill('lsv-fev', '2026-02-23', -100), bill('lsv-mars', '2026-03-23', -50)]);
  await C.linkBill(db, 'lsv-mars', ['f3', 'm1']); // 75.– au lieu de 50.– : pas juste
  assert.equal((await C.billStatus(db, await db.get('transactions', 'lsv-mars'))).complete, false);
  assert.equal(await C.autoLinkAll(db), 2);
  assert.deepEqual((await db.getAllWhere('transactions', 'cardBillId', 'lsv-fev')).map((t) => t.id).sort(), ['f1', 'f2', 'f3']);
  assert.deepEqual((await db.getAllWhere('transactions', 'cardBillId', 'lsv-mars')).map((t) => t.id).sort(), ['m1', 'm2']);
  assert.equal((await C.billsToCheck(db)).length, 0);
});

test('réparation : jamais aux dépens d’une facture juste ou vérifiée', async () => {
  const db = await base();
  // Une facture juste de 50.– (f3) : le fichier de février (100.–) ne peut pas reprendre f3.
  await db.putMany('transactions', [bill('lsv-autre', '2026-02-20', -50), bill('lsv-fev', '2026-02-23', -100)]);
  await C.linkBill(db, 'lsv-autre', ['f3']);
  await C.autoLinkAll(db);
  assert.deepEqual((await db.getAllWhere('transactions', 'cardBillId', 'lsv-autre')).map((t) => t.id), ['f3']);
  assert.equal(await db.countWhere('transactions', 'cardBillId', 'lsv-fev'), 0);
});

test('un fichier réimporté en deux fois (même période) compte comme un seul fichier', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  const period = { from: '2026-02-02', to: '2026-02-15' };
  await db.putMany('imports', [{ id: 'imp-a', period }, { id: 'imp-b', period }, { id: 'imp-x', period: { from: '2026-01-20', to: '2026-01-20' } }]);
  // Un autre fichier (105.–) dont les deux premiers achats feraient 100.– : la « suite d'achats » les prendrait.
  await db.putMany('transactions', [buy('x0', 'imp-x', '2026-01-20', -60), buy('x1', 'imp-x', '2026-01-20', -40), buy('x2', 'imp-x', '2026-01-20', -5),
    buy('a1', 'imp-a', '2026-02-02', -30), buy('a2', 'imp-a', '2026-02-15', -20),
    buy('b1', 'imp-b', '2026-02-10', -50), bill('lsv-fev', '2026-02-23', -100)]);
  assert.equal(await C.autoLinkAll(db), 1);
  assert.deepEqual((await db.getAllWhere('transactions', 'cardBillId', 'lsv-fev')).map((t) => t.id).sort(), ['a1', 'a2', 'b1']);
});
