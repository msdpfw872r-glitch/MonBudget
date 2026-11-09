/**
 * chiffrement.test.mjs — Tests du chiffrement de bout en bout (DEK, enveloppes, noms de documents).
 * Lancer : npm test
 *
 * Version : 0.8.3
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.8.3  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../app/src/core/chiffrement.js';

const PHRASE = 'vélo jardin soleil 1954';
const copy = (u) => new Uint8Array(u);

test('données : aller-retour, IV différent à chaque fois, emplacement vérifié', async () => {
  const keys = await K.openDek(K.generateDek());
  const rec = { store: 'transactions', id: 't1', data: { amount: -64.8, description: 'MIGROS M SION' } };
  const a = await K.encryptJson(keys, rec, 'users/u/records/d1/v1');
  const b = await K.encryptJson(keys, rec, 'users/u/records/d1/v1');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
  assert.equal(K.fromB64(a.iv).length, 12);
  assert.doesNotMatch(atob(a.ct), /MIGROS/, 'rien en clair');
  assert.deepEqual(await K.decryptJson(keys, a, 'users/u/records/d1/v1'), rec);
  await assert.rejects(K.decryptJson(keys, a, 'users/u/records/AUTRE/v1'), K.ChiffrementError, 'document déplacé : refusé');
  const tampered = { ...a, ct: K.toB64(K.fromB64(a.ct).map((x, i) => (i === 0 ? x ^ 1 : x))) };
  await assert.rejects(K.decryptJson(keys, tampered, 'users/u/records/d1/v1'), K.ChiffrementError);
  const other = await K.openDek(K.generateDek());
  await assert.rejects(K.decryptJson(other, a, 'users/u/records/d1/v1'), K.ChiffrementError, 'autre clé : refusé');
});

test('openDek efface les octets bruts ; clés non extractibles', async () => {
  const raw = K.generateDek();
  const keys = await K.openDek(raw);
  assert.ok(raw.every((x) => x === 0));
  assert.equal(keys.aes.extractable, false);
  assert.equal(keys.hmac.extractable, false);
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', keys.aes));
});

test('noms de documents : stables pour la même clé, différents sinon, sans l’identifiant', async () => {
  const raw = K.generateDek();
  const k1 = await K.openDek(copy(raw));
  const k2 = await K.openDek(copy(raw));
  const id = '2026-10-03|-64.8|****1111|MIGROS M SION|0';
  const d = await K.docId(k1, 'transactions', id);
  assert.match(d, /^[0-9a-f]{40}$/);
  assert.equal(await K.docId(k2, 'transactions', id), d, 'deux iPad, même clé : même nom');
  assert.notEqual(await K.docId(k1, 'rules', id), d);
  assert.notEqual(await K.docId(await K.openDek(K.generateDek()), 'transactions', id), d);
});

test('enveloppe phrase de passe : 600 000 itérations, bonne / mauvaise phrase', async () => {
  const raw = K.generateDek();
  const env = await K.wrapWithPassphrase(raw, PHRASE);
  assert.equal(env.iterations, 600000);
  assert.equal(K.fromB64(env.salt).length, 16);
  assert.doesNotMatch(JSON.stringify(env), new RegExp(K.toB64(raw).slice(0, 12).replace(/[+/]/g, '.')), 'DEK pas en clair');
  // Accents écrits autrement (forme décomposée) : même phrase.
  const back = await K.unwrapWithPassphrase(env, '  vélo jardin soleil 1954 ');
  assert.deepEqual(back, raw);
  await assert.rejects(K.unwrapWithPassphrase(env, 'velo jardin soleil 1954'), /Phrase de secours incorrecte/);
  await assert.rejects(K.unwrapWithPassphrase({ ...env, iterations: 1000 }, PHRASE), /n’est pas valable/, 'enveloppe affaiblie refusée');
});

test('phrase de passe trop faible : refusée en mots simples', async () => {
  assert.match(K.passphraseProblem('court'), /au moins 12 caractères/);
  assert.match(K.passphraseProblem('aaaaaaaaaaaaaa'), /trop simple/);
  assert.equal(K.passphraseProblem(PHRASE), null);
  await assert.rejects(K.wrapWithPassphrase(K.generateDek(), 'court'), K.ChiffrementError);
});

test('enveloppe passkey (PRF → HKDF) : bon secret ouvre, autre secret non', async () => {
  const raw = K.generateDek();
  const prf = K.randomBytes(32);
  const credentialId = K.randomBytes(16);
  const env = await K.wrapWithPrf(raw, prf, { credentialId, prfSalt: K.randomBytes(32), label: 'iPad de Maman' });
  assert.equal(env.info, 'MonBudget DEK wrap v1');
  assert.equal(K.fromB64(env.hkdfSalt).length, 32);
  assert.deepEqual(K.fromB64(env.credentialId), credentialId);
  assert.deepEqual(await K.unwrapWithPrf(env, prf), raw);
  await assert.rejects(K.unwrapWithPrf(env, K.randomBytes(32)), /phrase de secours/);
  assert.match(await K.passkeyDocName(credentialId), /^pk_[0-9a-f]{16}$/);
  assert.equal(await K.passkeyDocName(env.credentialId), await K.passkeyDocName(credentialId));
});

test('même DEK par la phrase ou par la passkey : mêmes données lisibles', async () => {
  const raw = K.generateDek();
  const prf = K.randomBytes(32);
  const pEnv = await K.wrapWithPassphrase(raw, PHRASE);
  const kEnv = await K.wrapWithPrf(raw, prf, { credentialId: K.randomBytes(16), prfSalt: K.randomBytes(32) });
  const viaPhrase = await K.openDek(await K.unwrapWithPassphrase(pEnv, PHRASE));
  const viaPasskey = await K.openDek(await K.unwrapWithPrf(kEnv, prf));
  const box = await K.encryptJson(viaPhrase, { ok: 1 }, 'x');
  assert.deepEqual(await K.decryptJson(viaPasskey, box, 'x'), { ok: 1 });
});
