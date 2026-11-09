/**
 * import.test.mjs — Tests de l'import de bout en bout, des règles retenues et des factures de carte.
 * Lancer : npm test
 *
 * Version : 0.4.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Les relevés sont construits ici (lignes UBS anonymisées) : un compte, deux cartes
 * (****1111 pour Maman, ****2222 pour Papa) et une facture commune prélevée par LSV.
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as I from '../app/src/core/import.js';
import * as G from '../app/src/core/regles.js';
import * as C from '../app/src/core/cartes.js';
import * as ubs from '../app/src/importers/ubs.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const IBAN = 'CH00 0000 0000 0000 0000 0';
const HEAD = ['Date de transaction', 'Numéro de compte ou de carte', 'Description', 'Revenu ou dépense', 'Montant', 'Monnaie', 'Catégorie'];
const line = (date, ref, desc, amount, cat = '') =>
  [date, ref, desc, amount < 0 ? 'Dépense' : 'Revenu', amount.toFixed(2), 'CHF', cat];

/** Relevé d'octobre : 4 achats par carte (238.50) + la facture LSV du même montant. */
const OCTOBRE = [
  HEAD,
  line('31.10.2026', IBAN, 'ÉMETTEUR 01 - RENTE AVS', 2390, 'Salaire et rentes'),
  line('26.10.2026', IBAN, 'LSV UBS CARD CENTER FACTURE CARTE', -238.5, 'Factures de carte de crédit'),
  line('02.10.2026', IBAN, 'ÉMETTEUR 04 - LOYER', -2550, 'Transferts entre comptes'),
  line('03.10.2026', '****1111', 'MIGROS M SION 03.10.2026', -64.8, 'Achats'),
  line('05.10.2026', '****2222', 'GARAGE DU CENTRE', -120, 'Transports'),
  line('10.10.2026', '****1111', 'PHARMACIE SUN STORE', -23.5, 'Santé'),
  line('12.10.2026', '****2222', 'COOP CITY', -30.2, 'Achats'),
  line('28.10.2026', '****1111', 'MIGROS M SION 28.10.2026', -15, 'Achats'),
];

async function freshDb() {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  return db;
}

/** Importe des lignes ; répond aux questions de cartes (Maman ****1111, Papa ****2222). */
async function importRows(db, rows, fileName = 'transactions.xlsx') {
  const parsed = { ...ubs.parse(rows), format: ubs.FORMAT_ID };
  let plan = await I.prepareImport(db, parsed, { fileName });
  if (plan.needsMapping) {
    for (const q of plan.needsMapping) {
      await R.assignBankRef(db, q.ref === '****1111' ? 'carte-ubs-maman' : 'carte-ubs-papa', q.ref);
    }
    plan = await I.prepareImport(db, parsed, { fileName });
  }
  assert.equal(plan.needsMapping, undefined);
  return { plan, record: await I.commitImport(db, plan) };
}

test('lecture du fichier : UBS reconnu, autre fichier refusé en mots simples', async () => {
  const xlsx = await readFile(new URL('./fixtures/ubs-exemple-anonymise.xlsx', import.meta.url));
  const res = await I.readBankFile(xlsx);
  assert.equal(res.format, ubs.FORMAT_ID);
  assert.equal(res.transactions.length, 10);
  const other = await readFile(new URL('./fixtures/fiqu-shared-strings.xlsx', import.meta.url));
  await assert.rejects(I.readBankFile(other), (e) => e instanceof R.ReglageError && /pas reconnu/.test(e.message));
  await assert.rejects(I.readBankFile(new TextEncoder().encode('Date;Montant')), /pas reconnu/);
});

test('cartes inconnues : une question par carte, le compte est reconnu seul', async () => {
  const db = await freshDb();
  const parsed = { ...ubs.parse(OCTOBRE), format: ubs.FORMAT_ID };
  const plan = await I.prepareImport(db, parsed);
  assert.deepEqual(plan.needsMapping.map((q) => [q.label, q.kind, q.count]), [['****1111', 'carte', 3], ['****2222', 'carte', 2]]);
  assert.deepEqual(plan.needsMapping[0].choices.slice(0, 2).map((a) => a.id), ['carte-ubs-maman', 'carte-ubs-papa']);
  assert.deepEqual(plan.autoAssigned, [{ ref: R.normRef(IBAN), accountId: 'ubs' }]);
});

test('import : compteurs, facture classée seule, achats rattachés à la facture commune', async () => {
  const db = await freshDb();
  const { plan, record } = await importRows(db, OCTOBRE);
  assert.deepEqual(plan.counts, { trouvees: 8, nouvelles: 8, autoClassees: 1, aTrier: 7, doublons: 0, enSuspens: 0 });
  assert.equal(record.counts.facturesRattachees, 1);

  const [bill] = await C.listBills(db);
  assert.equal(bill.categoryId, 'paiement-facture-carte');
  assert.equal(bill.status, 'classee');
  const st = await C.billStatus(db, bill);
  assert.deepEqual(st, { count: 4, linkedTotal: -238.5, billAmount: -238.5, difference: 0, complete: true });
  // L'achat du 28 octobre (après le prélèvement) attend la facture suivante.
  const late = (await db.getAllWhere('transactions', 'accountId', 'carte-ubs-maman')).find((t) => t.date === '2026-10-28');
  assert.equal(late.cardBillId, null);
  assert.deepEqual(await C.billsToCheck(db), []);
  // Le compte reconnu sans question est retenu pour la prochaine fois.
  assert.deepEqual((await db.get('accounts', 'ubs')).bankRefs, [R.normRef(IBAN)]);
});

test('réimporter le même fichier : 0 nouvelle opération', async () => {
  const db = await freshDb();
  await importRows(db, OCTOBRE);
  const { plan } = await importRows(db, OCTOBRE);
  assert.equal(plan.counts.nouvelles, 0);
  assert.equal(plan.counts.doublons, 8);
  assert.equal(await db.count('transactions'), 8);
});

test('une règle créée en triant classe seule au 2ᵉ import (et les opérations en attente)', async () => {
  const db = await freshDb();
  await importRows(db, OCTOBRE);
  const migros = (await db.getAllWhere('transactions', 'status', 'a-trier')).find((t) => t.date === '2026-10-03');
  assert.equal(migros.merchantKey, 'MIGROS M SION');
  const res = await G.classify(db, migros.id, { personId: 'menage', categoryId: 'alimentation-et-courses', remember: true });
  assert.equal(res.alsoClassified, 1, 'le Migros du 28 octobre est classé aussi');

  const NOVEMBRE = [HEAD, line('04.11.2026', '****2222', 'MIGROS M SION 04.11.2026', -42.1, 'Achats')];
  const { plan } = await importRows(db, NOVEMBRE);
  assert.deepEqual(plan.counts, { trouvees: 1, nouvelles: 1, autoClassees: 1, aTrier: 0, doublons: 0, enSuspens: 0 });
  const nov = plan.transactions[0];
  assert.equal(nov.personId, 'menage');
  assert.equal(nov.categoryId, 'alimentation-et-courses');
  assert.equal(nov.ruleId, res.rule.id);
  assert.equal((await db.get('rules', res.rule.id)).hits, 2);
});

test('règles : identique, sinon la plus longue contenue (mots entiers)', () => {
  const rules = [
    { id: 'a', merchantKey: 'MIGROS' },
    { id: 'b', merchantKey: 'MIGROS M SION' },
    { id: 'c', merchantKey: 'COOP' },
  ];
  assert.equal(G.findRule(rules, 'MIGROS M SION').id, 'b');
  assert.equal(G.findRule(rules, 'MIGROS M MARTIGNY').id, 'a');
  assert.equal(G.findRule(rules, 'COOP CITY SION').id, 'c');
  assert.equal(G.findRule(rules, 'COOPERATIVE'), null, 'pas de morceau de mot');
  assert.equal(G.findRule(rules, ''), null);
});

test('corriger une opération classée par une règle : « Changer aussi la règle ? »', async () => {
  const db = await freshDb();
  await importRows(db, OCTOBRE);
  const [a, b] = (await db.getAllWhere('transactions', 'status', 'a-trier')).filter((t) => t.merchantKey === 'MIGROS M SION');
  const { rule } = await G.classify(db, a.id, { personId: 'menage', categoryId: 'alimentation-et-courses', remember: true });

  // Non : seule cette opération change, elle n'est plus liée à la règle.
  await G.classify(db, b.id, { personId: 'maman', categoryId: 'cadeaux' });
  assert.equal((await db.get('transactions', b.id)).ruleId, null);
  assert.equal((await db.get('rules', rule.id)).categoryId, 'alimentation-et-courses');

  // Oui : la règle change aussi.
  await G.classify(db, a.id, { personId: 'maman', categoryId: 'menage-et-droguerie', updateRule: true });
  const r = await db.get('rules', rule.id);
  assert.equal(r.personId, 'maman');
  assert.equal(r.categoryId, 'menage-et-droguerie');

  await assert.rejects(G.classify(db, a.id, { personId: 'inconnu', categoryId: 'cadeaux' }), /pour qui/);
  await assert.rejects(G.classify(db, a.id, { personId: 'papa', categoryId: '' }), /catégorie/);
});

test('règles dans Réglages : modifier la clé, supprimer', async () => {
  const db = await freshDb();
  await importRows(db, OCTOBRE);
  const t = (await db.getAllWhere('transactions', 'status', 'a-trier')).find((x) => x.merchantKey === 'COOP CITY');
  const { rule } = await G.classify(db, t.id, { personId: 'menage', categoryId: 'alimentation-et-courses', remember: true });
  const r = await G.saveRule(db, rule.id, { merchantKey: 'coop', personId: 'menage', categoryId: 'alimentation-et-courses' });
  assert.equal(r.merchantKey, 'COOP');
  await assert.rejects(G.saveRule(db, rule.id, { merchantKey: ' ', personId: 'menage', categoryId: 'divers' }), /au moins un mot/);
  await G.deleteRule(db, rule.id);
  assert.equal(await db.count('rules'), 0);
  const after = await db.get('transactions', t.id);
  assert.equal(after.status, 'classee', 'l’opération garde son classement');
  assert.equal(after.ruleId, null);
});

test('facture avec frais : pas de rattachement automatique, rattachement à la main avec écart', async () => {
  const db = await freshDb();
  const rows = OCTOBRE.map((r) => (r[2] === 'LSV UBS CARD CENTER FACTURE CARTE' ? line('26.10.2026', IBAN, r[2], -240.5, r[6]) : r));
  const { record } = await importRows(db, rows);
  assert.equal(record.counts.facturesRattachees, 0);
  const [bill] = await C.billsToCheck(db);
  const cands = await C.candidates(db, bill);
  assert.equal(cands.length, 4, 'achats des deux cartes jusqu’au prélèvement');
  const st = await C.linkBill(db, bill.id, cands.map((t) => t.id));
  assert.equal(st.count, 4);
  assert.equal(st.difference, -2, 'la facture dépasse les achats de CHF 2.00 (frais)');
  assert.equal(st.complete, false);
  // Décocher un achat
  const st2 = await C.linkBill(db, bill.id, cands.slice(1).map((t) => t.id));
  assert.equal(st2.count, 3);
  assert.equal((await db.get('transactions', cands[0].id)).cardBillId, null);
});

test('facture reclassée autrement : les achats sont libérés', async () => {
  const db = await freshDb();
  await importRows(db, OCTOBRE);
  const [bill] = await C.listBills(db);
  await G.classify(db, bill.id, { personId: 'menage', categoryId: 'divers' });
  assert.equal(await db.countWhere('transactions', 'cardBillId', bill.id), 0);
  assert.deepEqual(await C.listBills(db), []);
});

test('annuler un import entier', async () => {
  const db = await freshDb();
  const { record } = await importRows(db, OCTOBRE);
  const NOVEMBRE = [HEAD, line('04.11.2026', '****2222', 'COOP CITY', -9.9, 'Achats')];
  const second = (await importRows(db, NOVEMBRE)).record;
  assert.deepEqual((await I.listImports(db)).map((i) => i.id).sort(), [record.id, second.id].sort());
  assert.equal(await I.undoImport(db, record.id), 8);
  assert.equal(await db.count('transactions'), 1);
  assert.equal(await db.count('imports'), 1);
  // Réimporter après annulation fonctionne de nouveau.
  const again = await importRows(db, OCTOBRE);
  assert.equal(again.plan.counts.nouvelles, 8);
});

test('aucun compte pour ce fichier : message clair', async () => {
  const db = await freshDb();
  for (const id of ['carte-ubs-maman', 'carte-ubs-papa', 'ubs']) await R.deleteAccount(db, id);
  const parsed = { ...ubs.parse(OCTOBRE), format: ubs.FORMAT_ID };
  await assert.rejects(I.prepareImport(db, parsed), /vient de UBS, mais aucun de vos comptes/);
});

test('mise à jour d’une base 0.3.0 : cartes et catégorie ajoutées sans rien écraser', async () => {
  const db = openMemoryDb();
  const old = { ...seed, accounts: seed.accounts.filter((a) => a.kind !== 'carte' || a.id === 'mastercard'),
    categories: seed.categories.filter((c) => !c.isCardBill) };
  await R.installSeed(db, old);
  await db.put('settings', { ...(await db.get('settings', 'app')), dataVersion: 1 });
  await R.saveAccount(db, { id: 'ubs', name: 'UBS privé', kind: 'compte', importFormat: 'ubs-transactions-xlsx' });
  const added = await R.upgradeSeed(db, seed);
  assert.deepEqual(added.sort(), ['carte-ubs-maman', 'carte-ubs-papa', 'paiement-facture-carte']);
  assert.equal((await db.get('accounts', 'ubs')).name, 'UBS privé');
  assert.equal((await db.get('accounts', 'carte-ubs-papa')).billPaidFrom, 'ubs');
  assert.deepEqual(await R.upgradeSeed(db, seed), [], 'une seule fois');
});
