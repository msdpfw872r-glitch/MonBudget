/**
 * synchro.test.mjs — Tests de la synchronisation chiffrée avec un faux cloud en mémoire :
 * coffre (phrase de passe, passkey), migration, deuxième iPad, dernière écriture gagnante,
 * suppressions, hors ligne, lots, documents falsifiés, restauration d'une sauvegarde.
 * Lancer : npm test
 *
 * Version : 0.9.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.8.4  FRE (Fidag)  Première version.
 *   0.9.0  FRE (Fidag)  Réglage « appareil » (Face ID) gardé à la restauration et absent des sauvegardes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb, SYNCED_STORES } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as G from '../app/src/core/regles.js';
import * as B from '../app/src/core/sauvegarde.js';
import * as K from '../app/src/core/chiffrement.js';
import * as S from '../app/src/core/synchro.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const PHRASE = 'vélo jardin soleil 1954';
const UID = 'BgSfJCtyQ5TL0YRxWEOJG0YmFp22';

/** Un iPad : base avec données de départ et horloge réglable. */
async function ipad(start) {
  const clock = { t: start };
  const db = openMemoryDb({ now: () => clock.t });
  await R.installSeed(db, seed);
  return { db, clock };
}
const strip = (list) => list.map(({ updatedAt, ...o }) => o).sort((a, b) => String(a.id).localeCompare(String(b.id)));
async function sameData(a, b) {
  for (const s of SYNCED_STORES) assert.deepEqual(strip(await b.getAll(s)), strip(await a.getAll(s)), `table ${s}`);
}

// Un seul coffre pour tous les tests (PBKDF2 600 000 itérations prend un moment).
const cloudKeys = S.memoryRemote();
const keys = await S.createVault(cloudKeys, PHRASE);
const envPhrase = await cloudKeys.getKey('passphrase');
function cloud() {
  const r = S.memoryRemote();
  r.keys.set('passphrase', envPhrase);
  return r;
}
const sync = (d, remote, k = keys) => S.syncNow(d.db, remote, k, { uid: UID });

test('coffre : création unique, phrase de passe, passkey, changement de phrase', async () => {
  const remote = S.memoryRemote();
  assert.equal(await S.vaultExists(remote), false);
  const k1 = await S.createVault(remote, PHRASE);
  assert.equal(await S.vaultExists(remote), true);
  await assert.rejects(S.createVault(remote, PHRASE), /existe déjà/);
  await assert.rejects(S.unlockWithPassphrase(remote, 'une autre phrase longue'), /Phrase de secours incorrecte/);

  const pk = { credentialId: K.randomBytes(16), prfSalt: K.randomBytes(32), prfSecret: K.randomBytes(32), label: 'iPad de Maman' };
  const name = await S.addPasskey(remote, PHRASE, pk);
  assert.match(name, /^pk_[0-9a-f]{16}$/);
  assert.equal((await S.passkeyEnvelope(remote, pk.credentialId)).prfSalt, K.toB64(pk.prfSalt));
  const k2 = await S.unlockWithPasskey(remote, pk.credentialId, pk.prfSecret);
  assert.deepEqual(await K.decryptJson(k2, await K.encryptJson(k1, { a: 1 }, 'x'), 'x'), { a: 1 }, 'même clé de données');
  await assert.rejects(S.unlockWithPasskey(remote, K.randomBytes(16), pk.prfSecret), /pas encore prêt/);

  await S.changePassphrase(remote, PHRASE, 'nouvelle phrase de secours 2026');
  await assert.rejects(S.unlockWithPassphrase(remote, PHRASE), /incorrecte/);
  const k3 = await S.unlockWithPassphrase(remote, 'nouvelle phrase de secours 2026');
  assert.equal(await K.docId(k3, 'rules', 'r'), await K.docId(k1, 'rules', 'r'));
  await S.unlockWithPasskey(remote, pk.credentialId, pk.prfSecret); // la passkey marche toujours
  assert.deepEqual((await remote.listKeys()).map((k) => k.name).sort(), ['passphrase', name]);
});

test('premier iPad : toutes les données partent, chiffrées ; rien en clair dans le cloud', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await a.db.put('transactions', { id: '2026-10-03|-64.8|****1111|MIGROS M SION|0', accountId: 'ubs', description: 'MIGROS M SION', amount: -64.8, status: 'a-trier' });
  const n = SYNCED_STORES.length && (await Promise.all(SYNCED_STORES.map((s) => a.db.count(s)))).reduce((x, y) => x + y, 0);
  const r = await sync(a, remote);
  assert.equal(r.sent, n);
  assert.equal(remote.docs.size, n);
  assert.equal(await S.pendingCount(a.db), 0);
  const all = JSON.stringify([...remote.docs.entries()]);
  for (const word of ['MIGROS', 'Maman', 'alimentation', '****1111', 'transactions']) assert.ok(!all.includes(word), `« ${word} » n’est pas visible`);
  assert.ok((await a.db.get('settings', 'sync')).joinedAt);
  // Deuxième passage : nos propres envois reviennent, rien ne change.
  const again = await sync(a, remote);
  assert.deepEqual([again.applied, again.sent], [0, 0]);
});

test('deuxième iPad : reçoit tout, le cloud gagne, ses ajouts partent', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await R.savePerson(a.db, { name: 'Tante Rose', color: '#B03A2E' });
  await a.db.put('categories', { ...(await a.db.get('categories', 'alimentation-et-courses')), name: 'Courses' });
  await sync(a, remote);

  const b = await ipad(9000); // installé plus tard : ses données de départ sont « plus récentes »
  await b.db.put('rules', { id: 'r-b', merchantKey: 'COOP', personId: 'menage', categoryId: 'alimentation-et-courses' });
  const r = await sync(b, remote);
  assert.ok(r.applied > 0);
  assert.equal((await b.db.get('categories', 'alimentation-et-courses')).name, 'Courses', 'le cloud gagne à l’arrivée');
  assert.ok(await b.db.get('people', (await a.db.getAll('people')).find((p) => p.name === 'Tante Rose').id));
  assert.equal(r.migrated, 1, 'seule la règle propre à B part');
  await sync(a, remote);
  await sameData(a.db, b.db);
});

test('dernière écriture gagnante, dans les deux sens', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await a.db.put('transactions', { id: 't1', description: 'LOYER', amount: -2550, status: 'a-trier' });
  await sync(a, remote);
  const b = await ipad(1500);
  await sync(b, remote);

  a.clock.t = 2000;
  await G.classify(a.db, 't1', { personId: 'menage', categoryId: 'logement-loyer-hypotheque', remember: false });
  b.clock.t = 3000; // B modifie après A, sans avoir vu le changement de A
  await b.db.put('transactions', { ...(await b.db.get('transactions', 't1')), note: 'loyer novembre' });
  await sync(a, remote);
  const rb = await sync(b, remote);
  assert.equal(rb.kept, 1, 'B garde sa version, plus récente');
  await sync(a, remote);
  assert.equal((await a.db.get('transactions', 't1')).note, 'loyer novembre');
  assert.equal((await a.db.get('transactions', 't1')).personId ?? null, null, 'version entière de B (par enregistrement)');
  await sameData(a.db, b.db);

  a.clock.t = 4000;
  await a.db.put('transactions', { ...(await a.db.get('transactions', 't1')), note: 'A gagne' });
  await sync(a, remote);
  await sync(b, remote);
  assert.equal((await b.db.get('transactions', 't1')).note, 'A gagne');
});

test('suppressions transmises (opération, règle, import annulé)', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await a.db.putMany('transactions', [{ id: 'x1', importId: 'i1' }, { id: 'x2', importId: 'i1' }]);
  await a.db.put('rules', { id: 'r1', merchantKey: 'MIGROS' });
  await sync(a, remote);
  const b = await ipad(1100);
  await sync(b, remote);
  assert.ok(await b.db.get('rules', 'r1'));

  a.clock.t = 5000;
  await G.deleteRule(a.db, 'r1');
  await a.db.delete('transactions', 'x1');
  await sync(a, remote);
  await sync(b, remote);
  assert.equal(await b.db.get('rules', 'r1'), undefined);
  assert.equal(await b.db.get('transactions', 'x1'), undefined);
  assert.ok(await b.db.get('transactions', 'x2'));
  assert.equal(await S.pendingCount(b.db), 0, 'une suppression reçue ne repart pas');
});

test('hors ligne : les changements attendent, puis partent', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await sync(a, remote);
  await a.db.put('rules', { id: 'r1', merchantKey: 'COOP' });
  const realPush = remote.push;
  remote.push = async () => { throw new Error('réseau absent'); };
  await assert.rejects(sync(a, remote), /réseau absent/);
  assert.equal(await S.pendingCount(a.db), 1, 'gardé dans la file');
  remote.push = realPush;
  const r = await sync(a, remote);
  assert.equal(r.sent, 1);
  assert.equal(await S.pendingCount(a.db), 0);
});

test('modifié pendant l’envoi : reste dans la file pour la fois suivante', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await sync(a, remote);
  await a.db.put('rules', { id: 'r1', merchantKey: 'COOP' });
  const realPush = remote.push.bind(remote);
  remote.push = async (docs) => { await realPush(docs); a.clock.t = 7000; await a.db.put('rules', { id: 'r1', merchantKey: 'COOP CITY' }); };
  await sync(a, remote);
  assert.equal(await S.pendingCount(a.db), 1);
  remote.push = realPush;
  await sync(a, remote);
  const b = await ipad(1100);
  await sync(b, remote);
  assert.equal((await b.db.get('rules', 'r1')).merchantKey, 'COOP CITY');
});

test('envoi par lots de 400 ; deux synchros en même temps = une seule', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await a.db.putMany('transactions', Array.from({ length: 900 }, (_, i) => ({ id: `t${i}`, amount: -i })));
  const [r1, r2] = await Promise.all([sync(a, remote), sync(a, remote)]);
  assert.strictEqual(r1, r2);
  assert.equal(remote.pushes, Math.ceil(r1.sent / 400));
  assert.ok(remote.pushes >= 3);
});

test('document falsifié ou déplacé : refusé', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await sync(a, remote);
  const [d1, d2] = [...remote.docs.values()];
  // Contenu d'un document copié sous le nom d'un autre.
  remote.docs.set(d2.docId, { ...d1, docId: d2.docId, syncedAt: 99 });
  const b = await ipad(1100);
  await assert.rejects(sync(b, remote), K.ChiffrementError);
  // Autre clé : illisible.
  const other = await K.openDek(K.generateDek());
  const c = await ipad(1200);
  await assert.rejects(sync(c, remote, other), K.ChiffrementError);
});

test('restaurer une sauvegarde fichier : elle remplace aussi les données du cloud', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await a.db.put('transactions', { id: 'ancienne', amount: -1 });
  const { text } = await B.createBackup(a.db);
  await sync(a, remote);
  const b = await ipad(1100);
  await sync(b, remote);

  a.clock.t = 2000;
  await a.db.put('transactions', { id: 'apres', amount: -2 });
  await sync(a, remote);
  b.clock.t = 3000;
  await B.restoreBackup(b.db, B.readBackup(text));
  await sync(b, remote);
  await sync(a, remote);
  assert.equal(await a.db.get('transactions', 'apres'), undefined, 'ce qui n’était pas dans la sauvegarde disparaît partout');
  assert.ok(await a.db.get('transactions', 'ancienne'));
  await sameData(a.db, b.db);
  assert.equal(JSON.parse(text).data.settings.some((o) => o.id === 'sync'), false, 'l’état de synchro ne voyage pas dans la sauvegarde');
  assert.equal((await b.db.get('settings', 'sync')).replaceCloud, false);
});

test('données d’avant le suivi (sans updatedAt) : datées puis envoyées', async () => {
  const remote = cloud();
  const a = await ipad(1000);
  await a.db.raw.put('transactions', { id: 'vieille', amount: -5 });
  await a.db.raw.clear('outbox');
  await sync(a, remote);
  assert.equal(typeof (await a.db.get('transactions', 'vieille')).updatedAt, 'number');
  const b = await ipad(1100);
  await sync(b, remote);
  assert.equal((await b.db.get('transactions', 'vieille')).amount, -5);
});

test('réglage « appareil » (Face ID de cet iPad) : jamais dans une sauvegarde, gardé à la restauration', async () => {
  const a = await ipad(1000);
  await a.db.put('settings', { id: 'appareil', configured: true, credentialId: 'AAAA', prfSalt: 'BBBB', label: 'iPad de Maman' });
  const { text } = await B.createBackup(a.db);
  assert.equal(JSON.parse(text).data.settings.some((o) => o.id === 'appareil'), false);
  const b = await ipad(2000);
  await b.db.put('settings', { id: 'appareil', configured: true, credentialId: 'CCCC', prfSalt: 'DDDD', label: 'iPad' });
  const forged = JSON.parse(text);
  forged.data.settings.push({ id: 'appareil', credentialId: 'XXXX' }, { id: 'sync', cursor: 999, joinedAt: 'x' });
  await B.restoreBackup(b.db, B.readBackup(JSON.stringify(forged)));
  assert.equal((await b.db.get('settings', 'appareil')).credentialId, 'CCCC');
  assert.equal((await b.db.get('settings', 'sync')).replaceCloud, true);
  assert.notEqual((await b.db.get('settings', 'sync')).cursor, 999);
});
