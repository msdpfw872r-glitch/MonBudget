/**
 * swisscard.js — Import des transactions Mastercard Swisscard (fichier CSV des « Web Services »).
 *
 * Version : 0.7.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Format reconnu (d'après un vrai fichier de novembre 2026, structure seulement) :
 *   Date transaction, Description, Commerçant, Numéro de carte, Monnaie, Montant, Monnaie étrangère,
 *   Montant étranger, Débit/Crédit, Statut, Catégorie de commerçant, Catégorie enregistrée
 *   (séparateur « , », champs entre guillemets, dates JJ.MM.AAAA, montants positifs + colonne Débit/Crédit).
 * Alias anglais et allemands prévus. Plusieurs cartes dans le même fichier (****1234).
 * Les opérations « En suspens » ne sont pas importées : elles viendront, au montant définitif, au
 * prochain import (pas de doublon ni de montant faux) ; leur nombre est indiqué.
 *
 * Historique :
 *   0.7.0  FRE (Fidag)  Première version.
 */

import { fold, parseAmount, parseDateCH, fingerprint } from '../core/text.js';
import { cardRef } from './ubs.js';

export const FORMAT_ID = 'swisscard-csv';
export const FORMAT_LABEL = 'Mastercard Swisscard — transactions';

const COLUMNS = {
  date: ['Date transaction', 'Date de transaction', 'Transaction date', 'Transaktionsdatum'],
  description: ['Description', 'Beschreibung'],
  merchant: ['Commerçant', 'Merchant', 'Händler'],
  card: ['Numéro de carte', 'Card number', 'Kartennummer'],
  currency: ['Monnaie', 'Currency', 'Währung'],
  amount: ['Montant', 'Amount', 'Betrag'],
  fxCurrency: ['Monnaie étrangère', 'Foreign currency', 'Fremdwährung'],
  fxAmount: ['Montant étranger', 'Foreign amount', 'Amount in foreign currency', 'Betrag in Fremdwährung', 'Fremdwährungsbetrag'],
  direction: ['Débit/Crédit', 'Debit/Credit', 'Debit/Kredit', 'Belastung/Gutschrift'],
  status: ['Statut', 'Status'],
  merchantCategory: ['Catégorie de commerçant', 'Merchant Category', 'Händlerkategorie'],
  registeredCategory: ['Catégorie enregistrée', 'Registered Category', 'Registrierte Kategorie'],
};

const PENDING = /^(EN SUSPENS|EN ATTENTE|PENDING|AUSSTEHEND|VORGEMERKT|OFFEN)/;
const CREDIT = /^(CREDIT|GUTSCHRIFT|KREDIT)/;
/** Règlement de la facture vu du côté de la carte (pas une rentrée). */
const CARD_PAYMENT_WORDS = /\bPAIEMENT\b|\bVOTRE PAIEMENT\b|\bVERSEMENT\b|\bPAYMENT\b|\bZAHLUNG\b|\bLSV\b|\bMERCI\b|\bDANKE\b/;

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map((c) => fold(c));
    const map = {};
    for (const [key, names] of Object.entries(COLUMNS)) {
      const i = cells.findIndex((c) => names.some((n) => fold(n) === c));
      if (i >= 0) map[key] = i;
    }
    if ('date' in map && 'amount' in map && 'card' in map && ('direction' in map || 'status' in map || 'merchantCategory' in map)) return { row: r, map };
  }
  return null;
}

export function detect(rows) {
  return findHeader(rows) !== null;
}

/**
 * @returns {{format, transactions, warnings, period, accounts, pendingCount}}
 */
export function parse(rows) {
  const h = findHeader(rows);
  if (!h) throw new Error('Ce fichier ne ressemble pas à un fichier Swisscard.');
  const { row: headerRow, map } = h;
  const get = (row, k) => (k in map ? String(row[map[k]] ?? '').trim() : '');
  const transactions = [];
  const warnings = [];
  const seen = new Map();
  let pendingCount = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.every((c) => String(c ?? '').trim() === '')) continue;
    const line = r + 1;
    try {
      if (PENDING.test(fold(get(row, 'status')))) { pendingCount++; continue; }
      const date = parseDateCH(get(row, 'date'));
      const description = get(row, 'description') || get(row, 'merchant');
      const raw = parseAmount(get(row, 'amount'));
      // Sans colonne Débit/Crédit : un montant positif est un achat (à vérifier sur le vrai fichier).
      const isCredit = 'direction' in map ? CREDIT.test(fold(get(row, 'direction'))) : raw < 0;
      const amount = isCredit ? Math.abs(raw) : -Math.abs(raw);
      const accountRef = cardRef(get(row, 'card'), { isCardColumn: true });
      const fx = get(row, 'fxCurrency') && get(row, 'fxAmount') ? `${get(row, 'fxCurrency')} ${get(row, 'fxAmount')}` : '';
      const base = { date, amount, accountRef, description };
      const key = fingerprint(base, 0);
      const occurrence = seen.get(key) || 0;
      seen.set(key, occurrence + 1);
      transactions.push({
        id: fingerprint(base, occurrence),
        source: FORMAT_ID,
        date,
        accountRef,
        accountKind: 'carte',
        description,
        merchant: get(row, 'merchant') || null,
        amount,
        currency: get(row, 'currency') || 'CHF',
        bankCategory: get(row, 'merchantCategory') || get(row, 'registeredCategory') || null,
        note: fx ? `Montant d’origine : ${fx}` : '',
        isCardBillPayment: false,
        isCardPaymentReceived: isCredit && CARD_PAYMENT_WORDS.test(fold(description)),
        sourceLine: line,
      });
    } catch (err) {
      warnings.push(`Ligne ${line} ignorée : ${err.message}`);
    }
  }
  const dates = transactions.map((t) => t.date).sort();
  return {
    format: FORMAT_ID,
    transactions,
    warnings,
    period: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
    accounts: [...new Set(transactions.map((t) => t.accountRef))],
    pendingCount,
  };
}
