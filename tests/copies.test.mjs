/**
 * copies.test.mjs — Tests des copies de sécurité en ligne (chiffrées, 10 au plus, commentaire).
 * Lancer : npm test
 *
 * Version : 0.12.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.12.0 FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb, SYNCED_STORES } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as K from '../app/src/core/chiffrement.js';
import * as S from '../app/src/core/synchro.js';
import * as C from '../app/src/core/copies.js';
import * as B from '../app/src/core/sauvegarde.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const keys = await K.openDek(K.generateDek());
const UID = 'UID';

async function filled(n = 3) {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await db.putMany('transactions', Array.from({ length: n }, (_, i) => ({ id: `t${i}`, description: `MIGROS SION ${i}`, amount: -i, status: 'a-trier' })));
  return db;
}

test('copie en ligne : chiffrée (commentaire compris), relue identique', async () => {
  const db = await filled();
  const remote = S.memoryRemote();
  const c = await C.createCloudCopy(db, remote, keys, { uid: UID, comment: 'Avant le tri de novembre', device: 'iPad', now: new Date(2026, 10, 9, 21, 3) });
  assert.equal(c.counts.transactions, 3);
  const stored = JSON.stringify([...remote.copies.values()]);
  for (const w of ['MIGROS', 'novembre', 'iPad', 'Maman']) assert.ok(!stored.includes(w), `« ${w} » visible`);
  const list = await C.listCloudCopies(remote, keys, { uid: UID });
  assert.deepEqual([list.length, list[0].comment, list[0].counts.transactions, list[0].device], [1, 'Avant le tri de novembre', 3, 'iPad']);
  const backup = await C.readCloudCopy(remote, keys, { uid: UID, id: list[0].id, parts: list[0].parts });
  assert.equal(backup.data.transactions.length, 3);
  // Remise : comme une sauvegarde fichier.
  await db.clear('transactions');
  await B.restoreBackup(db, backup);
  assert.equal(await db.count('transactions'), 3);
});

test('10 copies au plus : la plus ancienne part', async () => {
  const db = await filled(1);
  const remote = S.memoryRemote();
  let last;
  for (let i = 0; i < 12; i++) last = await C.createCloudCopy(db, remote, keys, { uid: UID, comment: `n° ${i}`, now: new Date(2026, 10, 1 + i) });
  const list = await C.listCloudCopies(remote, keys, { uid: UID });
  assert.equal(list.length, 10);
  assert.deepEqual([list[0].comment, list[9].comment], ['n° 11', 'n° 2'], 'plus récente d’abord ; n° 0 et 1 supprimées');
  assert.equal(last.removed.length, 1);
  await C.deleteCloudCopy(remote, list[0]);
  assert.equal((await C.listCloudCopies(remote, keys, { uid: UID })).length, 9);
});

test('grande copie : plusieurs morceaux ; autre clé : illisible ; commentaire limité', async () => {
  const db = await filled(1);
  const big = Array.from({ length: 4000 }, (_, i) => ({ id: `b${i}`, description: K.toB64(K.randomBytes(200)), amount: i, status: 'a-trier' }));
  await db.putMany('transactions', big);
  const remote = S.memoryRemote();
  await C.createCloudCopy(db, remote, keys, { uid: UID, comment: 'x'.repeat(500) });
  const [c] = await C.listCloudCopies(remote, keys, { uid: UID });
  assert.ok(c.parts >= 2, `${c.parts} morceaux`);
  assert.equal(c.comment.length, C.MAX_COMMENT);
  assert.equal((await C.readCloudCopy(remote, keys, { uid: UID, id: c.id, parts: c.parts })).data.transactions.length, 4001);
  const other = await K.openDek(K.generateDek());
  const [o] = await C.listCloudCopies(remote, other, { uid: UID });
  assert.equal(o.readable, false);
  await assert.rejects(C.readCloudCopy(remote, other, { uid: UID, id: c.id, parts: c.parts }), K.ChiffrementError);
  // Morceau manquant : refus clair.
  remote.copies.get(c.id).parts.pop();
  await assert.rejects(C.readCloudCopy(remote, keys, { uid: UID, id: c.id, parts: c.parts }), /incomplète/);
});

test('gzip : aller-retour', async () => {
  const txt = new TextEncoder().encode('Mon Budget '.repeat(1000));
  const z = await C.gzip(txt);
  assert.ok(z.length < txt.length / 10);
  assert.deepEqual(await C.gunzip(z), txt);
});
