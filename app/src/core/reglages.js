/**
 * reglages.js — Données de départ et réglages : comptes, personnes (« pour qui »), catégories.
 *
 * Version : 0.12.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Ne dépend pas du navigateur : reçoit la base (voir data/db.js) en paramètre.
 * Les erreurs sont des ReglageError avec un message en mots simples, prêt à afficher.
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version : installation des données de départ, ajout,
 *                       modification, archivage et suppression (avec vérification d'usage).
 *   0.4.0  FRE (Fidag)  Cartes : titulaire (« pour qui » proposé), compte qui paie la facture,
 *                       numéros reconnus dans les fichiers ; mise à jour des données de départ.
 *   0.7.0  FRE (Fidag)  Formats BCVs (CSV) et Swisscard disponibles ; mise à jour des données (compte BCVs,
 *                       facture Mastercard payée par la BCVs) ; nouvelle carte créée depuis l'import.
 *   0.12.0 FRE (Fidag)  restoreSampleCategories : remettre les catégories d'exemple manquantes.
 */

import { fold } from './text.js';
import { SCHEMA_VERSION } from '../data/db.js';

export class ReglageError extends Error {}

/** Couleurs proposées pour une personne : toutes lisibles en texte blanc (contraste ≥ 4,5:1). */
export const PERSON_COLORS = [
  { value: '#8A3466', label: 'Prune' },
  { value: '#2D5B99', label: 'Bleu' },
  { value: '#8C5A00', label: 'Brun' },
  { value: '#1D6F61', label: 'Vert' },
  { value: '#B03A2E', label: 'Rouge' },
  { value: '#4F5E5B', label: 'Gris' },
];

/** Formats de fichier de banque connus (affichés en mots simples). */
export const IMPORT_FORMATS = [
  { id: 'ubs-transactions-xlsx', label: 'UBS', available: true },
  { id: 'bcvs-csv', label: 'BCVs', available: true },
  { id: 'swisscard-csv', label: 'Mastercard (Swisscard)', available: true },
];

export const ACCOUNT_KINDS = [
  { id: 'compte', label: 'Compte bancaire' },
  { id: 'carte', label: 'Carte de crédit' },
];

const MAX_NAME = 40;

/* ---------- Données de départ ---------- */

/**
 * Installe les données de départ si la base est neuve. Ne touche à rien sinon.
 * @returns {Promise<boolean>} vrai si les données ont été installées.
 */
export async function installSeed(db, seed, now = new Date()) {
  const settings = await db.get('settings', 'app');
  if (settings?.seededAt) return false;
  await db.putMany('people', seed.people.map((p, i) => ({ ...p, order: i })));
  await db.putMany('accounts', seed.accounts.map((a, i) => ({ ...a, order: i })));
  await db.putMany('categories', seed.categories.map((c, i) => ({ archived: false, ...c, order: i })));
  await db.put('settings', {
    ...(settings ?? {}),
    id: 'app',
    schemaVersion: SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    seededAt: now.toISOString(),
    lastBackupAt: settings?.lastBackupAt ?? null,
  });
  return true;
}

/** Version des données de départ (augmente quand seed.json gagne des éléments). */
export const DATA_VERSION = 3;

/**
 * Ajoute à une base existante les éléments de départ apparus dans une nouvelle version
 * (seulement ceux dont l'identifiant manque ; rien n'est modifié ni supprimé).
 * @returns {Promise<string[]>} identifiants ajoutés.
 */
export async function upgradeSeed(db, seed) {
  const settings = await db.get('settings', 'app');
  if (!settings?.seededAt || (settings.dataVersion ?? 1) >= DATA_VERSION) return [];
  const added = [];
  for (const store of ['people', 'accounts', 'categories']) {
    const all = await db.getAll(store);
    let order = nextOrder(all);
    for (const item of seed[store]) {
      if (all.some((o) => o.id === item.id)) continue;
      await db.put(store, { ...(store === 'categories' ? { archived: false } : {}), ...item, order: order++ });
      added.push(item.id);
    }
  }
  // 0.7.0 : la BCVs se lit avec son fichier CSV ; la facture Mastercard est prélevée sur la BCVs.
  const accounts = await db.getAll('accounts');
  for (const a of accounts) {
    if (a.importFormat === 'camt053') await db.put('accounts', { ...a, importFormat: 'bcvs-csv' });
  }
  const mc = accounts.find((a) => a.id === 'mastercard');
  if (mc && mc.kind === 'carte' && !mc.billPaidFrom && accounts.some((a) => a.id === 'bcvs' && a.kind === 'compte')) {
    await db.put('accounts', { ...mc, billPaidFrom: 'bcvs' });
  }
  await db.put('settings', { ...settings, dataVersion: DATA_VERSION, schemaVersion: SCHEMA_VERSION });
  return added;
}

/* ---------- Outils ---------- */

/** "Énergie et charges" → "energie-et-charges". */
export function slugify(name) {
  return fold(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'element';
}

function cleanName(name, what) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) throw new ReglageError(`Écrivez un nom pour ${what}.`);
  if (n.length > MAX_NAME) throw new ReglageError(`Le nom est trop long (${MAX_NAME} lettres au plus).`);
  return n;
}

async function checkUnique(db, store, name, exceptId, what) {
  const all = await db.getAll(store);
  if (all.some((o) => o.id !== exceptId && fold(o.name) === fold(name))) {
    throw new ReglageError(`${what} « ${name} » existe déjà.`);
  }
  return all;
}

function newId(all, name) {
  const base = slugify(name);
  let id = base;
  for (let i = 2; all.some((o) => o.id === id); i++) id = `${base}-${i}`;
  return id;
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'fr');
const nextOrder = (all) => all.reduce((m, o) => Math.max(m, o.order ?? 0), -1) + 1;

async function mustGet(db, store, id) {
  const o = await db.get(store, id);
  if (!o) throw new ReglageError('Cet élément n’existe plus. Revenez en arrière et réessayez.');
  return o;
}

/** Nombre d'opérations et de règles qui utilisent cet élément. */
export async function usage(db, field, id) {
  const transactions = await db.countWhere('transactions', field, id);
  const rules = field === 'accountId' ? 0 : await db.countWhere('rules', field, id);
  return { transactions, rules, total: transactions + rules };
}

function usageText({ transactions, rules }) {
  const parts = [];
  if (transactions) parts.push(`${transactions} opération${transactions > 1 ? 's' : ''}`);
  if (rules) parts.push(`${rules} règle${rules > 1 ? 's' : ''}`);
  return parts.join(' et ');
}

/* ---------- Personnes (« pour qui ») ---------- */

export async function listPeople(db) {
  return (await db.getAll('people')).sort(byOrder);
}

export async function savePerson(db, { id, name, color }) {
  const n = cleanName(name, 'cette personne');
  if (!PERSON_COLORS.some((c) => c.value === color)) throw new ReglageError('Choisissez une couleur.');
  const all = await checkUnique(db, 'people', n, id, 'Le nom');
  if (id) {
    const p = await mustGet(db, 'people', id);
    return db.put('people', { ...p, name: n, color });
  }
  return db.put('people', { id: newId(all, n), name: n, color, order: nextOrder(all) });
}

export async function deletePerson(db, id) {
  const u = await usage(db, 'personId', id);
  const cards = (await db.getAll('accounts')).filter((a) => a.personId === id);
  if (cards.length) {
    throw new ReglageError(`Impossible de supprimer : ${cards.map((c) => c.name).join(', ')} est rattachée à cette personne. Changez-le d’abord dans Mes comptes.`);
  }
  if (u.total) {
    throw new ReglageError(`Impossible de supprimer : cette personne est utilisée par ${usageText(u)}. Modifiez-les d’abord.`);
  }
  const all = await db.getAll('people');
  if (all.length <= 1) throw new ReglageError('Il faut garder au moins une personne.');
  await db.delete('people', id);
}

/* ---------- Comptes ---------- */

export async function listAccounts(db) {
  return (await db.getAll('accounts')).sort(byOrder);
}

export async function saveAccount(db, { id, name, kind, importFormat, personId = null, billPaidFrom = null }) {
  const n = cleanName(name, 'ce compte');
  if (!ACCOUNT_KINDS.some((k) => k.id === kind)) throw new ReglageError('Choisissez s’il s’agit d’un compte ou d’une carte.');
  if (!IMPORT_FORMATS.some((f) => f.id === importFormat)) throw new ReglageError('Choisissez la banque.');
  const all = await checkUnique(db, 'accounts', n, id, 'Le compte');
  if (kind !== 'carte') { personId = null; billPaidFrom = null; }
  if (personId && !(await db.get('people', personId))) throw new ReglageError('Cette personne n’existe plus. Choisissez-en une autre.');
  if (billPaidFrom) {
    const payer = all.find((a) => a.id === billPaidFrom);
    if (!payer || payer.kind !== 'compte' || payer.id === id) throw new ReglageError('Choisissez le compte sur lequel la facture est prélevée.');
  }
  const fields = { name: n, kind, importFormat, personId: personId || null, billPaidFrom: billPaidFrom || null };
  if (id) {
    const a = await mustGet(db, 'accounts', id);
    return db.put('accounts', { ...a, ...fields });
  }
  return db.put('accounts', { id: newId(all, n), ...fields, bankRefs: [], order: nextOrder(all) });
}

/** Normalise une référence de compte lue dans un fichier (IBAN, ****1234). */
export function normRef(ref) {
  return String(ref ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Retient qu'une référence trouvée dans les fichiers de la banque appartient à ce compte. */
export async function assignBankRef(db, accountId, ref) {
  const r = normRef(ref);
  const accounts = await db.getAll('accounts');
  for (const a of accounts) {
    const refs = (a.bankRefs ?? []).filter((x) => x !== r);
    if (a.id === accountId) refs.push(r);
    if (refs.length !== (a.bankRefs ?? []).length || a.id === accountId) await db.put('accounts', { ...a, bankRefs: refs });
  }
}

/**
 * Crée un compte « carte » pour une carte trouvée dans un fichier (ex. 2e carte Swisscard).
 * La facture est payée depuis le même compte que les autres cartes de cette banque.
 */
export async function createCardAccount(db, { name, ref, importFormat, personId = null }) {
  const all = await db.getAll('accounts');
  const sibling = all.find((a) => a.kind === 'carte' && a.importFormat === importFormat && a.billPaidFrom);
  const n = cleanName(name, 'cette carte');
  let unique = n;
  for (let i = 2; all.some((a) => fold(a.name) === fold(unique)); i++) unique = `${n} (${i})`;
  const acc = {
    id: newId(all, unique), name: unique, kind: 'carte', importFormat,
    personId: personId || null, billPaidFrom: sibling?.billPaidFrom ?? null, bankRefs: [], order: nextOrder(all),
  };
  await db.put('accounts', acc);
  await assignBankRef(db, acc.id, ref);
  return db.get('accounts', acc.id);
}

export async function removeBankRef(db, accountId, ref) {
  const a = await mustGet(db, 'accounts', accountId);
  await db.put('accounts', { ...a, bankRefs: (a.bankRefs ?? []).filter((x) => x !== normRef(ref)) });
}

export async function deleteAccount(db, id) {
  const u = await usage(db, 'accountId', id);
  if (u.total) {
    throw new ReglageError(`Impossible de supprimer : ce compte contient encore ${usageText(u)}.`);
  }
  const cards = (await db.getAll('accounts')).filter((a) => a.billPaidFrom === id);
  if (cards.length) {
    throw new ReglageError(`Impossible de supprimer : la facture de ${cards.map((c) => c.name).join(' et de ')} est payée depuis ce compte.`);
  }
  await db.delete('accounts', id);
}

/* ---------- Catégories ---------- */

export async function listCategories(db, { archived = true } = {}) {
  const all = (await db.getAll('categories')).sort(byOrder);
  return archived ? all : all.filter((c) => !c.archived);
}

export async function saveCategory(db, { id, name, type, excludeFromTotals = false }) {
  const n = cleanName(name, 'cette catégorie');
  if (type !== 'depense' && type !== 'recette') throw new ReglageError('Choisissez « Dépense » ou « Rentrée ».');
  const all = await checkUnique(db, 'categories', n, id, 'La catégorie');
  if (id) {
    const c = await mustGet(db, 'categories', id);
    return db.put('categories', { ...c, name: n, type, excludeFromTotals: Boolean(excludeFromTotals) });
  }
  return db.put('categories', {
    id: newId(all, n), name: n, type, excludeFromTotals: Boolean(excludeFromTotals),
    archived: false, order: nextOrder(all),
  });
}

/** Une catégorie archivée n'est plus proposée pour trier, mais reste dans l'historique. */
export async function setCategoryArchived(db, id, archived) {
  const c = await mustGet(db, 'categories', id);
  return db.put('categories', { ...c, archived: Boolean(archived) });
}

/** Supprime une catégorie inutilisée ; sinon explique qu'on peut la mettre de côté (archiver). */
export async function deleteCategory(db, id) {
  const u = await usage(db, 'categoryId', id);
  if (u.total) {
    throw new ReglageError(`Impossible de supprimer : cette catégorie est utilisée par ${usageText(u)}. Vous pouvez la « mettre de côté » à la place.`);
  }
  await db.delete('categories', id);
}

/**
 * Remet les catégories d'exemple (seed.json) qui manquent ; celles qui existent ne sont pas touchées.
 * @returns {Promise<number>} nombre de catégories remises.
 */
export async function restoreSampleCategories(db, seed) {
  const all = await db.getAll('categories');
  const have = new Set(all.map((c) => c.id));
  let order = nextOrder(all);
  const missing = seed.categories.filter((c) => !have.has(c.id)).map((c) => ({ archived: false, ...c, order: order++ }));
  if (missing.length) await db.putMany('categories', missing);
  return missing.length;
}

/* ---------- Divers ---------- */

/** Résumé pour l'écran Réglages. */
export async function overview(db) {
  const [people, accounts, categories, rules] = await Promise.all([
    listPeople(db), listAccounts(db), listCategories(db, { archived: false }), db.count('rules'),
  ]);
  return { people, accounts, categoriesCount: categories.length, rulesCount: rules };
}
