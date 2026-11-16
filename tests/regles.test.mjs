/**
 * regles.test.mjs — Tests : règle modifiée, reclasser (au choix) les opérations déjà classées par elle.
 * Lancer : npm test
 *
 * Version : 0.22.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.13.0 FRE (Fidag)  Première version.
 *   0.17.0 FRE (Fidag)  Reclasser avec ou sans les tris à la main ; filtrer et ordonner les règles.
 *   0.22.0 FRE (Fidag)  Règle « pour qui : la titulaire de la carte ».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as G from '../app/src/core/regles.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));

async function base() {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await db.putMany('transactions', [
    { id: 'a', date: '2026-10-01', description: 'MIGROS', merchantKey: 'MIGROS', amount: -10, status: 'a-trier' },
    { id: 'b', date: '2026-10-02', description: 'MIGROS', merchantKey: 'MIGROS', amount: -20, status: 'a-trier' },
    { id: 'c', date: '2026-10-03', description: 'MIGROS', merchantKey: 'MIGROS', amount: -30, status: 'a-trier' },
  ]);
  const { rule } = await G.classify(db, 'a', { personId: 'menage', categoryId: 'alimentation-et-courses', remember: true });
  await G.classify(db, 'c', { personId: 'maman', categoryId: 'alimentation-et-courses', remember: false }); // choix à la main
  return { db, rule: rule ?? (await db.getAll('rules'))[0] };
}

test('règle modifiée : les anciennes opérations restent comme elles sont tant qu’on ne demande rien', async () => {
  const { db, rule } = await base();
  assert.equal((await db.get('transactions', 'b')).ruleId, rule.id, 'b classée par la règle');
  const updated = await G.saveRule(db, rule.id, { merchantKey: 'MIGROS', personId: 'papa', categoryId: 'alimentation-et-courses' });
  assert.equal((await db.get('transactions', 'a')).personId, 'menage', '« Laisser comme ça »');
  const out = await G.outdatedByRule(db, updated);
  assert.deepEqual(out.map((t) => t.id).sort(), ['a', 'b']);
});

test('reclasser : seulement les opérations classées par cette règle', async () => {
  const { db, rule } = await base();
  await G.saveRule(db, rule.id, { merchantKey: 'MIGROS', personId: 'papa', categoryId: 'alimentation-et-courses' });
  assert.equal(await G.reclassifyByRule(db, rule.id), 2);
  assert.equal((await db.get('transactions', 'a')).personId, 'papa');
  assert.equal((await db.get('transactions', 'b')).personId, 'papa');
  assert.equal((await db.get('transactions', 'c')).personId, 'maman', 'le choix fait à la main n’est pas touché');
  assert.equal(await G.reclassifyByRule(db, rule.id), 0, 'rien de plus la 2e fois');
  await assert.rejects(G.reclassifyByRule(db, 'inconnue'), /n’existe plus/);
});

test('reclasser : aperçu (par la règle / à la main / à trier) puis au choix avec ou sans les tris à la main', async () => {
  const { db, rule } = await base();
  await db.put('transactions', { id: 'd', date: '2026-10-04', description: 'MIGROS', merchantKey: 'MIGROS', amount: -40, status: 'a-trier' });
  await G.saveRule(db, rule.id, { merchantKey: 'MIGROS', personId: 'papa', categoryId: 'alimentation-et-courses' });
  const updated = await db.get('rules', rule.id);
  const p = await G.reclassifyPreview(db, updated);
  assert.deepEqual([p.byRule.map((t) => t.id).sort(), p.manual.map((t) => t.id), p.pending.map((t) => t.id)], [['a', 'b'], ['c'], ['d']]);
  assert.equal(await G.reclassifyMatching(db, rule.id), 3, 'a, b et d');
  assert.equal((await db.get('transactions', 'c')).personId, 'maman', 'à la main : pas touchée');
  assert.equal((await db.get('transactions', 'd')).status, 'classee');
  assert.equal(await G.reclassifyMatching(db, rule.id, { includeManual: true }), 1, 'c aussi quand on le demande');
  assert.deepEqual([(await db.get('transactions', 'c')).personId, (await db.get('transactions', 'c')).ruleId], ['papa', rule.id]);
});

test('règles : filtrer (texte, pour qui, catégorie) et ordonner', () => {
  const rules = [
    { id: '1', merchantKey: 'MIGROS', personId: 'menage', categoryId: 'a', hits: 5, lastUsedAt: '2026-10-01' },
    { id: '2', merchantKey: 'COOP', personId: 'maman', categoryId: 'a', hits: 9, lastUsedAt: '2026-09-01' },
    { id: '3', merchantKey: 'GARAGE DU CENTRE', personId: 'papa', categoryId: 'v', hits: 1, lastUsedAt: '2026-11-01' },
  ];
  const ctx = { categoriesById: new Map([['a', { name: 'Alimentation' }], ['v', { name: 'Voiture' }]]), peopleById: new Map([['maman', { name: 'Maman' }]]) };
  const ids = (l) => l.map((r) => r.id);
  assert.deepEqual(ids(G.filterRules(rules, { query: 'garage' }, ctx)), ['3']);
  assert.deepEqual(ids(G.filterRules(rules, { query: 'aliment' }, ctx)), ['1', '2'], 'cherche aussi dans la catégorie');
  assert.deepEqual(ids(G.filterRules(rules, { query: 'maman' }, ctx)), ['2']);
  assert.deepEqual(ids(G.filterRules(rules, { categoryId: 'v' })), ['3']);
  assert.deepEqual(ids(G.filterRules(rules, { personId: 'menage' })), ['1']);
  assert.deepEqual(ids(G.sortRules(rules, 'alpha')), ['2', '3', '1']);
  assert.deepEqual(ids(G.sortRules(rules, 'hits')), ['2', '1', '3']);
  assert.deepEqual(ids(G.sortRules(rules, 'recent')), ['3', '1', '2']);
});

test('règle « titulaire de la carte » : Coop payé avec la carte de Maman → Maman, avec celle de Papa → Papa', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  const cm = await R.createCardAccount(db, { name: 'Carte Maman', ref: '****1061', importFormat: 'swisscard-csv', personId: 'maman' });
  const cp = await R.createCardAccount(db, { name: 'Carte Papa', ref: '****9004', importFormat: 'swisscard-csv', personId: 'papa' });
  const t = (id, accountId, status = 'a-trier') => ({ id, accountId, date: '2026-03-10', description: 'COOP', merchantKey: 'COOP', amount: -10, status });
  await db.putMany('transactions', [t('m', cm.id), t('p', cp.id), t('b', 'bcvs'), t('done', cm.id)]);
  await db.put('transactions', { ...(await db.get('transactions', 'done')), status: 'classee', personId: 'menage', categoryId: 'divers' });
  await db.put('rules', { id: 'r', merchantKey: 'COOP', personId: 'menage', categoryId: 'alimentation-et-courses' });
  // Passer la règle à « titulaire de la carte » (autorisé seulement pour une règle).
  await G.saveRule(db, 'r', { merchantKey: 'COOP', personId: G.CARD_HOLDER, categoryId: 'alimentation-et-courses' });
  assert.equal(G.personFor({ personId: G.CARD_HOLDER }, { kind: 'compte' }), null, 'compte bancaire : pas de titulaire');
  const rule = await db.get('rules', 'r');
  const p = await G.reclassifyPreview(db, rule);
  assert.deepEqual(p.pending.map((x) => x.id).sort(), ['m', 'p'], 'l’opération de la BCVs n’est pas concernée');
  assert.deepEqual(p.manual.map((x) => x.id), ['done']);
  await G.reclassifyMatching(db, 'r');
  assert.equal((await db.get('transactions', 'm')).personId, 'maman');
  assert.equal((await db.get('transactions', 'p')).personId, 'papa');
  assert.equal((await db.get('transactions', 'b')).status, 'a-trier', 'paiement depuis la banque : reste à trier');
  assert.deepEqual(G.filterRules([rule], { query: 'titulaire' }).length, 1);
  await assert.rejects(G.classify(db, 'b', { personId: G.CARD_HOLDER, categoryId: 'divers' }), /pour qui/, 'une opération a toujours une vraie personne');
});
