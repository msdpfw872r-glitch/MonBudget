/**
 * tri.js — Aides pour l'écran « À trier » : ordre des opérations, recherche de catégorie.
 *
 * Version : 0.4.4
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.4.2  FRE (Fidag)  Première version : « commerces fréquents d'abord », recherche sans accents.
 *   0.4.4  FRE (Fidag)  Catégories par « derniers utilisés » ou « de A à Z ».
 */

import { fold } from './text.js';

/** Nombre d'opérations en attente par clé commerçant. */
export function countByMerchant(pending) {
  const n = new Map();
  for (const t of pending) n.set(t.merchantKey, (n.get(t.merchantKey) ?? 0) + 1);
  return n;
}

/**
 * Ordonne les opérations à trier.
 * - 'date' : de la plus ancienne à la plus récente ;
 * - 'frequent' : les commerces qui reviennent le plus souvent d'abord (une règle les classe tous),
 *   puis par date à l'intérieur d'un même commerce.
 */
export function orderPending(pending, mode = 'frequent') {
  const byDate = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  const list = [...pending];
  if (mode !== 'frequent') return list.sort(byDate);
  const count = countByMerchant(list);
  return list.sort((a, b) => (count.get(b.merchantKey) - count.get(a.merchantKey))
    || String(a.merchantKey).localeCompare(String(b.merchantKey)) || byDate(a, b));
}

/**
 * Cherche des catégories par leur nom, sans tenir compte des accents ni des majuscules.
 * Chaque mot tapé doit se trouver dans le nom (« caisse mal » → « Caisse maladie (primes) »).
 * Les noms qui commencent par le texte tapé passent devant.
 */
export function searchCategories(categories, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const q = words.join(' ');
  return categories
    .filter((c) => !c.archived)
    .map((c) => ({ c, name: fold(c.name) }))
    .filter(({ name }) => words.every((w) => name.includes(w)))
    .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.name.localeCompare(b.name))
    .map(({ c }) => c);
}

/**
 * Date de dernière utilisation de chaque catégorie (opérations classées et règles).
 * @returns {Map<string, string>} id de catégorie → date ISO
 */
export function lastUsedByCategory(transactions, rules = []) {
  const last = new Map();
  const note = (id, when) => {
    if (!id || !when) return;
    if (!last.has(id) || when > last.get(id)) last.set(id, when);
  };
  for (const t of transactions) if (t.status === 'classee') note(t.categoryId, t.classifiedAt);
  for (const r of rules) note(r.categoryId, r.lastUsedAt);
  return last;
}

/**
 * Ordonne des catégories :
 * - 'recent' : la dernière utilisée d'abord, puis les jamais utilisées de A à Z ;
 * - 'alpha'  : de A à Z (ordre du dictionnaire français, sans tenir compte des accents).
 */
export function orderCategories(categories, mode = 'recent', lastUsed = new Map()) {
  const alpha = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  const list = [...categories];
  if (mode === 'alpha') return list.sort(alpha);
  return list.sort((a, b) => {
    const la = lastUsed.get(a.id) ?? '';
    const lb = lastUsed.get(b.id) ?? '';
    return lb.localeCompare(la) || alpha(a, b);
  });
}
