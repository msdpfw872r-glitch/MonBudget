/**
 * suppression.test.mjs — Tests de « Supprimer des données » : groupes, rien / tout / certains, résumé, effets.
 * Lancer : npm test
 *
 * Version : 0.14.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.11.0 FRE (Fidag)  Première version.
 *   0.12.0 FRE (Fidag)  Toutes les catégories supprimables ; catégories d'exemple remises.
 *   0.14.0 FRE (Fidag)  Tout remettre à zéro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as G from '../app/src/core/regles.js';
import * as D from '../app/src/core/suppression.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const opts = { seed };

async function base() {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await db.putMany('imports', [
    { id: 'i1', accountId: 'ubs', date: '2026-11-02T10:00:00Z', period: { from: '2026-10-01', to: '2026-10-31' } },
    { id: 'i2', accountId: 'carte-ubs-maman', date: '2026-11-03T10:00:00Z' },
  ]);
  await db.putMany('transactions', [
    { id: 'a', importId: 'i1', accountId: 'ubs', date: '2026-10-02', description: 'LOYER', merchantKey: 'LOYER', amount: -2550, status: 'a-trier' },
    { id: 'bill', importId: 'i1', accountId: 'ubs', date: '2026-10-25', description: 'LSV CARTE', merchantKey: 'LSV', amount: -100, status: 'classee', isCardBillPayment: true, categoryId: 'paiement-facture-carte' },
    { id: 'b', importId: 'i2', accountId: 'carte-ubs-maman', date: '2026-10-03', description: 'MIGROS', merchantKey: 'MIGROS', amount: -60, status: 'a-trier', cardBillId: 'bill' },
    { id: 'c', importId: 'i2', accountId: 'carte-ubs-maman', date: '2026-10-04', description: 'COOP', merchantKey: 'COOP', amount: -40, status: 'a-trier', cardBillId: 'bill' },
  ]);
  await G.classify(db, 'a', { personId: 'menage', categoryId: 'logement-loyer-hypotheque', remember: true });
  await G.classify(db, 'b', { personId: 'maman', categoryId: 'alimentation-et-courses', remember: true });
  await R.assignBankRef(db, 'carte-ubs-maman', '****1111');
  const tante = await R.savePerson(db, { name: 'Tante Rose', color: '#B03A2E' });
  await R.saveCategory(db, { name: 'Jardinage', type: 'depense' });
  return { db, tante };
}

test('groupes et listes : imports, tri (sans le prélèvement de carte), catégories toutes, personnes ajoutées seulement', async () => {
  const { db } = await base();
  assert.deepEqual(D.GROUPS.map((g) => g.id), ['imports', 'operations', 'tri', 'regles', 'rattachements', 'numeros', 'categories', 'personnes']);
  const imps = await D.listGroup(db, 'imports', opts);
  assert.deepEqual(imps.map((i) => i.id), ['i2', 'i1'], 'le plus récent d’abord');
  assert.match(imps[1].label, /UBS.*octobre 2026/);
  assert.match(imps[1].sub, /2 opérations/);
  assert.deepEqual((await D.listGroup(db, 'tri', opts)).map((i) => i.id).sort(), ['a', 'b']);
  assert.equal((await D.listGroup(db, 'operations', opts))[0].month, '2026-10');
  assert.deepEqual((await D.listGroup(db, 'rattachements', opts)).map((i) => i.sub), ['2 achats rattachés']);
  assert.deepEqual((await D.listGroup(db, 'numeros', opts)).map((i) => i.label), ['Carte ****1111']);
  assert.deepEqual((await D.listGroup(db, 'personnes', opts)).map((i) => i.label), ['Tante Rose']);
  const cats = await D.listGroup(db, 'categories', opts);
  assert.equal(cats.length, seed.categories.length + 1, 'toutes les catégories, y compris celles d’exemple');
  assert.match(cats.find((c) => c.id === 'logement-loyer-hypotheque').sub, /Dépense · 1 opération/);
});

test('rien choisi : rien ne change', async () => {
  const { db } = await base();
  assert.deepEqual(await D.planDeletion(db, {}, opts), { lines: [], total: 0 });
  const done = await D.applyDeletion(db, { imports: [], regles: null }, opts);
  assert.ok(Object.values(done).every((n) => n === 0));
  assert.equal(await db.count('transactions'), 4);
});

test('supprimer un import : ses opérations partent, les rattachements de l’autre import sont libérés', async () => {
  const { db } = await base();
  const plan = await D.planDeletion(db, { imports: ['i1'] }, opts);
  assert.deepEqual(plan.lines.map((l) => l.text), ['1 import et leurs 2 opérations']);
  const done = await D.applyDeletion(db, { imports: ['i1'] }, opts);
  assert.deepEqual([done.imports, done.operations], [1, 2]);
  assert.equal(await db.get('imports', 'i1'), undefined);
  assert.equal((await db.get('transactions', 'b')).cardBillId, null, 'la facture supprimée libère ses achats');
  assert.equal((await db.get('outbox', 'transactions/a')).deleted, true, 'suppression transmise aux autres appareils');
});

test('tout le tri : les opérations reviennent « à trier », règles gardées', async () => {
  const { db } = await base();
  const done = await D.applyDeletion(db, { tri: 'all' }, opts);
  assert.equal(done.tri, 2);
  const a = await db.get('transactions', 'a');
  assert.deepEqual([a.status, a.personId, a.categoryId, a.ruleId], ['a-trier', null, null, null]);
  assert.equal((await db.get('transactions', 'bill')).status, 'classee', 'le prélèvement de carte reste classé');
  assert.equal(await db.count('rules'), 2);
});

test('certaines règles : supprimées, les opérations gardent leur classement', async () => {
  const { db } = await base();
  const rules = await D.listGroup(db, 'regles', opts);
  const migros = rules.find((r) => r.label === 'MIGROS');
  const plan = await D.planDeletion(db, { regles: [migros.id, 'inconnue'] }, opts);
  assert.deepEqual(plan.lines.map((l) => l.text), ['1 règle : MIGROS']);
  await D.applyDeletion(db, { regles: [migros.id] }, opts);
  assert.equal(await db.count('rules'), 1);
  const b = await db.get('transactions', 'b');
  assert.deepEqual([b.status, b.categoryId, b.ruleId], ['classee', 'alimentation-et-courses', null]);
});

test('rattachements, numéros, personne et catégorie ajoutées', async () => {
  const { db, tante } = await base();
  await G.classify(db, 'c', { personId: tante.id, categoryId: 'jardinage', remember: true });
  const done = await D.applyDeletion(db, { rattachements: 'all', numeros: 'all', personnes: 'all', categories: ['jardinage'] }, opts);
  assert.deepEqual([done.rattachements, done.numeros, done.personnes, done.categories], [1, 1, 1, 1]);
  assert.equal((await db.get('transactions', 'b')).cardBillId, null);
  assert.deepEqual((await db.get('accounts', 'carte-ubs-maman')).bankRefs, []);
  assert.equal(await db.get('people', tante.id), undefined);
  assert.equal(await db.get('categories', 'jardinage'), undefined);
  assert.equal((await db.get('transactions', 'c')).status, 'a-trier', 'ce qui utilisait la personne ajoutée revient à trier');
  assert.ok(!(await db.getAll('rules')).some((r) => r.categoryId === 'jardinage'));
  assert.ok(await db.get('people', 'maman'), 'les personnes de départ restent');
});

test('import + opérations du même import : comptées une seule fois', async () => {
  const { db } = await base();
  const plan = await D.planDeletion(db, { imports: ['i2'], operations: ['b', 'a'], tri: 'all' }, opts);
  assert.deepEqual(plan.lines.map((l) => l.text), ['1 import et leurs 2 opérations', '1 opération'], 'le tri d’opérations supprimées n’est pas compté');
  const done = await D.applyDeletion(db, { imports: ['i2'], operations: ['b', 'a'] }, opts);
  assert.equal(done.operations, 3);
  assert.equal(await db.count('transactions'), 1);
});

test('toutes les catégories supprimées, puis les catégories d’exemple remises', async () => {
  const { db } = await base();
  const plan = await D.planDeletion(db, { categories: 'all' }, opts);
  assert.match(plan.lines[0].text, new RegExp(`^${seed.categories.length + 1} catégories : `));
  const done = await D.applyDeletion(db, { categories: 'all' }, opts);
  assert.equal(done.categories, seed.categories.length + 1);
  assert.equal(await db.count('categories'), 0);
  assert.equal(await db.countWhere('transactions', 'status', 'classee'), 0, 'tout revient à trier (prélèvement compris)');
  assert.equal(await db.count('rules'), 0, 'les règles menaient à ces catégories');
  assert.equal(await R.restoreSampleCategories(db, seed), seed.categories.length);
  assert.equal(await db.count('categories'), seed.categories.length);
  assert.equal(await R.restoreSampleCategories(db, seed), 0, 'rien en double');
  assert.equal((await db.get('outbox', 'categories/alimentation-et-courses')).deleted, false, 'remises aussi sur les autres appareils');
});

test('tout remettre à zéro : comme à la première utilisation, transmis aux autres appareils', async () => {
  const { db, tante } = await base();
  await db.put('settings', { id: 'sync', cursor: 5, joinedAt: 'x' });
  await R.restoreSampleCategories(db, seed);
  await db.delete('categories', 'animaux');
  const plan = await D.planDeletion(db, { reset: true, imports: 'all' }, opts);
  assert.equal(plan.reset, true);
  assert.match(plan.lines[0].text, /4 opérations, 2 règles, 2 imports/);
  const done = await D.applyDeletion(db, { reset: true }, opts);
  assert.deepEqual([done.reset, done.operations, done.regles, done.imports], [true, 4, 2, 2]);
  for (const s of ['transactions', 'rules', 'imports']) assert.equal(await db.count(s), 0, s);
  assert.equal(await db.count('categories'), seed.categories.length, 'catégories d’exemple remises (animaux compris)');
  assert.equal(await db.count('people'), seed.people.length);
  assert.equal(await db.get('people', tante.id), undefined);
  assert.deepEqual((await db.get('accounts', 'carte-ubs-maman')).bankRefs ?? [], []);
  assert.ok((await db.get('settings', 'app')).seededAt);
  assert.equal((await db.get('settings', 'sync')).cursor, 5, 'la synchronisation continue');
  assert.equal((await db.get('outbox', 'transactions/a')).deleted, true);
  assert.equal((await db.get('outbox', 'categories/animaux')).deleted, false, 'remise aussi en ligne');
});
