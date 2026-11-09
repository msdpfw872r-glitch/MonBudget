/**
 * regles.test.mjs — Tests : règle modifiée, reclasser (au choix) les opérations déjà classées par elle.
 * Lancer : npm test
 *
 * Version : 0.13.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.13.0 FRE (Fidag)  Première version.
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
