/**
 * entretien.js — Après une mise à jour de l'app : les opérations encore « à trier » sont relues
 * avec la lecture améliorée des fichiers de banque, puis passées aux règles retenues.
 *
 * Version : 0.16.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-15
 *
 * Seules les opérations « à trier » sont touchées (jamais un tri fait à la main).
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.16.0 FRE (Fidag)  Première version.
 */

import { merchantKey } from './text.js';
import { findRule, applyRule } from './regles.js';
import { cardText } from '../importers/camt053.js';

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
    if (rule) {
      tx = applyRule(tx, rule);
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
