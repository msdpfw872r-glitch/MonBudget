/**
 * regles.js — Règles retenues : l'app se souvient du « pour qui » et du « quoi » de chaque commerce.
 *
 * Version : 0.22.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Fonctionnement (CLAUDE.md § 4, « Règles retenues ») :
 *   1. règle dont la clé est identique à celle de l'opération → classée automatiquement ;
 *   2. sinon, règle dont la clé est contenue dans celle de l'opération (mots entiers ; la plus longue gagne) ;
 *   3. sinon → « à trier ». La catégorie de la banque n'est jamais appliquée seule.
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version : recherche, tri d'une opération, création / mise à jour /
 *                       suppression de règle, classement des autres opérations en attente.
 *   0.4.4  FRE (Fidag)  Date de classement (classifiedAt) pour proposer les catégories récentes.
 *   0.7.0  FRE (Fidag)  isGenericKey : textes qui ne disent pas qui a été payé (« Crédit », « Ordre e-Bill »…).
 *   0.13.0 FRE (Fidag)  Règle modifiée : reclasser (au choix) les opérations déjà classées par elle.
 *   0.17.0 FRE (Fidag)  reclassifyPreview / reclassifyMatching : aussi les opérations triées à la main (au choix) et
 *                       celles à trier ; filterRules / sortRules (recherche, pour qui, catégorie, ordre).
 *   0.22.0 FRE (Fidag)  « Pour qui : la titulaire de la carte » (CARD_HOLDER) : la personne vient de la carte utilisée.
 */

import { merchantKey, fold } from './text.js';
import { ReglageError } from './reglages.js';
import { unlinkBill } from './cartes.js';

/** Trouve la règle qui s'applique à une clé commerçant, ou null. */
export function findRule(rules, key) {
  if (!key) return null;
  let best = null;
  const padded = ` ${key} `;
  for (const r of rules) {
    if (!r.merchantKey) continue;
    if (r.merchantKey === key) return r;
    if (padded.includes(` ${r.merchantKey} `) && (!best || r.merchantKey.length > best.merchantKey.length)) best = r;
  }
  return best;
}

/** Applique une règle à une opération (sans enregistrer). */
/** Valeur de `personId` d'une règle : « la titulaire de la carte utilisée ». */
export const CARD_HOLDER = '__titulaire';
export const CARD_HOLDER_LABEL = 'Titulaire de la carte';

/** Personne donnée par la règle pour une opération de ce compte (null si la règle ne peut pas décider). */
export function personFor(rule, account) {
  if (rule.personId !== CARD_HOLDER) return rule.personId;
  return account?.kind === 'carte' && account.personId ? account.personId : null;
}

/** La règle peut-elle classer une opération de ce compte ? (« titulaire » : seulement une carte qui a une titulaire). */
export const canApply = (rule, account) => Boolean(personFor(rule, account));

export function applyRule(tx, rule, account = null) {
  return { ...tx, personId: personFor(rule, account), categoryId: rule.categoryId, ruleId: rule.id, status: 'classee', classifiedAt: new Date().toISOString() };
}

/** Comptes par identifiant (pour les règles « titulaire de la carte »). */
export async function accountsById(db) {
  return new Map((await db.getAll('accounts')).map((a) => [a.id, a]));
}

async function checkChoice(db, personId, categoryId, { allowHolder = false } = {}) {
  if (!personId || (!(allowHolder && personId === CARD_HOLDER) && !(await db.get('people', personId)))) throw new ReglageError('Choisissez pour qui.');
  const cat = categoryId && await db.get('categories', categoryId);
  if (!cat) throw new ReglageError('Choisissez une catégorie.');
  return cat;
}

function newRuleId() {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Classe les autres opérations « à trier » que cette règle reconnaît.
 * @returns {Promise<number>} nombre d'opérations classées.
 */
export async function applyRuleToPending(db, rule) {
  const pending = await db.getAllWhere('transactions', 'status', 'a-trier');
  const rules = await db.getAll('rules');
  const acc = await accountsById(db);
  let n = 0;
  for (const tx of pending) {
    if (findRule(rules, tx.merchantKey)?.id !== rule.id) continue;
    if (!canApply(rule, acc.get(tx.accountId))) continue;
    await db.put('transactions', applyRule(tx, rule, acc.get(tx.accountId)));
    n++;
  }
  if (n) await db.put('rules', { ...rule, hits: (rule.hits ?? 0) + n, lastUsedAt: new Date().toISOString() });
  return n;
}

/** Crée ou met à jour la règle d'une clé commerçant. */
export async function upsertRule(db, { merchantKey: key, personId, categoryId }, now = new Date()) {
  const existing = (await db.getAllWhere('rules', 'merchantKey', key))[0];
  const rule = existing
    ? { ...existing, personId, categoryId }
    : { id: newRuleId(), merchantKey: key, personId, categoryId, createdAt: now.toISOString(), lastUsedAt: now.toISOString(), hits: 0 };
  await db.put('rules', rule);
  return rule;
}

/**
 * Trie une opération (écran « À trier » ou correction).
 * @param {object} opts
 * @param {boolean} [opts.remember]   « Toujours classer X comme ça » : crée ou met à jour la règle.
 * @param {boolean} [opts.updateRule] correction d'une opération classée par une règle : changer aussi la règle.
 * @returns {Promise<{tx: object, rule: object|null, alsoClassified: number}>}
 */
export async function classify(db, txId, { personId, categoryId, remember = false, updateRule = false, holderRule = false }) {
  const tx = await db.get('transactions', txId);
  if (!tx) throw new ReglageError('Cette opération n’existe plus.');
  const cat = await checkChoice(db, personId, categoryId);
  let rule = null;
  let alsoClassified = 0;

  if (updateRule && tx.ruleId) {
    const old = await db.get('rules', tx.ruleId);
    if (old) {
      rule = { ...old, personId, categoryId };
      await db.put('rules', rule);
    }
  } else if (remember) {
    // « … pour la titulaire de la carte » : la règle retient la carte, pas la personne.
    rule = await upsertRule(db, { merchantKey: tx.merchantKey, personId: holderRule ? CARD_HOLDER : personId, categoryId });
  }

  const updated = {
    ...tx,
    personId,
    categoryId,
    status: 'classee',
    classifiedAt: new Date().toISOString(),
    // Sans règle, le choix est manuel : l'opération n'est plus liée à une règle.
    ruleId: rule ? rule.id : null,
    // La catégorie « Paiement de la facture de carte » fait de l'opération une facture à rattacher.
    isCardBillPayment: Boolean(cat.isCardBill),
  };
  await db.put('transactions', updated);
  // N'est plus une facture de carte : les achats qui y étaient rattachés sont libérés.
  if (tx.isCardBillPayment && !updated.isCardBillPayment) await unlinkBill(db, tx.id);
  if (rule) alsoClassified = await applyRuleToPending(db, rule);
  return { tx: updated, rule, alsoClassified };
}

/** Modifie une règle depuis Réglages (clé de reconnaissance, pour qui, quoi). */
export async function saveRule(db, id, { merchantKey: key, personId, categoryId }) {
  const rule = await db.get('rules', id);
  if (!rule) throw new ReglageError('Cette règle n’existe plus.');
  const k = merchantKey(key);
  if (k.length < 2) throw new ReglageError('Écrivez au moins un mot du nom du commerce.');
  await checkChoice(db, personId, categoryId, { allowHolder: true });
  const twin = (await db.getAllWhere('rules', 'merchantKey', k)).find((r) => r.id !== id);
  if (twin) throw new ReglageError(`Une autre règle reconnaît déjà « ${k} ».`);
  const updated = { ...rule, merchantKey: k, personId, categoryId };
  await db.put('rules', updated);
  return updated;
}

/** Supprime une règle ; les opérations déjà classées gardent leur classement. */
export async function deleteRule(db, id) {
  for (const tx of await db.getAllWhere('transactions', 'ruleId', id)) {
    await db.put('transactions', { ...tx, ruleId: null });
  }
  await db.delete('rules', id);
}

/** Opérations déjà classées par cette règle qui ne correspondent plus à son choix (pour qui / quoi). */
export async function outdatedByRule(db, rule) {
  return (await db.getAllWhere('transactions', 'ruleId', rule.id))
    .filter((t) => t.personId !== rule.personId || t.categoryId !== rule.categoryId);
}

/**
 * Reclasse les opérations déjà classées par la règle selon son nouveau choix.
 * @returns {Promise<number>} nombre d'opérations changées
 */
export async function reclassifyByRule(db, ruleId) {
  const rule = await db.get('rules', ruleId);
  if (!rule) throw new ReglageError('Cette règle n’existe plus.');
  const list = await outdatedByRule(db, rule);
  for (const t of list) await db.put('transactions', { ...t, personId: rule.personId, categoryId: rule.categoryId });
  return list.length;
}

/**
 * Opérations concernées par une règle (même commerce) dont le classement diffère de la règle :
 *   byRule : classées par cette règle ; manual : triées à la main ; pending : encore à trier.
 * Le prélèvement d'une facture de carte n'est jamais concerné.
 */
export async function reclassifyPreview(db, rule, { exceptId = null } = {}) {
  const rules = await db.getAll('rules');
  const acc = await accountsById(db);
  const out = { byRule: [], manual: [], pending: [] };
  for (const t of await db.getAll('transactions')) {
    if (t.id === exceptId || t.isCardBillPayment) continue;
    const mine = t.ruleId === rule.id || findRule(rules, t.merchantKey)?.id === rule.id;
    if (!mine || !canApply(rule, acc.get(t.accountId))) continue;
    if (t.status !== 'classee') out.pending.push(t);
    else if (t.personId === personFor(rule, acc.get(t.accountId)) && t.categoryId === rule.categoryId) continue;
    else if (t.ruleId === rule.id) out.byRule.push(t);
    else out.manual.push(t);
  }
  return out;
}

/**
 * Reclasse selon la règle : celles classées par elle et celles à trier ; avec `includeManual`,
 * aussi celles triées à la main.
 * @returns {Promise<number>}
 */
export async function reclassifyMatching(db, ruleId, { includeManual = false, exceptId = null } = {}) {
  const rule = await db.get('rules', ruleId);
  if (!rule) throw new ReglageError('Cette règle n’existe plus.');
  const p = await reclassifyPreview(db, rule, { exceptId });
  const list = [...p.byRule, ...p.pending, ...(includeManual ? p.manual : [])];
  const acc = await accountsById(db);
  for (const t of list) await db.put('transactions', applyRule(t, rule, acc.get(t.accountId)));
  if (p.pending.length) await db.put('rules', { ...rule, hits: (rule.hits ?? 0) + p.pending.length, lastUsedAt: new Date().toISOString() });
  return list.length;
}

/** Ordres de la liste des règles. */
export const RULE_ORDERS = [
  { id: 'alpha', label: 'Commerce, de A à Z', short: 'A à Z' },
  { id: 'hits', label: 'Les plus utilisées d’abord', short: 'Plus utilisées' },
  { id: 'recent', label: 'Utilisées récemment d’abord', short: 'Récentes' },
];

/**
 * Filtre les règles : texte (commerce, catégorie, personne), personne, catégorie.
 * @param {{query?: string, personId?: string|null, categoryId?: string|null}} f
 * @param {{categoriesById?: Map, peopleById?: Map}} ctx
 */
export function filterRules(rules, { query = '', personId = null, categoryId = null } = {}, ctx = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return rules.filter((r) => {
    if (personId && r.personId !== personId) return false;
    if (categoryId && r.categoryId !== categoryId) return false;
    if (!words.length) return true;
    const hay = fold([r.merchantKey, ctx.categoriesById?.get(r.categoryId)?.name, (r.personId === CARD_HOLDER ? CARD_HOLDER_LABEL : ctx.peopleById?.get(r.personId)?.name)].filter(Boolean).join(' | '));
    return words.every((w) => hay.includes(w));
  });
}

export function sortRules(rules, order = 'alpha') {
  const az = (a, b) => a.merchantKey.localeCompare(b.merchantKey, 'fr');
  const cmp = {
    alpha: az,
    hits: (a, b) => (b.hits ?? 0) - (a.hits ?? 0) || az(a, b),
    recent: (a, b) => String(b.lastUsedAt ?? b.createdAt ?? '').localeCompare(String(a.lastUsedAt ?? a.createdAt ?? '')) || az(a, b),
  }[order] ?? az;
  return [...rules].sort(cmp);
}

/**
 * Textes de banque qui ne disent pas qui a été payé (BCVs : « Crédit », « Ordre e-Bill »… ; TWINT).
 * Une règle sur ces textes classerait tout de la même façon : « Toujours classer » n'est pas coché d'office.
 */
const GENERIC = new Set(['CREDIT', 'DEBIT', 'ORDRE E BILL', 'ORDRE E BANKING', 'ORDRE PERMANENT', 'ORDRE DE PAIEMENT',
  'VIREMENT', 'PAIEMENT', 'VERSEMENT', 'BONIFICATION', 'TWINT', 'TWINT UBS TWINT ZURICH']);
export function isGenericKey(key) {
  return GENERIC.has(String(key ?? '').trim()) || /^TWINT( UBS)?( TWINT)?( ZURICH)?$/.test(String(key ?? '').trim());
}
