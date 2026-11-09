/**
 * db.test.mjs — Tests du suivi des changements (synchronisation) : updatedAt, outbox, traces de suppression.
 * Lancer : npm test
 *
 * Version : 0.10.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.8.2  FRE (Fidag)  Première version.
 *   0.8.6  FRE (Fidag)  db.onChange.
 *   0.10.0 FRE (Fidag)  Schéma 4.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb, openRawMemoryDb, SYNCED_STORES, BACKUP_STORES, STORES, SCHEMA_VERSION } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));

test('schéma 4 : table outbox, tables synchronisées et sauvegardées', () => {
  assert.equal(SCHEMA_VERSION, 4);
  assert.ok('outbox' in STORES);
  assert.deepEqual(SYNCED_STORES, ['people', 'accounts', 'categories', 'transactions', 'rules', 'imports']);
  assert.ok(!SYNCED_STORES.includes('settings') && !SYNCED_STORES.includes('outbox'));
  assert.ok(!BACKUP_STORES.includes('outbox') && BACKUP_STORES.includes('settings'));
});

test('écrire : updatedAt posé et entrée dans outbox', async () => {
  let clock = 1000;
  const db = openMemoryDb({ now: () => clock });
  await db.put('rules', { id: 'r1', merchantKey: 'MIGROS' });
  assert.equal((await db.get('rules', 'r1')).updatedAt, 1000);
  assert.deepEqual(await db.get('outbox', 'rules/r1'), { id: 'rules/r1', store: 'rules', recId: 'r1', updatedAt: 1000, deleted: false });
  // Même milliseconde : dates quand même croissantes.
  await db.put('rules', { id: 'r1', merchantKey: 'MIGROS M' });
  assert.equal((await db.get('rules', 'r1')).updatedAt, 1001);
  assert.equal(await db.count('outbox'), 1, 'une seule entrée par enregistrement');
  clock = 5000;
  await db.putMany('transactions', [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual((await db.getAll('transactions')).map((t) => t.updatedAt), [5000, 5001]);
  assert.equal(await db.count('outbox'), 3);
});

test('supprimer et vider laissent une trace « supprimé »', async () => {
  const db = openMemoryDb();
  await db.putMany('transactions', [{ id: 'a' }, { id: 'b' }]);
  await db.delete('transactions', 'a');
  assert.equal(await db.get('transactions', 'a'), undefined);
  assert.equal((await db.get('outbox', 'transactions/a')).deleted, true);
  await db.clear('transactions');
  assert.equal((await db.get('outbox', 'transactions/b')).deleted, true);
  assert.equal(await db.count('transactions'), 0);
});

test('settings et outbox ne sont pas suivis ; db.raw écrit sans suivi', async () => {
  const db = openMemoryDb();
  await db.put('settings', { id: 'app', x: 1 });
  assert.equal((await db.get('settings', 'app')).updatedAt, undefined);
  assert.equal(await db.count('outbox'), 0);
  await db.raw.put('transactions', { id: 'du-cloud', updatedAt: 42 });
  assert.equal((await db.get('transactions', 'du-cloud')).updatedAt, 42, 'date du cloud gardée');
  await db.raw.delete('transactions', 'du-cloud');
  assert.equal(await db.count('outbox'), 0);
});

test('données de départ : toutes suivies (prêtes pour le premier envoi)', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  let n = 0;
  for (const s of SYNCED_STORES) {
    const all = await db.getAll(s);
    assert.ok(all.every((o) => typeof o.updatedAt === 'number'), `${s} : updatedAt partout`);
    n += all.length;
  }
  assert.equal(await db.count('outbox'), n);
});

test('base sans suivi : mêmes méthodes', async () => {
  const raw = openRawMemoryDb();
  await raw.put('transactions', { id: 'a' });
  assert.equal((await raw.get('transactions', 'a')).updatedAt, undefined);
});

test('onChange : appelé après une modification suivie, pas pour settings ni db.raw', async () => {
  const db = openMemoryDb();
  let n = 0;
  db.onChange = () => { n++; };
  await db.put('rules', { id: 'r' });
  await db.putMany('transactions', [{ id: 'a' }]);
  await db.delete('transactions', 'a');
  await db.clear('rules');
  assert.equal(n, 4);
  await db.put('settings', { id: 'app' });
  await db.raw.put('rules', { id: 'x' });
  assert.equal(n, 4);
  db.onChange = () => { throw new Error('boum'); };
  await db.put('rules', { id: 'y' }); // une erreur du signal ne bloque pas l'écriture
  assert.ok(await db.get('rules', 'y'));
});
