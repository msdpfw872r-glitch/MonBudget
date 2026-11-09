/**
 * regles.js — Règles retenues : l'app se souvient du « pour qui » et du « quoi » de chaque commerce.
 *
 * Version : 0.7.0
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
 */

import { merchantKey } from './text.js';
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
export function applyRule(tx, rule) {
  return { ...tx, personId: rule.personId, categoryId: rule.categoryId, ruleId: rule.id, status: 'classee', classifiedAt: new Date().toISOString() };
}

async function checkChoice(db, personId, categoryId) {
  if (!personId || !(await db.get('people', personId))) throw new ReglageError('Choisissez pour qui.');
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
  let n = 0;
  for (const tx of pending) {
    if (findRule(rules, tx.merchantKey)?.id !== rule.id) continue;
    await db.put('transactions', applyRule(tx, rule));
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
export async function classify(db, txId, { personId, categoryId, remember = false, updateRule = false }) {
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
    rule = await upsertRule(db, { merchantKey: tx.merchantKey, personId, categoryId });
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
  await checkChoice(db, personId, categoryId);
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

/**
 * Textes de banque qui ne disent pas qui a été payé (BCVs : « Crédit », « Ordre e-Bill »… ; TWINT).
 * Une règle sur ces textes classerait tout de la même façon : « Toujours classer » n'est pas coché d'office.
 */
const GENERIC = new Set(['CREDIT', 'DEBIT', 'ORDRE E BILL', 'ORDRE E BANKING', 'ORDRE PERMANENT', 'ORDRE DE PAIEMENT',
  'VIREMENT', 'PAIEMENT', 'VERSEMENT', 'BONIFICATION', 'TWINT', 'TWINT UBS TWINT ZURICH']);
export function isGenericKey(key) {
  return GENERIC.has(String(key ?? '').trim()) || /^TWINT( UBS)?( TWINT)?( ZURICH)?$/.test(String(key ?? '').trim());
}
