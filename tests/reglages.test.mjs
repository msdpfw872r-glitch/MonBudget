/**
 * reglages.test.mjs — Tests des données de départ et des réglages (comptes, personnes, catégories).
 * Lancer : npm test
 *
 * Version : 0.4.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version (base en mémoire, même interface qu'IndexedDB).
 *   0.4.0  FRE (Fidag)  Cartes UBS de Maman et Papa : titulaire, compte qui paie la facture, numéros reconnus.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb, SCHEMA_VERSION } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));

async function freshDb() {
  const db = openMemoryDb();
  await R.installSeed(db, seed, new Date('2026-11-08T10:00:00Z'));
  return db;
}

test('données de départ installées une seule fois', async () => {
  const db = openMemoryDb();
  assert.equal(await R.installSeed(db, seed), true);
  assert.equal(await db.count('people'), 3);
  assert.equal(await db.count('accounts'), 5);
  assert.equal(await db.count('categories'), 40);
  const s = await db.get('settings', 'app');
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  // Une modification de l'utilisatrice n'est pas écrasée au lancement suivant.
  await R.savePerson(db, { id: 'maman', name: 'Lucie', color: '#8A3466' });
  assert.equal(await R.installSeed(db, seed), false);
  assert.equal((await db.get('people', 'maman')).name, 'Lucie');
  assert.deepEqual((await R.listPeople(db)).map((p) => p.name), ['Lucie', 'Papa', 'Ménage']);
});

test('la base renvoie des copies (comme IndexedDB)', async () => {
  const db = await freshDb();
  const p = await db.get('people', 'papa');
  p.name = 'modifié';
  assert.equal((await db.get('people', 'papa')).name, 'Papa');
});

test('personnes : ajout, nom en double, couleur obligatoire', async () => {
  const db = await freshDb();
  const p = await R.savePerson(db, { name: '  Tante   Rose ', color: '#1D6F61' });
  assert.equal(p.id, 'tante-rose');
  assert.equal(p.name, 'Tante Rose');
  await assert.rejects(R.savePerson(db, { name: 'MAMAN', color: '#1D6F61' }), /existe déjà/);
  await assert.rejects(R.savePerson(db, { name: 'Paul', color: '#123456' }), /couleur/);
  await assert.rejects(R.savePerson(db, { name: '   ', color: '#1D6F61' }), /Écrivez un nom/);
  await assert.rejects(R.savePerson(db, { name: 'x'.repeat(41), color: '#1D6F61' }), /trop long/);
});

test('personnes : suppression refusée si utilisée', async () => {
  const db = await freshDb();
  await db.put('transactions', { id: 't1', personId: 'papa', categoryId: 'autres-revenus', accountId: 'ubs' });
  await db.put('rules', { id: 'r1', personId: 'papa', categoryId: 'autres-revenus', merchantKey: 'X' });
  await assert.rejects(R.deletePerson(db, 'papa'), (e) => e instanceof R.ReglageError && /Carte UBS de Papa/.test(e.message));
  await R.saveAccount(db, { id: 'carte-ubs-papa', name: 'Carte UBS de Papa', kind: 'carte', importFormat: 'ubs-transactions-xlsx', personId: null, billPaidFrom: 'ubs' });
  await assert.rejects(R.deletePerson(db, 'papa'), (e) => e instanceof R.ReglageError && /1 opération et 1 règle/.test(e.message));
  await R.savePerson(db, { name: 'Tante Rose', color: '#1D6F61' });
  await R.deletePerson(db, 'tante-rose');
  assert.equal(await db.count('people'), 3);
});

test('comptes : ajout, modification, suppression', async () => {
  const db = await freshDb();
  const a = await R.saveAccount(db, { name: 'UBS carte', kind: 'carte', importFormat: 'ubs-transactions-xlsx' });
  assert.equal(a.id, 'ubs-carte');
  await R.saveAccount(db, { id: 'ubs', name: 'UBS compte privé', kind: 'compte', importFormat: 'ubs-transactions-xlsx' });
  assert.equal((await db.get('accounts', 'ubs')).name, 'UBS compte privé');
  await assert.rejects(R.saveAccount(db, { name: 'Autre', kind: 'livret', importFormat: 'camt053' }), /compte ou d’une carte/);
  await assert.rejects(R.saveAccount(db, { name: 'Autre', kind: 'compte', importFormat: 'inconnu' }), /banque/);
  await db.put('transactions', { id: 't1', accountId: 'ubs' });
  await assert.rejects(R.deleteAccount(db, 'ubs'), /ce compte contient encore 1 opération\./);
  await db.delete('transactions', 't1');
  await assert.rejects(R.deleteAccount(db, 'ubs'), /la facture de Carte UBS de Maman et de Carte UBS de Papa/);
  await R.deleteAccount(db, 'bcvs');
  assert.deepEqual((await R.listAccounts(db)).map((x) => x.id), ['ubs', 'carte-ubs-maman', 'carte-ubs-papa', 'mastercard', 'ubs-carte']);
});

test('cartes : titulaire et compte qui paie la facture', async () => {
  const db = await freshDb();
  const maman = await db.get('accounts', 'carte-ubs-maman');
  assert.equal(maman.personId, 'maman');
  assert.equal(maman.billPaidFrom, 'ubs');
  await assert.rejects(R.saveAccount(db, { ...maman, personId: 'inconnu' }), /personne n’existe plus/);
  await assert.rejects(R.saveAccount(db, { ...maman, billPaidFrom: 'mastercard' }), /compte sur lequel la facture/);
  // Un compte (pas une carte) n'a ni titulaire ni facture.
  const c = await R.saveAccount(db, { name: 'Épargne', kind: 'compte', importFormat: 'camt053', personId: 'papa', billPaidFrom: 'ubs' });
  assert.equal(c.personId, null);
  assert.equal(c.billPaidFrom, null);
  // Numéros reconnus : une référence n'appartient qu'à un compte.
  await R.assignBankRef(db, 'carte-ubs-maman', '**** 1111');
  await R.assignBankRef(db, 'carte-ubs-papa', '****1111');
  assert.deepEqual((await db.get('accounts', 'carte-ubs-maman')).bankRefs, []);
  assert.deepEqual((await db.get('accounts', 'carte-ubs-papa')).bankRefs, ['****1111']);
  await R.removeBankRef(db, 'carte-ubs-papa', '****1111');
  assert.deepEqual((await db.get('accounts', 'carte-ubs-papa')).bankRefs, []);
});

test('catégories : ajout, id unique, archivage, suppression', async () => {
  const db = await freshDb();
  const c = await R.saveCategory(db, { name: 'Épargne', type: 'depense' }).catch((e) => e);
  assert.match(c.message, /existe déjà/); // « Épargne » est dans les données de départ
  const n = await R.saveCategory(db, { name: 'Coiffeur', type: 'depense' });
  assert.equal(n.archived, false);
  assert.equal(n.excludeFromTotals, false);
  await assert.rejects(R.saveCategory(db, { name: 'Coiffure', type: 'autre' }), /Dépense/);

  await R.setCategoryArchived(db, 'coiffeur', true);
  const visibles = await R.listCategories(db, { archived: false });
  assert.equal(visibles.length, 40);
  assert.equal((await R.listCategories(db)).length, 41);

  await db.put('transactions', { id: 't1', categoryId: 'coiffeur' });
  await assert.rejects(R.deleteCategory(db, 'coiffeur'), /mettre de côté/);
  await db.delete('transactions', 't1');
  await R.deleteCategory(db, 'coiffeur');
  assert.equal(await db.get('categories', 'coiffeur'), undefined);
});

test('identifiants : même nom après suppression → pas de collision', async () => {
  const db = await freshDb();
  assert.equal(R.slugify('Énergie et charges'), 'energie-et-charges');
  assert.equal(R.slugify('!!!'), 'element');
  await R.saveCategory(db, { name: 'Vacances', type: 'depense' });
  await R.saveCategory(db, { id: 'vacances', name: 'Voyages', type: 'depense' });
  const again = await R.saveCategory(db, { name: 'Vacances', type: 'depense' });
  assert.equal(again.id, 'vacances-2');
});

test('vue d’ensemble pour l’écran Réglages', async () => {
  const db = await freshDb();
  const o = await R.overview(db);
  assert.deepEqual(o.people.map((p) => p.name), ['Maman', 'Papa', 'Ménage']);
  assert.equal(o.categoriesCount, 40);
  assert.equal(o.rulesCount, 0);
});

test('couleurs des personnes lisibles en blanc (contraste ≥ 4,5:1)', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const { value, label } of R.PERSON_COLORS) {
    const ratio = 1.05 / (lum(value) + 0.05);
    assert.ok(ratio >= 4.5, `${label} ${value} : ${ratio.toFixed(2)}`);
  }
});
