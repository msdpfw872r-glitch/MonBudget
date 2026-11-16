/**
 * contrats.test.mjs — Tests : contrats détectés par la référence de paiement, règles par contrat,
 * « Ordre e-Bill » sans nom retrouvé. Données INVENTÉES sur le modèle d'un vrai relevé.
 * Lancer : npm test
 *
 * Version : 0.23.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-16
 *
 * Historique :
 *   0.23.0 FRE (Fidag)  Première version.
 *   0.23.1 FRE (Fidag)  À trier : contrats groupés ; « Toujours classer » crée la règle du contrat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as G from '../app/src/core/regles.js';
import * as K from '../app/src/core/contrats.js';
import * as E from '../app/src/core/entretien.js';
import { orderPending, countByMerchant } from '../app/src/core/tri.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const pay = (id, date, amount, name, reference, status = 'a-trier') => ({ id, accountId: 'bcvs', date, amount, merchant: name,
  merchantKey: name.toUpperCase(), description: 'Ordre e-Bill', counterparty: { name }, reference, status });

/** Deux contrats d'un opérateur (payés chaque mois), une série de factures numérotées, des e-Bill sans nom. */
function data() {
  const t = [];
  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, '0');
    t.push(pay(`a${m}`, `2026-${mm}-28`, -30 - m, 'Telco Exemple', `0000001111222233${String(40000 + m * 7).padStart(11, '0')}`));
    t.push(pay(`b${m}`, `2026-${mm}-28`, -20 - m, 'Telco Exemple', `0000001111999988${String(50000 + m * 9).padStart(11, '0')}`));
    t.push(pay(`s${m}`, `2026-${mm}-21`, -1000 - m, 'Carte Exemple', `7029732${String(m).padStart(2, '0')}0${String(17331 + m).padStart(17, '0')}`.slice(0, 27)));
  }
  t.push({ ...pay('e1', '2026-07-01', -36, 'Ordre e-Bill', '000000111122223300000099999'), merchant: null, merchantKey: 'ORDRE E BILL', counterparty: { name: 'Ordre e-Bill' } });
  return t;
}

test('analyse : deux contrats en parallèle détectés, pas une série de factures numérotées', () => {
  const a = K.analyzeReferences(data());
  assert.deepEqual(a.contracts.map((c) => [c.name, c.groups.length]), [['Telco Exemple', 2]]);
  const [c] = a.contracts;
  assert.deepEqual(c.groups.map((g) => g.items.length), [6, 6]);
  assert.deepEqual(c.groups.map((g) => g.label).sort(), ['1111222233', '1111999988']);
  assert.deepEqual(a.unnamed.map((u) => [u.t.id, u.name]), [['e1', 'Telco Exemple']], 'e-Bill sans nom retrouvé par la référence');
  assert.equal(K.cleanRef('00 00001 11122 22330 00009 99999'), '000000111122223300000999999');
  assert.equal(K.cleanRef('Facture 77'), '');
});

test('règles par contrat : chaque contrat sa personne ; la règle générale reste pour le reste', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await db.putMany('transactions', data());
  await db.put('rules', { id: 'gen', merchantKey: 'TELCO EXEMPLE', personId: 'menage', categoryId: 'telephone-internet-et-tv' });
  // Avant : tout va à Ménage.
  await G.reclassifyMatching(db, 'gen');
  assert.equal((await db.get('transactions', 'a1')).personId, 'menage');
  const [c] = await K.contractsToSetUp(db);
  const [ga, gb] = c.groups;
  assert.equal(ga.general.id, 'gen');
  const ra = await K.saveContractRule(db, { merchantKey: c.merchantKey, prefix: ga.prefix, label: ga.label, personId: 'maman', categoryId: 'telephone-internet-et-tv' });
  const rb = await K.saveContractRule(db, { merchantKey: c.merchantKey, prefix: gb.prefix, label: gb.label, personId: 'papa', categoryId: 'telephone-internet-et-tv' });
  const rules = await db.getAll('rules');
  const who = (id) => db.get('transactions', id);
  assert.equal(G.findRule(rules, 'TELCO EXEMPLE', (await who(ga.items[0].id)).reference).id, ra.id);
  assert.equal(G.findRule(rules, 'TELCO EXEMPLE', (await who(gb.items[0].id)).reference).id, rb.id);
  assert.equal(G.findRule(rules, 'TELCO EXEMPLE', '999999999999999999999999999').id, 'gen', 'autre référence : règle générale');
  assert.equal(G.findRule(rules, 'TELCO EXEMPLE', null).id, 'gen');
  // Les opérations classées par la règle générale sont reclassées par contrat (pas « à la main »).
  const p = await G.reclassifyPreview(db, ra);
  assert.equal(p.byRule.length, 6);
  await G.reclassifyMatching(db, ra.id);
  await G.reclassifyMatching(db, rb.id);
  assert.equal((await who(ga.items[0].id)).personId, 'maman');
  assert.equal((await who(gb.items[0].id)).personId, 'papa');
  assert.equal(K.contractOf(await who(ga.items[0].id), await db.getAll('rules')), ga.label);
  assert.equal((await K.contractsToSetUp(db)).length, 0, 'plus rien à configurer');
  // L'e-Bill sans nom : retrouvé puis classé par la règle de son contrat.
  const r = await E.refreshPending(db);
  assert.ok(r.corrigees >= 1);
  const e1 = await who('e1');
  assert.deepEqual([e1.merchant, e1.status, e1.personId], ['Telco Exemple', 'classee', ga.items[0].reference.startsWith(ra.refPrefix) ? 'maman' : 'papa']);
});

test('« Toujours classer » sur une opération d’un contrat met à jour la règle de CE contrat', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await db.putMany('transactions', data());
  const [c] = K.analyzeReferences(await db.getAll('transactions')).contracts;
  const ra = await K.saveContractRule(db, { merchantKey: c.merchantKey, prefix: c.groups[0].prefix, label: c.groups[0].label, personId: 'maman', categoryId: 'divers' });
  const tx = c.groups[0].items[0];
  const res = await G.classify(db, tx.id, { personId: 'papa', categoryId: 'telephone-internet-et-tv', remember: true });
  assert.equal(res.rule.id, ra.id);
  assert.equal((await db.get('rules', ra.id)).personId, 'papa');
  assert.equal((await db.getAll('rules')).length, 1, 'pas de règle générale créée en plus');
});

test('À trier : chaque contrat groupé à part ; « Toujours classer » crée la règle de CE contrat', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  const list = data().filter((t) => t.merchant === 'Telco Exemple');
  await db.putMany('transactions', list);
  const [c] = K.analyzeReferences(list).contracts;
  const of = new Map();
  for (const g of c.groups) for (const t of g.items) of.set(t.id, g);
  const groupOf = (t) => (of.has(t.id) ? `${t.merchantKey}|${of.get(t.id).prefix}` : t.merchantKey);
  const ordered = orderPending(list, 'frequent', groupOf).map((t) => t.id[0]);
  assert.deepEqual(ordered.join(''), ordered[0].repeat(6) + (ordered[0] === 'a' ? 'b' : 'a').repeat(6), 'les 6 paiements d’un contrat, puis les 6 de l’autre');
  assert.deepEqual([...countByMerchant(list, groupOf).values()], [6, 6]);
  const g = of.get('a1');
  const res = await G.classify(db, 'a1', { personId: 'maman', categoryId: 'divers', remember: true, contract: { prefix: g.prefix, label: g.label } });
  assert.deepEqual([res.rule.refPrefix, res.rule.contractLabel], [g.prefix, g.label]);
  assert.equal(res.alsoClassified, 5, 'seulement les autres paiements de ce contrat');
  assert.equal((await db.get('transactions', 'b1')).status, 'a-trier', 'l’autre contrat reste à trier');
});
