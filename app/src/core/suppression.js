/**
 * suppression.js — « Supprimer des données » : choix par groupe (rien / tout / certains), résumé, suppression.
 *
 * Version : 0.14.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Groupes : imports, opérations, tri des opérations, règles retenues, rattachements aux factures de carte,
 * numéros de comptes et cartes reconnus, catégories (toutes), personnes ajoutées (jamais Maman, Papa, Ménage).
 * Une sélection : { [groupe]: 'all' | string[] (identifiants) } ; un groupe absent = rien.
 * Les suppressions passent par la base suivie : elles partent aussi vers les autres appareils.
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.11.0 FRE (Fidag)  Première version.
 *   0.12.0 FRE (Fidag)  Toutes les catégories supprimables (celles de départ sont un exemple) ; personnes ajoutées à part.
 *   0.14.0 FRE (Fidag)  « Tout remettre à zéro » (selection.reset) : comme à la première utilisation.
 */

import { formatDateShort, formatMonth, opName, formatCHF } from './format.js';
import { unlinkBill } from './cartes.js';
import { normRef, installSeed } from './reglages.js';
import { SYNCED_STORES } from '../data/db.js';

export const GROUPS = [
  { id: 'imports', title: 'Imports', help: 'Supprime le fichier importé et ses opérations', one: 'import', many: 'imports' },
  { id: 'operations', title: 'Opérations', help: 'Une par une, ou par mois', one: 'opération', many: 'opérations' },
  { id: 'tri', title: 'Tri des opérations', help: 'Les opérations restent, elles reviennent dans « À trier »', one: 'opération triée', many: 'opérations triées' },
  { id: 'regles', title: 'Règles retenues', help: 'L’app ne classera plus seule ces commerces', one: 'règle', many: 'règles' },
  { id: 'rattachements', title: 'Rattachements aux factures de carte', help: 'Les achats sont détachés de la facture', one: 'facture rattachée', many: 'factures rattachées' },
  { id: 'numeros', title: 'Numéros de comptes et cartes reconnus', help: 'L’app redemandera à quel compte ils appartiennent', one: 'numéro', many: 'numéros' },
  { id: 'categories', title: 'Catégories', help: 'Toutes, y compris celles d’exemple ; leurs opérations reviennent dans « À trier »', one: 'catégorie', many: 'catégories' },
  { id: 'personnes', title: 'Personnes ajoutées', help: 'Seulement celles que vous avez créées ; leurs opérations reviennent dans « À trier »', one: 'personne', many: 'personnes' },
];
export const groupById = (id) => GROUPS.find((g) => g.id === id);

const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
export const countText = (n, g) => `${fmtN(n)} ${n > 1 ? g.many : g.one}`;

/**
 * Éléments d'un groupe, pour la liste à cocher.
 * @returns {Promise<Array<{id: string, label: string, sub: string, month?: string}>>}
 */
export async function listGroup(db, group, { seed = null } = {}) {
  switch (group) {
    case 'imports': {
      const [imps, txs, accounts] = await Promise.all([db.getAll('imports'), db.getAll('transactions'), db.getAll('accounts')]);
      const A = new Map(accounts.map((a) => [a.id, a.name]));
      const n = new Map();
      for (const t of txs) if (t.importId) n.set(t.importId, (n.get(t.importId) ?? 0) + 1);
      return imps.sort((a, b) => String(b.date).localeCompare(String(a.date))).map((i) => ({
        id: i.id,
        label: `${(i.accountIds ?? [i.accountId]).map((x) => A.get(x) ?? 'Compte').join(' + ')}${i.period?.from ? ` · ${formatMonth(i.period.from).toLowerCase()}` : ''}`,
        sub: `importé le ${formatDateShort(String(i.date).slice(0, 10))} · ${countText(n.get(i.id) ?? 0, groupById('operations'))}${i.fileName ? ` · ${i.fileName}` : ''}`,
      }));
    }
    case 'operations':
    case 'tri': {
      let txs = await db.getAll('transactions');
      // Le prélèvement d'une facture de carte est classé d'office : son tri n'est pas proposé.
      if (group === 'tri') txs = txs.filter((t) => t.status === 'classee' && !t.isCardBillPayment);
      return txs.sort((a, b) => b.date.localeCompare(a.date)).map((t) => ({
        id: t.id, label: opName(t), sub: `${formatDateShort(t.date)} · ${formatCHF(t.amount)}`, month: t.date.slice(0, 7),
      }));
    }
    case 'regles': {
      const [rules, cats, people] = await Promise.all([db.getAll('rules'), db.getAll('categories'), db.getAll('people')]);
      const C = new Map(cats.map((c) => [c.id, c.name]));
      const P = new Map(people.map((p) => [p.id, p.name]));
      return rules.sort((a, b) => a.merchantKey.localeCompare(b.merchantKey, 'fr')).map((r) => ({
        id: r.id, label: r.merchantKey, sub: `${C.get(r.categoryId) ?? 'Catégorie supprimée'} · ${P.get(r.personId) ?? 'Personne supprimée'}`,
      }));
    }
    case 'rattachements': {
      const txs = await db.getAll('transactions');
      const linked = new Map();
      for (const t of txs) if (t.cardBillId) linked.set(t.cardBillId, (linked.get(t.cardBillId) ?? 0) + 1);
      return txs.filter((t) => t.isCardBillPayment && linked.has(t.id)).sort((a, b) => b.date.localeCompare(a.date)).map((t) => ({
        id: t.id, label: `Facture du ${formatDateShort(t.date)} · ${formatCHF(t.amount)}`, sub: `${linked.get(t.id)} achats rattachés`,
      }));
    }
    case 'numeros': {
      const out = [];
      for (const a of await db.getAll('accounts')) {
        for (const ref of a.bankRefs ?? []) out.push({ id: `${a.id}\u0000${ref}`, label: maskRef(ref), sub: a.name });
      }
      return out;
    }
    case 'categories': {
      const [cats, txs] = await Promise.all([db.getAll('categories'), db.getAll('transactions')]);
      const used = new Map();
      for (const t of txs) if (t.categoryId) used.set(t.categoryId, (used.get(t.categoryId) ?? 0) + 1);
      return cats.sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => ({
        id: c.id, label: c.name,
        sub: `${c.type === 'recette' ? 'Rentrée' : 'Dépense'}${used.get(c.id) ? ` · ${countText(used.get(c.id), groupById('operations'))}` : ''}`,
      }));
    }
    case 'personnes': {
      const seedPeople = new Set((seed?.people ?? []).map((p) => p.id));
      return (await db.getAll('people')).filter((p) => !seedPeople.has(p.id)).map((p) => ({ id: p.id, label: p.name, sub: 'Personne' }));
    }
    default: return [];
  }
}

function maskRef(ref) {
  const r = normRef(ref);
  if (r.startsWith('*')) return `Carte ****${r.replace(/\*/g, '')}`;
  return r.length > 6 ? `Compte …${r.slice(-6)}` : `Compte ${r}`;
}

/** Identifiants choisis dans un groupe ('all' → tous). */
async function chosenIds(db, selection, group, opts) {
  const sel = selection[group];
  if (!sel || (Array.isArray(sel) && !sel.length)) return [];
  const all = (await listGroup(db, group, opts)).map((i) => i.id);
  if (sel === 'all') return all;
  const ok = new Set(all);
  return sel.filter((id) => ok.has(id));
}

/**
 * Ce qui sera supprimé (pour l'écran « Vérifier »).
 * @returns {Promise<{lines: Array<{group: string, count: number, text: string}>, total: number}>}
 */
export async function planDeletion(db, selection, opts = {}) {
  if (selection.reset) {
    const [t, r, i] = await Promise.all([db.count('transactions'), db.count('rules'), db.count('imports')]);
    return { reset: true, total: 1, lines: [
      { group: 'reset', count: t, text: `Toutes vos données : ${countText(t, groupById('operations'))}, ${countText(r, groupById('regles'))}, ${countText(i, groupById('imports'))}, vos catégories, personnes et comptes` },
      { group: 'reset', count: 0, text: 'L’app repart comme à la première utilisation, avec les catégories, personnes et comptes d’exemple' },
    ] };
  }
  const lines = [];
  const importIds = new Set(await chosenIds(db, selection, 'imports', opts));
  const txs = await db.getAll('transactions');
  const goneByImport = txs.filter((t) => importIds.has(t.importId));
  if (importIds.size) {
    lines.push({ group: 'imports', count: importIds.size,
      text: `${countText(importIds.size, groupById('imports'))} et leurs ${countText(goneByImport.length, groupById('operations'))}` });
  }
  const gone = new Set(goneByImport.map((t) => t.id));
  const ops = (await chosenIds(db, selection, 'operations', opts)).filter((id) => !gone.has(id));
  if (ops.length) lines.push({ group: 'operations', count: ops.length, text: countText(ops.length, groupById('operations')) });
  for (const id of ops) gone.add(id);
  const tri = (await chosenIds(db, selection, 'tri', opts)).filter((id) => !gone.has(id));
  if (tri.length) lines.push({ group: 'tri', count: tri.length, text: `Le tri de ${countText(tri.length, groupById('operations'))} : elles reviennent dans « À trier »` });
  for (const g of ['regles', 'rattachements', 'numeros', 'categories', 'personnes']) {
    let ids = await chosenIds(db, selection, g, opts);
    if (g === 'rattachements') ids = ids.filter((id) => !gone.has(id));
    if (!ids.length) continue;
    const items = new Map((await listGroup(db, g, opts)).map((i) => [i.id, i.label]));
    const names = ids.slice(0, 4).map((id) => items.get(id)).join(', ') + (ids.length > 4 ? '…' : '');
    lines.push({ group: g, count: ids.length, text: `${countText(ids.length, groupById(g))} : ${names}` });
  }
  return { lines, total: lines.reduce((s, l) => s + l.count, 0) };
}

/** Remet une opération « à trier ». */
const untouched = (t) => ({ ...t, personId: null, categoryId: null, status: 'a-trier', ruleId: null, classifiedAt: null });

/**
 * Supprime ce qui a été choisi.
 * @returns {Promise<{imports: number, operations: number, tri: number, regles: number, rattachements: number, numeros: number, categories: number, personnes: number}>}
 */
export async function applyDeletion(db, selection, opts = {}) {
  if (selection.reset) return resetAll(db, opts.seed);
  const done = { imports: 0, operations: 0, tri: 0, regles: 0, rattachements: 0, numeros: 0, categories: 0, personnes: 0 };
  // Tout est calculé AVANT de supprimer (les listes changent en cours de route).
  const ids = {};
  for (const g of GROUPS) ids[g.id] = await chosenIds(db, selection, g.id, opts);

  const deleteTx = async (t) => {
    if (t.isCardBillPayment) await unlinkBill(db, t.id);
    await db.delete('transactions', t.id);
    done.operations++;
  };
  for (const importId of ids.imports) {
    for (const t of await db.getAllWhere('transactions', 'importId', importId)) await deleteTx(t);
    await db.delete('imports', importId);
    done.imports++;
  }
  for (const id of ids.operations) {
    const t = await db.get('transactions', id);
    if (t) await deleteTx(t);
  }
  for (const id of ids.rattachements) {
    if (await db.get('transactions', id)) { await unlinkBill(db, id); done.rattachements++; }
  }
  for (const id of ids.tri) {
    const t = await db.get('transactions', id);
    if (t && t.status === 'classee') { await db.put('transactions', untouched(t)); done.tri++; }
  }
  for (const id of ids.regles) {
    for (const t of await db.getAllWhere('transactions', 'ruleId', id)) await db.put('transactions', { ...t, ruleId: null });
    await db.delete('rules', id);
    done.regles++;
  }
  for (const key of ids.numeros) {
    const [accountId, ref] = key.split('\u0000');
    const a = await db.get('accounts', accountId);
    if (!a) continue;
    await db.put('accounts', { ...a, bankRefs: (a.bankRefs ?? []).filter((x) => x !== ref) });
    done.numeros++;
  }
  const removeUsed = async (store, id) => {
    const field = store === 'people' ? 'personId' : 'categoryId';
    // Ce qui l'utilisait revient « à trier » ; les règles qui y menaient sont supprimées.
    for (const t of await db.getAllWhere('transactions', field, id)) await db.put('transactions', untouched(t));
    for (const r of await db.getAllWhere('rules', field, id)) {
      for (const t of await db.getAllWhere('transactions', 'ruleId', r.id)) await db.put('transactions', { ...(await db.get('transactions', t.id)), ruleId: null });
      await db.delete('rules', r.id);
    }
    if (store === 'people') {
      for (const a of (await db.getAll('accounts')).filter((x) => x.personId === id)) await db.put('accounts', { ...a, personId: null });
    }
    await db.delete(store, id);
  };
  for (const id of ids.categories) { await removeUsed('categories', id); done.categories++; }
  for (const id of ids.personnes) { await removeUsed('people', id); done.personnes++; }
  return done;
}

/**
 * Tout remettre à zéro : comme à la première utilisation. Toutes les données sont effacées
 * (aussi sur les autres appareils) puis les données d'exemple sont remises. Le compte, Face ID,
 * l'état de synchronisation et les copies de sécurité en ligne sont gardés.
 * @returns {Promise<{reset: true, operations: number, regles: number, imports: number}>}
 */
export async function resetAll(db, seed) {
  if (!seed) throw new Error('Données d’exemple manquantes');
  const done = { reset: true, operations: await db.count('transactions'), regles: await db.count('rules'), imports: await db.count('imports') };
  for (const s of SYNCED_STORES) await db.clear(s);
  const app = await db.get('settings', 'app');
  if (app) await db.delete('settings', 'app');
  await installSeed(db, seed);
  return done;
}
