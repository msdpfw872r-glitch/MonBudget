/**
 * banques.test.mjs — Tests des imports BCVs (relevé CSV) et Mastercard Swisscard (CSV).
 * Lancer : npm test
 *
 * Version : 0.7.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Les fichiers d'exemple sont INVENTÉS (même forme que les vrais exports de novembre 2026 :
 * encodage, séparateurs, en-têtes, guillemets ; faux noms, faux numéros, faux montants).
 *
 * Historique :
 *   0.7.0  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as I from '../app/src/core/import.js';
import * as C from '../app/src/core/cartes.js';
import { merchantKey } from '../app/src/core/text.js';
import { displayName } from '../app/src/core/format.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const fixture = (n) => readFile(new URL(`./fixtures/${n}`, import.meta.url));
const BCVS = 'bcvs-releve-invente.csv';
const SC = 'swisscard-transactions-invente.csv';

async function freshDb() {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  return db;
}

test('BCVs : relevé lu (accents Windows, en-tête, dates sur 2 chiffres)', async () => {
  const res = await I.readBankFile(await fixture(BCVS));
  assert.equal(res.format, 'bcvs-csv');
  assert.equal(res.transactions.length, 10);
  assert.deepEqual(res.accounts, ['K 0000.00.00'], 'n° de compte lu au-dessus du tableau');
  assert.deepEqual(res.period, { from: '2026-10-20', to: '2026-11-09' });
  const [first] = res.transactions;
  assert.deepEqual([first.date, first.description, first.amount], ['2026-11-09', 'Ordre e-Bill', -150]);
  assert.equal(res.transactions.find((t) => t.description === 'Crédit' && t.amount === 1500).amount, 1500);
  const bill = res.transactions.find((t) => t.isCardBillPayment);
  assert.deepEqual([bill.description, bill.amount], ['Débit LSV SWISSCARD AECS GMBH', -253.4]);
  const twins = res.transactions.filter((t) => t.amount === -38.65);
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0].id, twins[1].id, 'deux e-Bill identiques le même jour restent distincts');
});

test('BCVs : texte de la banque nettoyé pour les règles et l’affichage', () => {
  const t = 'Paiement 21.10.2026 15:45 Boulangerie Exemple Numéro de carte: 000000******0000';
  assert.equal(merchantKey(t), 'PAIEMENT BOULANGERIE EXEMPLE');
  assert.equal(displayName(t), 'Boulangerie Exemple');
  assert.equal(displayName('Retrait BM 06.11.2026 18:27 BR Ville-Exemple Numéro de carte: 000000******0000'), 'Retrait BM BR Ville-Exemple');
});

test('Swisscard : Débit / Crédit, cartes, monnaie étrangère, « en suspens » mises de côté', async () => {
  const res = await I.readBankFile(await fixture(SC));
  assert.equal(res.format, 'swisscard-csv');
  assert.equal(res.pendingCount, 2);
  assert.equal(res.transactions.length, 8);
  assert.deepEqual(res.accounts.sort(), ['****1111', '****2222']);
  const hotel = res.transactions.find((t) => t.merchant === 'Hôtel Exemple');
  assert.equal(hotel.amount, -105.4);
  assert.equal(hotel.note, 'Montant d’origine : EUR 110.00');
  assert.equal(hotel.bankCategory, 'Voyager');
  const refund = res.transactions.find((t) => t.description.startsWith('REMBOURSEMENT'));
  assert.equal(refund.amount, 20, 'un crédit est positif');
  assert.equal(refund.isCardPaymentReceived, false, 'un remboursement reste une rentrée à trier');
  const pay = res.transactions.find((t) => t.description === 'VOTRE PAIEMENT, MERCI');
  assert.equal(pay.isCardPaymentReceived, true);
});

test('BCVs puis Swisscard : 2 cartes inconnues → une question chacune, achats rattachés à la facture LSV', async () => {
  const db = await freshDb();
  // BCVs : un seul compte BCVs, reconnu sans question.
  let plan = await I.prepareImport(db, await I.readBankFile(await fixture(BCVS)));
  assert.equal(plan.needsMapping, undefined);
  const rec1 = await I.commitImport(db, plan);
  assert.equal(rec1.counts.nouvelles, 10);
  const [bill] = await C.listBills(db);
  assert.equal(bill.accountId, 'bcvs');

  // Swisscard : un seul compte Mastercard mais deux cartes dans le fichier → on demande pour chacune.
  const parsed = await I.readBankFile(await fixture(SC));
  plan = await I.prepareImport(db, parsed);
  assert.deepEqual(plan.needsMapping.map((q) => q.label).sort(), ['****1111', '****2222']);
  await R.assignBankRef(db, 'mastercard', '****1111');
  const card2 = await R.createCardAccount(db, { name: 'Mastercard ****2222', ref: '****2222', importFormat: 'swisscard-csv', personId: 'papa' });
  assert.equal(card2.billPaidFrom, 'bcvs', 'la nouvelle carte est payée comme l’autre');
  assert.deepEqual(card2.bankRefs, ['****2222']);
  plan = await I.prepareImport(db, parsed);
  assert.equal(plan.counts.enSuspens, 2);
  assert.equal(plan.counts.nouvelles, 8);
  const migros = plan.transactions.filter((t) => t.merchantKey === 'MIGROS');
  assert.equal(migros.length, 3, 'la clé de règle vient du commerçant : tous les Migros ensemble');
  const pay = plan.transactions.find((t) => t.amount === 253.4);
  assert.deepEqual([pay.categoryId, pay.status], ['paiement-facture-carte', 'classee'], 'paiement reçu sur la carte : pas une rentrée');
  const rec2 = await I.commitImport(db, plan);
  assert.equal(rec2.counts.facturesRattachees, 1);
  const st = await C.billStatus(db, bill);
  assert.deepEqual([st.count, st.linkedTotal, st.complete], [3, -253.4, true], 'les achats d’octobre des deux cartes = la facture');

  // Réimporter les mêmes fichiers : rien de nouveau.
  assert.equal((await I.prepareImport(db, await I.readBankFile(await fixture(BCVS)))).counts.nouvelles, 0);
  assert.equal((await I.prepareImport(db, parsed)).counts.nouvelles, 0);
});

test('mise à jour d’une base 0.6 : compte BCVs lu en CSV, facture Mastercard payée par la BCVs', async () => {
  const db = openMemoryDb();
  const old = JSON.parse(JSON.stringify(seed));
  for (const a of old.accounts) {
    if (a.id === 'bcvs') a.importFormat = 'camt053';
    if (a.id === 'mastercard') a.billPaidFrom = null;
  }
  await R.installSeed(db, old);
  await db.put('settings', { ...(await db.get('settings', 'app')), dataVersion: 2 });
  await R.upgradeSeed(db, seed);
  assert.equal((await db.get('accounts', 'bcvs')).importFormat, 'bcvs-csv');
  assert.equal((await db.get('accounts', 'mastercard')).billPaidFrom, 'bcvs');
});
