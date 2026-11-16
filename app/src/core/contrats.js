/**
 * contrats.js — Analyse des références de paiement (QR / SCOR) : plusieurs contrats chez un même créancier.
 *
 * Version : 0.23.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-16
 *
 * Exemple réel (Wingo) : 20 paiements au même créancier, même IBAN, deux par mois ; seule la référence QR
 * les distingue : 0000005080268302… et 0000005080063959… (le début reste fixe pour chaque contrat, la fin
 * change à chaque facture). L'analyse cherche, pour chaque créancier, le plus court début de référence qui
 * partage ses paiements en au moins deux groupes qui reviennent (≥ 2 paiements chacun), couvrant presque
 * tous ses paiements, et payés EN PARALLÈLE (les mêmes mois, au moins deux fois) : une série de factures
 * numérotées qui se suivent (Swisscard, caisse-maladie…) n'est pas un « contrat ». Elle sert aussi à retrouver le créancier d'un « Ordre e-Bill » sans nom.
 * Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.23.0 FRE (Fidag)  Première version.
 */

import { isGenericKey, findRule } from './regles.js';
import { ReglageError } from './reglages.js';
import { merchantKey } from './text.js';

const MIN_PER_GROUP = 2;
const MIN_COVER = 0.8;
/** Mois où au moins deux contrats sont payés : il en faut au moins 2 (sinon c'est un numéro de facture qui avance). */
const MIN_SHARED_MONTHS = 2;

/** Nombre de mois où au moins deux groupes ont un paiement. */
function sharedMonths(groups) {
  const months = new Map();
  groups.forEach((xs, gi) => {
    for (const x of xs) {
      const m = String(x.t.date).slice(0, 7);
      if (!months.has(m)) months.set(m, new Set());
      months.get(m).add(gi);
    }
  });
  return [...months.values()].filter((s) => s.size >= 2).length;
}

/** Référence structurée utilisable (QR de 27 chiffres ou créancier « RF… »), sans espaces. */
export function cleanRef(ref) {
  const r = String(ref ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^\d{27}$/.test(r) || /^RF\d{2}[A-Z0-9]{5,21}$/.test(r)) return r;
  return '';
}

const commonPrefix = (list) => list.reduce((p, s) => { let i = 0; while (i < p.length && p[i] === s[i]) i++; return p.slice(0, i); });

/** Libellé court d'un contrat : les chiffres significatifs du début fixe (« 5080268302 »). */
export function contractLabel(prefix) {
  const digits = prefix.replace(/^RF\d{2}/, '').replace(/^0+/, '');
  return digits.slice(0, 10) || prefix.slice(-6);
}

/**
 * Cherche les contrats d'un créancier.
 * @param {object[]} list  paiements de ce créancier (avec `reference`)
 * @returns {null|{prefixLen: number, groups: {prefix: string, label: string, items: object[]}[]}}
 */
export function splitByReference(list) {
  const withRef = list.map((t) => ({ t, ref: cleanRef(t.reference) })).filter((x) => x.ref);
  if (withRef.length < 2 * MIN_PER_GROUP) return null;
  const maxLen = Math.min(...withRef.map((x) => x.ref.length)) - 4;
  for (let len = 6; len <= maxLen; len++) {
    const g = new Map();
    for (const x of withRef) {
      const k = x.ref.slice(0, len);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(x);
    }
    const recurring = [...g.values()].filter((xs) => xs.length >= MIN_PER_GROUP);
    if (g.size < 2) continue;
    const covered = recurring.reduce((s, xs) => s + xs.length, 0);
    // Des contrats en parallèle (payés les mêmes mois), pas une série de factures numérotées qui se suivent.
    if (recurring.length >= 2 && covered / withRef.length >= MIN_COVER && sharedMonths(recurring) >= MIN_SHARED_MONTHS) {
      return {
        prefixLen: len,
        groups: recurring.map((xs) => {
          // Début fixe réel du groupe (souvent plus long que len) : plus parlant pour l'affichage.
          const full = commonPrefix(xs.map((x) => x.ref));
          return { prefix: xs[0].ref.slice(0, len), label: contractLabel(full), items: xs.map((x) => x.t) };
        }).sort((a, b) => b.items.length - a.items.length),
      };
    }
    // Trop de petits groupes : on ne découpera pas mieux en allongeant le début.
    if (recurring.length === 0) break;
  }
  return null;
}

/** Nom du créancier d'une opération (contrepartie, sinon commerçant). */
const creditorKey = (t) => merchantKey(t.counterparty?.name || t.merchant || t.description || '');

/**
 * Analyse de toutes les opérations : contrats par créancier, et « Ordre e-Bill » sans nom dont la
 * référence correspond à un créancier connu.
 * @returns {{contracts: {merchantKey: string, name: string, prefixLen: number, groups: object[]}[],
 *            unnamed: {t: object, merchantKey: string, name: string}[]}}
 */
export function analyzeReferences(transactions) {
  const byCreditor = new Map();
  for (const t of transactions) {
    if (!cleanRef(t.reference)) continue;
    const k = creditorKey(t);
    if (!k || isGenericKey(k)) continue;
    if (!byCreditor.has(k)) byCreditor.set(k, { name: t.counterparty?.name || t.merchant || t.description, list: [] });
    byCreditor.get(k).list.push(t);
  }
  const contracts = [];
  for (const [k, c] of byCreditor) {
    const s = splitByReference(c.list);
    if (s) contracts.push({ merchantKey: k, name: c.name, ...s });
  }
  // « Ordre e-Bill » sans nom : début de référence commun (≥ 12 caractères) avec un seul créancier connu.
  const unnamed = [];
  for (const t of transactions) {
    const ref = cleanRef(t.reference);
    if (!ref || !isGenericKey(creditorKey(t))) continue;
    let best = null;
    for (const [k, c] of byCreditor) {
      const len = Math.max(...c.list.map((x) => commonPrefix([cleanRef(x.reference), ref]).length));
      if (len >= 12 && (!best || len > best.len)) best = { k, name: c.name, len };
      else if (best && len === best.len && k !== best.k) best.tie = true;
    }
    if (best && !best.tie) unnamed.push({ t, merchantKey: best.k, name: best.name });
  }
  return { contracts: contracts.sort((a, b) => a.name.localeCompare(b.name, 'fr')), unnamed };
}

/**
 * Donne leur créancier aux « Ordre e-Bill » sans nom reconnus par leur référence.
 * @param {{onlyPending?: boolean}} [opts]  par défaut seulement les opérations à trier
 * @returns {Promise<number>}
 */
export async function nameFromReferences(db, { onlyPending = true } = {}) {
  const all = await db.getAll('transactions');
  const { unnamed } = analyzeReferences(all);
  let n = 0;
  for (const u of unnamed) {
    if (onlyPending && u.t.status === 'classee') continue;
    await db.put('transactions', { ...u.t, merchant: u.name, merchantKey: u.merchantKey });
    n++;
  }
  return n;
}

/** Contrats détectés dont les règles par contrat n'existent pas encore toutes. */
export async function contractsToSetUp(db) {
  const [all, rules] = await Promise.all([db.getAll('transactions'), db.getAll('rules')]);
  return analyzeReferences(all).contracts
    .map((c) => ({ ...c, groups: c.groups.map((g) => ({ ...g, rule: rules.find((r) => r.merchantKey === c.merchantKey && r.refPrefix === g.prefix) ?? null,
      general: rules.find((r) => r.merchantKey === c.merchantKey && !r.refPrefix) ?? null })) }))
    .filter((c) => c.groups.some((g) => !g.rule));
}

/**
 * Crée (ou met à jour) la règle d'un contrat : ce créancier ET une référence qui commence par `prefix`.
 * @returns {Promise<object>} la règle
 */
export async function saveContractRule(db, { merchantKey: key, prefix, label, personId, categoryId }) {
  if (!personId || !(personId === '__titulaire' || await db.get('people', personId))) throw new ReglageError('Choisissez pour qui.');
  if (!categoryId || !(await db.get('categories', categoryId))) throw new ReglageError('Choisissez une catégorie.');
  const same = (await db.getAllWhere('rules', 'merchantKey', key)).find((r) => r.refPrefix === prefix);
  const now = new Date().toISOString();
  const rule = same ? { ...same, personId, categoryId, contractLabel: label }
    : { id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, merchantKey: key, refPrefix: prefix, contractLabel: label,
      personId, categoryId, createdAt: now, lastUsedAt: now, hits: 0 };
  await db.put('rules', rule);
  return rule;
}

/** Contrat d'une opération (libellé), d'après les règles par contrat. */
export function contractOf(t, rules) {
  const r = findRule(rules, t.merchantKey, t.reference);
  return r?.refPrefix ? r.contractLabel ?? null : null;
}
