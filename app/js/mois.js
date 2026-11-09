/**
 * mois.js — Période affichée (commune au Journal et au Résumé), filtre « pour qui », choix de période.
 *
 * Version : 0.5.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Périodes : Semaine, Mois, Année, Tout, Dates (du… au…). Par défaut : le mois en cours s'il a des
 * opérations, sinon le dernier mois qui en a. Seul un choix fait par la personne est retenu.
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version : mois, filtre pour qui.
 *   0.5.1  FRE (Fidag)  Périodes semaine / mois / année / tout / dates libres.
 */

import { icon, esc } from './ui.js';
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

/** Choix de période : « Semaine | Mois | Année | Tout | Dates », puis « ‹ … · période · … › » ou « Du … au … ». */
export function periodControls(p) {
  const kinds = `<div class="period-kinds" role="group" aria-label="Période">
      ${KINDS.map((k) => `<button type="button" class="pick" data-periode="${k.id}" aria-pressed="${p.kind === k.id}">${k.label}</button>`).join('')}
    </div>`;
  if (p.kind === 'tout') return `${kinds}<p class="month-current period-alone">${esc(periodLabel(p))}</p>`;
  const dates = p.kind === 'libre' ? `<div class="period-dates">
      <label class="field"><span>Du</span><input type="date" data-date="from" value="${esc(p.from)}" required></label>
      <label class="field"><span>Au</span><input type="date" data-date="to" value="${esc(p.to)}" required></label>
    </div>` : '';
  return `${kinds}${dates}
    <div class="month-switch" role="group" aria-label="Changer de période">
      <button type="button" class="btn btn-secondary" data-decaler="-1">${icon('retour')}${esc(shiftLabel(p, -1))}</button>
      <span class="month-current" aria-live="polite">${esc(periodLabel(p))}</span>
      <button type="button" class="btn btn-secondary" data-decaler="1">${esc(shiftLabel(p, 1))}${icon('suite')}</button>
    </div>`;
}

/**
 * Gère les boutons et les dates du choix de période.
 * @returns {boolean} vrai si l'action concernait la période (il faut redessiner)
 */
export function handlePeriodClick(b, transactions) {
  if (b.dataset.periode) {
    // On garde une date située dans la période affichée : aujourd'hui si elle y est, sinon son dernier jour.
    const p = currentPeriod(transactions);
    const t = today();
    const anchor = t >= p.from && t <= p.to ? t : p.to;
    view.kind = b.dataset.periode;
    view.anchor = anchor;
    if (view.kind === 'libre') {
      view.range = p.kind === 'tout' || p.kind === 'annee' ? { from: `${anchor.slice(0, 7)}-01`, to: anchor } : { from: p.from, to: p.to };
    }
    return true;
  }
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

/** Filtre « Tout le monde / Maman / Papa / … ». */
export function personFilter(people, selected) {
  const chip = (id, label, color) => `<button type="button" class="pick chip${color ? ' chip-person' : ''}" data-filtre-personne="${esc(id)}"
      ${color ? `data-color="${esc(color)}"` : ''} aria-pressed="${(selected ?? '') === id}">${esc(label)}</button>`;
  return `<div class="chips" role="group" aria-label="Pour qui">
      ${chip('', 'Tout le monde')}${people.map((p) => chip(p.id, p.name, p.color)).join('')}
    </div>`;
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
