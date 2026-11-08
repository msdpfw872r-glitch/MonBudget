/**
 * reglages.js — Données de départ et réglages : comptes, personnes (« pour qui »), catégories.
 *
 * Version : 0.3.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Ne dépend pas du navigateur : reçoit la base (voir data/db.js) en paramètre.
 * Les erreurs sont des ReglageError avec un message en mots simples, prêt à afficher.
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version : installation des données de départ, ajout,
 *                       modification, archivage et suppression (avec vérification d'usage).
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
  { id: 'camt053', label: 'BCVs', available: false },
  { id: 'swisscard-csv', label: 'Mastercard (Swisscard)', available: false },
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
    seededAt: now.toISOString(),
    lastBackupAt: settings?.lastBackupAt ?? null,
  });
  return true;
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

export async function saveAccount(db, { id, name, kind, importFormat }) {
  const n = cleanName(name, 'ce compte');
  if (!ACCOUNT_KINDS.some((k) => k.id === kind)) throw new ReglageError('Choisissez s’il s’agit d’un compte ou d’une carte.');
  if (!IMPORT_FORMATS.some((f) => f.id === importFormat)) throw new ReglageError('Choisissez la banque.');
  const all = await checkUnique(db, 'accounts', n, id, 'Le compte');
  if (id) {
    const a = await mustGet(db, 'accounts', id);
    return db.put('accounts', { ...a, name: n, kind, importFormat });
  }
  return db.put('accounts', { id: newId(all, n), name: n, kind, importFormat, order: nextOrder(all) });
}

export async function deleteAccount(db, id) {
  const u = await usage(db, 'accountId', id);
  if (u.total) {
    throw new ReglageError(`Impossible de supprimer : ce compte contient encore ${usageText(u)}.`);
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

/* ---------- Divers ---------- */

/** Résumé pour l'écran Réglages. */
export async function overview(db) {
  const [people, accounts, categories, rules] = await Promise.all([
    listPeople(db), listAccounts(db), listCategories(db, { archived: false }), db.count('rules'),
  ]);
  return { people, accounts, categoriesCount: categories.length, rulesCount: rules };
}
