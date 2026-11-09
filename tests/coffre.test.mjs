/**
 * coffre.test.mjs — Tests de la base chiffrée sur l'appareil (coffre.js).
 * Lancer : npm test
 *
 * Version : 0.10.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.10.0 FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openRawMemoryDb, PHYSICAL_STORES, SYNCED_STORES } from '../app/src/data/db.js';
import { openVaultDb, migratePlain, wipeDevice, hasVaultData } from '../app/src/data/coffre.js';
import * as K from '../app/src/core/chiffrement.js';
import * as R from '../app/src/core/reglages.js';
import * as G from '../app/src/core/regles.js';
import * as B from '../app/src/core/sauvegarde.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const dek = K.generateDek();
const raw = new Uint8Array(dek);
const keys = await K.openDek(new Uint8Array(raw));
const reopen = async () => K.openDek(new Uint8Array(raw));
const phys = () => openRawMemoryDb(PHYSICAL_STORES);

test('rien de lisible dans IndexedDB ; tout revient après réouverture', async () => {
  const p = phys();
  const db = await openVaultDb(p, keys);
  await R.installSeed(db, seed);
  await db.put('transactions', { id: '2026-10-03|-64.8|****1111|MIGROS M SION|0', description: 'MIGROS M SION', merchantKey: 'MIGROS M SION', amount: -64.8, status: 'a-trier', accountId: 'ubs' });
  await G.classify(db, '2026-10-03|-64.8|****1111|MIGROS M SION|0', { personId: 'maman', categoryId: 'alimentation-et-courses', remember: true });
  await db.put('settings', { id: 'app', lastBackupAt: '2026-11-01T10:00:00Z' });

  const stored = JSON.stringify(await p.getAll('coffre'));
  for (const w of ['MIGROS', 'Maman', 'alimentation', '****1111', 'transactions', 'lastBackupAt', '64.8']) assert.ok(!stored.includes(w), `« ${w} » visible`);
  for (const s of Object.keys(PHYSICAL_STORES).filter((x) => !['coffre', 'appareil'].includes(x))) assert.equal(await p.count(s), 0, `table en clair ${s} vide`);
  assert.ok(await hasVaultData(p));

  const again = await openVaultDb(p, await reopen());
  for (const s of [...SYNCED_STORES, 'settings', 'outbox']) assert.deepEqual(await again.getAll(s), await db.getAll(s), s);
  assert.equal((await again.getAllWhere('transactions', 'personId', 'maman')).length, 1);
  assert.equal(await again.countWhere('transactions', 'status', 'classee'), 1);
});

test('suppressions et « vider » effacent aussi les données chiffrées', async () => {
  const p = phys();
  const db = await openVaultDb(p, keys);
  await db.putMany('rules', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  await db.delete('rules', 'a');
  let back = await openVaultDb(p, await reopen());
  assert.deepEqual((await back.getAll('rules')).map((r) => r.id), ['b', 'c']);
  await db.clear('rules');
  back = await openVaultDb(p, await reopen());
  assert.equal(await back.count('rules'), 0);
  assert.equal((await back.get('outbox', 'rules/b')).deleted, true, 'la trace de suppression est gardée (chiffrée)');
});

test('mauvaise clé : refus clair ; document déplacé : refus', async () => {
  const p = phys();
  const db = await openVaultDb(p, keys);
  await db.put('rules', { id: 'x', merchantKey: 'COOP' });
  await assert.rejects(openVaultDb(p, await K.openDek(K.generateDek())), /ne s’ouvrent pas/);
  const [box] = await p.getAll('coffre');
  await p.put('coffre', { ...box, id: 'autre-nom' });
  await assert.rejects(openVaultDb(p, await reopen()), K.ChiffrementError);
});

test('reprise des anciennes tables en clair (avant 0.10.0), puis vidées', async () => {
  const p = phys();
  await p.putMany('transactions', [{ id: 't1', amount: -5, updatedAt: 1234 }]);
  await p.put('settings', { id: 'app', lastBackupAt: 'x' });
  await p.put('outbox', { id: 'transactions/t1', store: 'transactions', recId: 't1', updatedAt: 1234, deleted: false });
  const db = await openVaultDb(p, keys);
  assert.equal(await migratePlain(p, db), 3);
  assert.equal(await p.count('transactions'), 0);
  assert.equal(await p.count('settings'), 0);
  const back = await openVaultDb(p, await reopen());
  assert.deepEqual(await back.get('transactions', 't1'), { id: 't1', amount: -5, updatedAt: 1234 });
  assert.equal(await back.count('outbox'), 1);
});

test('sauvegarde fichier et restauration fonctionnent sur la base chiffrée', async () => {
  const p = phys();
  const db = await openVaultDb(p, keys);
  await R.installSeed(db, seed);
  await db.put('transactions', { id: 't', amount: -1 });
  const { text } = await B.createBackup(db);
  await db.delete('transactions', 't');
  await B.restoreBackup(db, B.readBackup(text));
  const back = await openVaultDb(p, await reopen());
  assert.equal((await back.get('transactions', 't')).amount, -1);
});

test('effacer l’appareil : plus rien', async () => {
  const p = phys();
  const db = await openVaultDb(p, keys);
  await db.put('rules', { id: 'r' });
  await p.put('appareil', { id: 'cles', x: 1 });
  await wipeDevice(p);
  assert.equal(await p.count('coffre'), 0);
  assert.equal(await p.count('appareil'), 0);
});
