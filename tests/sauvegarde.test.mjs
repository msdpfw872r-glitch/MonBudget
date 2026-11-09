/**
 * sauvegarde.test.mjs — Tests de la sauvegarde, de la restauration et du rappel.
 * Lancer : npm test
 *
 * Version : 0.8.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.6.0  FRE (Fidag)  Première version.
 *   0.8.2  FRE (Fidag)  Comparaison sans `updatedAt` (date de modification, suivi de synchro) ni outbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb, BACKUP_STORES } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as G from '../app/src/core/regles.js';
import * as B from '../app/src/core/sauvegarde.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));

/** Une base « vivante » : réglages modifiés, opérations, une règle, un import. */
async function liveDb() {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await R.savePerson(db, { name: 'Tante Rose', color: '#B03A2E' });
  await R.assignBankRef(db, 'carte-ubs-maman', '****1111');
  await db.putMany('transactions', [
    { id: 't1', accountId: 'ubs', date: '2026-10-02', description: 'LOYER', merchantKey: 'LOYER', amount: -2550, status: 'a-trier', importId: 'i1' },
    { id: 't2', accountId: 'carte-ubs-maman', date: '2026-10-03', description: 'MIGROS M SION', merchantKey: 'MIGROS M SION', amount: -64.8, status: 'a-trier', importId: 'i1' },
  ]);
  await G.classify(db, 't2', { personId: 'menage', categoryId: 'alimentation-et-courses', remember: true });
  await db.put('imports', { id: 'i1', date: '2026-11-01T10:00:00Z', counts: { nouvelles: 2 } });
  return db;
}

async function dump(db) {
  const out = {};
  // updatedAt = date de la modification (synchro) : une restauration la renouvelle, c'est voulu.
  for (const s of BACKUP_STORES) out[s] = (await db.getAll(s)).map(({ updatedAt, ...o }) => o);
  return out;
}

test('nom de fichier : daté jusqu’à la milliseconde, jamais deux fois le même', () => {
  const at = new Date(2026, 10, 9, 14, 3, 27, 123);
  assert.equal(B.backupFileName(at), 'MonBudget_2026-11-09_14-03-27-123.json');
  assert.equal(B.backupFileName(new Date(2026, 0, 5, 8, 4, 9, 7)), 'MonBudget_2026-01-05_08-04-09-007.json');
  const names = new Set();
  for (let ms = 0; ms < 1000; ms++) names.add(B.backupFileName(new Date(2026, 10, 9, 14, 3, 27, ms)));
  assert.equal(names.size, 1000, 'une milliseconde de plus = un autre nom');
  assert.doesNotMatch(B.backupFileName(at), /[:/\\\\]/, 'aucun caractère interdit dans un nom de fichier');
});

test('sauvegarder puis restaurer sur un autre appareil : identique à l’original', async () => {
  const db = await liveDb();
  const { text, fileName, backup } = await B.createBackup(db, { appVersion: '0.6.0', now: new Date(2026, 10, 9, 10, 0, 0, 1) });
  assert.match(fileName, /^MonBudget_2026-11-09_10-00-00-001\.json$/);
  assert.deepEqual(backup.counts, { transactions: 2, rules: 1, people: 4, accounts: 5, categories: 40, imports: 1 });

  const other = openMemoryDb(); // « autre iPad » : base neuve avec les données de départ
  await R.installSeed(other, seed);
  const read = B.readBackup(text);
  assert.equal(read.counts.transactions, 2);
  await B.restoreBackup(other, read);
  const a = await dump(db);
  const b = await dump(other);
  for (const s of BACKUP_STORES) {
    if (s === 'settings') continue;
    assert.deepEqual(b[s], a[s], `store ${s} identique`);
  }
  assert.ok((await other.get('settings', 'app')).restoredAt);
  assert.equal(backup.data.outbox, undefined, 'la file de synchro n’est pas sauvegardée');
  // Les données restaurées deviennent les plus récentes : elles partiront vers le cloud.
  const t1 = await other.get('transactions', 't1');
  assert.ok(t1.updatedAt > (await db.get('transactions', 't1')).updatedAt);
  assert.equal((await other.get('outbox', 'transactions/t1')).deleted, false);
});

test('restaurer remplace tout : ce qui n’est pas dans la sauvegarde disparaît', async () => {
  const db = await liveDb();
  const { text } = await B.createBackup(db);
  await db.put('transactions', { id: 'nouvelle', accountId: 'ubs', date: '2026-11-05', amount: -1, status: 'a-trier' });
  await R.saveCategory(db, { name: 'Jardinage', type: 'depense' });
  await B.restoreBackup(db, B.readBackup(text));
  assert.equal(await db.get('transactions', 'nouvelle'), undefined);
  assert.equal(await db.get('categories', 'jardinage'), undefined);
  assert.equal(await db.count('transactions'), 2);
});

test('si la restauration échoue en cours de route, les données d’avant sont remises', async () => {
  const db = await liveDb();
  const before = await dump(db);
  const { text } = await B.createBackup(db);
  const backup = B.readBackup(text);
  backup.data.transactions = [{ id: 'x', amount: -1 }];
  // Base qui tombe en panne en écrivant les opérations
  let fail = true;
  const broken = { ...db, putMany: async (s, objs) => { if (s === 'transactions' && fail) { fail = false; throw new Error('disque plein'); } return db.putMany(s, objs); } };
  for (const k of ['get', 'getAll', 'put', 'delete', 'clear', 'count', 'countWhere', 'getAllWhere']) broken[k] = db[k].bind(db);
  await assert.rejects(B.restoreBackup(broken, backup), (e) => e instanceof R.ReglageError && /données d’avant ont été remises/.test(e.message));
  assert.deepEqual(await dump(db), before);
});

test('fichiers refusés en mots simples', () => {
  const ok = (data) => JSON.stringify({ format: B.BACKUP_FORMAT, formatVersion: 1, schemaVersion: 2, data });
  assert.throws(() => B.readBackup('pas du tout du JSON'), /n’est pas une sauvegarde de Mon Budget/);
  assert.throws(() => B.readBackup('{"bonjour": 1}'), /n’est pas une sauvegarde de Mon Budget/);
  assert.throws(() => B.readBackup(JSON.stringify({ format: B.BACKUP_FORMAT, formatVersion: 99, data: {} })), /version plus récente/);
  assert.throws(() => B.readBackup(ok({ people: [{ id: 'a' }], categories: [{ name: 'sans id' }] })), /abîmée/);
  assert.throws(() => B.readBackup(ok({ people: [], categories: [] })), /incomplète/);
  const r = B.readBackup('﻿' + ok({ people: [{ id: 'a', name: 'A' }], categories: [{ id: 'c', name: 'C' }] }));
  assert.equal(r.counts.people, 1);
  assert.deepEqual(r.data.transactions, [], 'les genres absents deviennent des listes vides');
});

test('rappel : jamais, plus de 30 jours, après un import', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  assert.deepEqual(B.backupReminder({}, { hasData: false, now }), { due: false, reason: null, days: null });
  assert.equal(B.backupReminder({}, { hasData: true, now }).reason, 'jamais');
  assert.deepEqual(B.backupReminder({ lastBackupAt: '2026-10-01T12:00:00Z' }, { hasData: true, now }), { due: true, reason: 'ancienne', days: 39 });
  assert.equal(B.backupReminder({ lastBackupAt: '2026-11-01T12:00:00Z', lastImportAt: '2026-11-05T09:00:00Z' }, { hasData: true, now }).reason, 'import');
  assert.equal(B.backupReminder({ lastBackupAt: '2026-11-06T12:00:00Z', lastImportAt: '2026-11-05T09:00:00Z' }, { hasData: true, now }).due, false);
});

test('après une sauvegarde, le rappel disparaît', async () => {
  const db = await liveDb();
  await db.put('settings', { ...(await db.get('settings', 'app')), lastImportAt: '2026-11-05T09:00:00Z' });
  const now = new Date('2026-11-09T12:00:00Z');
  assert.equal(B.backupReminder(await db.get('settings', 'app'), { hasData: true, now }).due, true);
  await B.markBackupDone(db, now);
  assert.equal(B.backupReminder(await db.get('settings', 'app'), { hasData: true, now }).due, false);
});
