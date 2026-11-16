/**
 * entretien.js — Après une mise à jour de l'app : les opérations encore « à trier » sont relues
 * avec la lecture améliorée des fichiers de banque, puis passées aux règles retenues.
 *
 * Version : 0.22.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-15
 *
 * Seules les opérations « à trier » sont touchées (jamais un tri fait à la main).
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.16.0 FRE (Fidag)  Première version.
 *   0.21.0 FRE (Fidag)  Relancer le classement sans réimporter : numéros sans compte, opérations remises sur la bonne
 *                       carte (pour qui = titulaire), règles, factures de carte.
 *   0.22.0 FRE (Fidag)  Règles « titulaire de la carte ».
 */

import { merchantKey } from './text.js';
import { findRule, applyRule, canApply, accountsById } from './regles.js';
import { cardText } from '../importers/camt053.js';
import { normRef } from './reglages.js';
import { autoLinkAll } from './cartes.js';

const NO_NAME = /^(NOT ?PROVIDED|N\/?A|NONE|-)$/i;

/** Nouveau nom de commerçant pour une opération déjà enregistrée, ou null si rien ne change. */
export function betterMerchant(t) {
  if (!String(t.id ?? '').startsWith('camt|')) return null;
  const card = cardText(t.description);
  if (card && card.name !== t.merchant) return { merchant: card.name, bankCategory: card.category };
  if (t.merchant && NO_NAME.test(t.merchant.trim())) {
    const first = String(t.description ?? '').split(' · ')[0].trim();
    if (first && !NO_NAME.test(first)) return { merchant: first, bankCategory: t.bankCategory };
  }
  return null;
}

/**
 * Relit les opérations à trier et applique les règles.
 * @returns {Promise<{relues: number, corrigees: number, classees: number}>}
 */
export async function refreshPending(db) {
  const pending = await db.getAllWhere('transactions', 'status', 'a-trier');
  const rules = await db.getAll('rules');
  const acc = await accountsById(db);
  const hits = new Map();
  let corrigees = 0;
  let classees = 0;
  const changed = [];
  for (const t of pending) {
    let tx = t;
    const better = betterMerchant(t);
    if (better) {
      tx = { ...tx, ...better, merchantKey: merchantKey(better.merchant) };
      corrigees++;
    }
    const rule = findRule(rules, tx.merchantKey);
    if (rule && canApply(rule, acc.get(tx.accountId))) {
      tx = applyRule(tx, rule, acc.get(tx.accountId));
      hits.set(rule.id, (hits.get(rule.id) ?? 0) + 1);
      classees++;
    }
    if (tx !== t) changed.push(tx);
  }
  if (changed.length) await db.putMany('transactions', changed);
  for (const [id, n] of hits) {
    const r = rules.find((x) => x.id === id);
    await db.put('rules', { ...r, hits: (r.hits ?? 0) + n, lastUsedAt: new Date().toISOString() });
  }
  return { relues: pending.length, corrigees, classees };
}

/**
 * Numéro de compte ou de carte d'où vient l'opération (gardé à l'import, sinon lu dans son identifiant :
 * « date|centimes|****1234|commerce|n » ou « camt|IBAN|… »).
 */
export function refOf(t) {
  if (t.accountRef) return normRef(t.accountRef);
  const parts = String(t.id ?? '').split('|');
  if (parts[0] === 'camt') return normRef(parts[1] ?? '');
  return parts.length >= 5 ? normRef(parts[2]) : '';
}

/** Numéros présents dans les opérations mais rattachés à aucun compte (ex. « Oublier » dans Mes comptes). */
export async function unknownRefs(db) {
  const accounts = await db.getAll('accounts');
  const known = new Set(accounts.flatMap((a) => (a.bankRefs ?? []).map(normRef)));
  const m = new Map();
  for (const t of await db.getAll('transactions')) {
    const ref = refOf(t);
    if (!ref || known.has(ref)) continue;
    const e = m.get(ref) ?? { ref, count: 0, accountIds: new Set(), kind: ref.startsWith('*') ? 'carte' : 'compte' };
    e.count++;
    e.accountIds.add(t.accountId);
    m.set(ref, e);
  }
  return [...m.values()].map((e) => ({ ...e, accountIds: [...e.accountIds] }));
}

/**
 * Remet chaque opération sur le compte (ou la carte) qui porte son numéro.
 * Pour qui : si c'était le titulaire de l'ancienne carte, devient celui de la nouvelle.
 * Rattachement à une facture : retiré si la nouvelle carte n'est pas payée depuis le même compte.
 * @returns {Promise<{deplacees: number, personnes: number}>}
 */
export async function relocateByRefs(db) {
  const accounts = await db.getAll('accounts');
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const owner = new Map();
  for (const a of accounts) for (const r of a.bankRefs ?? []) owner.set(normRef(r), a);
  let deplacees = 0;
  let personnes = 0;
  const changed = [];
  for (const t of await db.getAll('transactions')) {
    const to = owner.get(refOf(t));
    if (!to || to.id === t.accountId) continue;
    const from = byId.get(t.accountId);
    let tx = { ...t, accountId: to.id };
    if (tx.cardBillId && from?.billPaidFrom !== to.billPaidFrom) tx.cardBillId = null;
    if (tx.status === 'classee' && from?.personId && tx.personId === from.personId && to.personId && to.personId !== from.personId) {
      tx.personId = to.personId;
      personnes++;
    }
    changed.push(tx);
    deplacees++;
  }
  if (changed.length) await db.putMany('transactions', changed);
  return { deplacees, personnes };
}

/**
 * Relancer le classement sans réimporter : bons comptes, règles sur les opérations à trier, factures de carte.
 * @returns {Promise<{deplacees: number, personnes: number, corrigees: number, classees: number, factures: number}>}
 */
export async function reprocessAll(db) {
  const moved = await relocateByRefs(db);
  const r = await refreshPending(db);
  const factures = await autoLinkAll(db);
  return { ...moved, corrigees: r.corrigees, classees: r.classees, factures };
}
