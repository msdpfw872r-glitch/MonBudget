/**
 * mois.js — Période affichée (commune au Journal et au Résumé), filtre « pour qui », choix de période.
 *
 * Version : 0.16.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Périodes : Semaine, Mois, Année, Tout, Dates (du… au…). Par défaut : le mois en cours s'il a des
 * opérations, sinon le dernier mois qui en a. Seul un choix fait par la personne est retenu.
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version : mois, filtre pour qui.
 *   0.5.1  FRE (Fidag)  Périodes semaine / mois / année / tout / dates libres.
 *   0.16.0 FRE (Fidag)  Présentation compacte : « ‹ Octobre · Novembre 2026 (Mois) · Décembre › », le genre de période
 *                       et « Pour qui » se choisissent dans une petite fenêtre (filterChip).
 */

import { icon, esc } from './ui.js';
import { chooseOption } from './choix.js';
import { monthsWithData } from '../src/core/journal.js';
import { KINDS, periodFor, shiftPeriod, periodLabel, shiftLabel } from '../src/core/periode.js';

const view = { kind: 'mois', anchor: null, range: null, personId: null };

const today = () => new Date().toISOString().slice(0, 10);

/** Date de référence : choisie, sinon aujourd'hui si le mois a des opérations, sinon la dernière opération. */
function anchorFor(transactions) {
  if (view.anchor) return view.anchor;
  const now = today();
  const months = monthsWithData(transactions);
  if (!months.length || months.includes(now.slice(0, 7))) return now;
  return transactions.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
}

/** Période affichée. */
export function currentPeriod(transactions) {
  const anchor = anchorFor(transactions);
  if (view.kind === 'tout') {
    const dates = transactions.map((t) => t.date).sort();
    return periodFor('tout', anchor, dates.length ? { from: dates[0], to: dates.at(-1) } : null);
  }
  return periodFor(view.kind, anchor, view.range);
}

/** Mois « AAAA-MM » pour l'Accueil (toujours un mois). */
export function currentMonth(transactions) {
  return anchorFor(transactions).slice(0, 7);
}

export const currentPerson = () => view.personId;
export const setPerson = (id) => { view.personId = id || null; };

/** Bouton de filtre compact : petit titre + valeur, ouvre une fenêtre de choix. */
export function filterChip({ attr, label, value, active = false }) {
  return `<button type="button" class="fchip${active ? ' fchip-on' : ''}" ${attr}>
      <span class="fchip-label">${esc(label)}</span>
      <span class="fchip-value">${esc(value)}${icon('suite')}</span>
    </button>`;
}

const KIND_SUB = {
  semaine: 'Du lundi au dimanche', mois: 'Un mois entier', annee: 'Une année entière',
  tout: 'Toutes les opérations', libre: 'Choisir les dates « du … au … »',
};

/** Période : « ‹ Octobre | Novembre 2026 · Mois | Décembre › » (et « Du … au … » pour des dates). */
export function periodControls(p) {
  const kind = KINDS.find((k) => k.id === p.kind)?.label ?? '';
  const pick = `<button type="button" class="period-pick" data-choisir-periode aria-label="Changer de période : ${esc(periodLabel(p))}">
      <span class="period-title">${esc(periodLabel(p))}</span>
      <span class="period-kind">${esc(kind)} · changer${icon('suite')}</span>
    </button>`;
  const dates = p.kind === 'libre' ? `<div class="period-dates">
      <label class="field"><span>Du</span><input type="date" data-date="from" value="${esc(p.from)}" required></label>
      <label class="field"><span>Au</span><input type="date" data-date="to" value="${esc(p.to)}" required></label>
    </div>` : '';
  if (p.kind === 'tout') return `<div class="period-row period-row-alone">${pick}</div>`;
  return `<div class="period-row" role="group" aria-label="Période">
      <button type="button" class="btn btn-secondary period-step" data-decaler="-1">${icon('retour')}<span>${esc(shiftLabel(p, -1))}</span></button>
      ${pick}
      <button type="button" class="btn btn-secondary period-step" data-decaler="1"><span>${esc(shiftLabel(p, 1))}</span>${icon('suite')}</button>
    </div>${dates}`;
}

/** Applique un genre de période (semaine, mois…), en gardant une date de la période affichée. */
function setKind(kind, transactions) {
  const p = currentPeriod(transactions);
  const t = today();
  const anchor = t >= p.from && t <= p.to ? t : p.to;
  view.kind = kind;
  view.anchor = anchor;
  if (view.kind === 'libre') {
    view.range = p.kind === 'tout' || p.kind === 'annee' ? { from: `${anchor.slice(0, 7)}-01`, to: anchor } : { from: p.from, to: p.to };
  }
}

/**
 * Gère les boutons de période.
 * @returns {Promise<boolean>} vrai si la période a changé (il faut redessiner)
 */
export async function handlePeriodClick(b, transactions) {
  if ('choisirPeriode' in b.dataset) {
    const p = currentPeriod(transactions);
    const id = await chooseOption({ title: 'Quelle période ?', selected: p.kind,
      options: KINDS.map((k) => ({ id: k.id, name: k.label, sub: KIND_SUB[k.id] })) });
    if (!id || id === p.kind) return false;
    setKind(id, transactions);
    return true;
  }
  if (b.dataset.periode) { setKind(b.dataset.periode, transactions); return true; }
  if (b.dataset.decaler) {
    const q = shiftPeriod(currentPeriod(transactions), Number(b.dataset.decaler));
    view.anchor = q.from;
    if (q.kind === 'libre') view.range = { from: q.from, to: q.to };
    return true;
  }
  return false;
}

/** Une date « Du » / « Au » a changé. */
export function handleDateChange(input, transactions) {
  if (!input.value) return false;
  const p = currentPeriod(transactions);
  view.range = { from: p.from, to: p.to, [input.dataset.date]: input.value };
  view.anchor = view.range.from;
  return true;
}

/** Filtre « Pour qui » (bouton compact). */
export function personFilter(people, selected) {
  const p = people.find((x) => x.id === selected);
  return filterChip({ attr: 'data-choisir-personne', label: 'Pour qui', value: p ? p.name : 'Tout le monde', active: Boolean(p) });
}

/** Ouvre le choix « Pour qui » ; vrai si le choix a changé. */
export async function pickPerson(people) {
  const ALL = '__tous';
  const id = await chooseOption({ title: 'Pour qui ?', selected: view.personId ?? ALL,
    options: [{ id: ALL, name: 'Tout le monde' }, ...people.map((p) => ({ id: p.id, name: p.name, color: p.color }))] });
  if (!id) return false;
  const next = id === ALL ? null : id;
  if (next === view.personId) return false;
  view.personId = next;
  return true;
}

/** « ce mois-ci », « cette semaine »… pour « Il reste … ». */
export function periodWords(p) {
  return { mois: 'ce mois-ci', semaine: 'cette semaine', annee: 'cette année' }[p.kind] ?? 'sur la période';
}

/** Applique les couleurs et largeurs (pas de style en ligne : bloqué par la CSP). */
export function paint(root) {
  for (const el of root.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
  for (const el of root.querySelectorAll('[data-w]')) el.style.setProperty('--w', `${el.dataset.w}%`);
}
