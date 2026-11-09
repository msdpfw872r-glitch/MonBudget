/**
 * verrou.test.mjs — Tests du verrou : création / arrivée dans l'espace chiffré, Face ID (PRF) hors ligne,
 * phrase de passe, verrouillage automatique, base locale illisible sans clé.
 * Lancer : npm test
 *
 * Version : 0.10.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.10.1 FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openRawMemoryDb, PHYSICAL_STORES, SYNCED_STORES } from '../app/src/data/db.js';
import { openVaultDb } from '../app/src/data/coffre.js';
import * as K from '../app/src/core/chiffrement.js';
import * as S from '../app/src/core/synchro.js';
import * as V from '../app/src/core/verrou.js';
import * as R from '../app/src/core/reglages.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const PHRASE = 'vélo jardin soleil 1954';
const USER = { uid: 'UID', email: 'a@b.ch' };
const phys = () => openRawMemoryDb(PHYSICAL_STORES);
const passkey = (label) => ({ credentialId: K.randomBytes(16), prfSalt: K.randomBytes(32), prfSecret: K.randomBytes(32), label });

// Un seul espace pour les tests (PBKDF2 600 000 itérations prend un moment).
const remote = S.memoryRemote();
const ipad1 = phys();
const keys1 = await V.createSpace(ipad1, remote, PHRASE, USER);

test('premier appareil : espace créé dans le cloud et clés gardées sur l’appareil', async () => {
  assert.ok(remote.keys.get('passphrase'));
  const dev = await V.readDevice(ipad1);
  assert.deepEqual([dev.uid, dev.email, dev.passkey], ['UID', 'a@b.ch', null]);
  assert.deepEqual(dev.passphraseEnv, remote.keys.get('passphrase'));
  await assert.rejects(V.createSpace(phys(), remote, PHRASE, USER), /existe déjà/);
  assert.equal(await V.readDevice(phys()), null, 'appareil neuf : rien');
});

test('Face ID : activé avec la phrase de passe, puis ouvre seul, sans Internet', async () => {
  const pk = passkey('iPad de Maman');
  await assert.rejects(V.addDevicePasskey(ipad1, 'mauvaise phrase longue', pk), /incorrecte/);
  await V.addDevicePasskey(ipad1, PHRASE, pk);
  const dev = await V.readDevice(ipad1);
  assert.equal(dev.passkey.label, 'iPad de Maman');
  assert.equal(dev.passkey.prfSalt, K.toB64(pk.prfSalt));
  assert.equal(remote.keys.size, 1, 'l’enveloppe Face ID reste sur l’appareil');
  const k = await V.unlockWithPrf(ipad1, pk.prfSecret);
  assert.equal(await K.docId(k, 'rules', 'r'), await K.docId(keys1, 'rules', 'r'), 'même clé des données');
  await assert.rejects(V.unlockWithPrf(ipad1, K.randomBytes(32)), /phrase de passe/);
});

test('données de l’appareil : lisibles seulement une fois déverrouillé', async () => {
  const p = phys();
  const k = await V.createSpace(p, S.memoryRemote(), PHRASE, USER);
  const db = await openVaultDb(p, k);
  await R.installSeed(db, seed);
  const pk = passkey('iPad');
  await V.addDevicePasskey(p, PHRASE, pk);
  // « Verrouiller » = oublier la clé et la mémoire ; on rouvre avec Face ID.
  const again = await openVaultDb(p, await V.unlockWithPrf(p, pk.prfSecret));
  assert.equal(await again.count('categories'), await db.count('categories'));
  await assert.rejects(openVaultDb(p, await K.openDek(K.generateDek())), /ne s’ouvrent pas/);
});

test('phrase de passe hors ligne ; phrase changée ailleurs : reprise depuis le cloud', async () => {
  const r = S.memoryRemote();
  const a = phys();
  await V.createSpace(a, r, PHRASE, USER);
  const b = phys();
  await V.joinSpace(b, r, PHRASE, USER);
  await V.unlockWithPassphrase(b, PHRASE); // sans cloud
  await assert.rejects(V.joinSpace(phys(), r, 'pas la bonne phrase', USER), /incorrecte/);

  await S.changePassphrase(r, PHRASE, 'nouvelle phrase secrète 2026');
  await assert.rejects(V.unlockWithPassphrase(b, 'nouvelle phrase secrète 2026'), /incorrecte/, 'hors ligne : copie locale');
  await V.unlockWithPassphrase(b, 'nouvelle phrase secrète 2026', r);
  await V.unlockWithPassphrase(b, 'nouvelle phrase secrète 2026'); // la copie locale est à jour
});

test('deuxième appareil : rejoint l’espace et reçoit les données', async () => {
  const r = S.memoryRemote();
  const a = phys();
  const ka = await V.createSpace(a, r, PHRASE, USER);
  const dba = await openVaultDb(a, ka);
  await R.installSeed(dba, seed);
  await dba.put('rules', { id: 'r1', merchantKey: 'COOP' });
  await S.syncNow(dba, r, ka, { uid: 'UID' });

  const b = phys();
  const kb = await V.joinSpace(b, r, PHRASE, USER);
  const dbb = await openVaultDb(b, kb);
  await S.syncNow(dbb, r, kb, { uid: 'UID' });
  for (const s of SYNCED_STORES) assert.equal(await dbb.count(s), await dba.count(s), s);
  assert.equal((await dbb.get('rules', 'r1')).merchantKey, 'COOP');
  assert.ok(!JSON.stringify(await b.getAll('coffre')).includes('COOP'));
});

test('verrouillage automatique après une minute hors de l’app', () => {
  assert.equal(V.AUTO_LOCK_MS, 60000);
  assert.equal(V.shouldLock(null, 100000), false);
  assert.equal(V.shouldLock(0, 59999), false);
  assert.equal(V.shouldLock(0, 60000), true);
});
