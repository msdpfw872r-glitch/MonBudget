/**
 * mois.js — Mois affiché (commun au Journal, au Résumé et à l'Accueil) et filtre « pour qui ».
 *
 * Version : 0.5.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Par défaut : le mois en cours s'il a des opérations, sinon le dernier mois qui en a.
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version.
 */

import { icon, esc } from './ui.js';
import { monthsWithData, shiftMonth } from '../src/core/journal.js';
import { formatMonth } from '../src/core/format.js';

const view = { month: null, personId: null };

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthName = (m) => { const n = MOIS[Number(m.slice(5, 7)) - 1]; return n[0].toUpperCase() + n.slice(1); };

/** Mois à afficher, choisi parmi ceux qui ont des opérations. */
export function currentMonth(transactions) {
  // Seul un mois choisi par la personne est retenu ; sinon on le recalcule (les données changent).
  if (view.month) return view.month;
  const now = new Date().toISOString().slice(0, 7);
  const months = monthsWithData(transactions);
  return months.includes(now) || !months.length ? now : months[0];
}

export const setMonth = (m) => { view.month = m; };
export const currentPerson = () => view.personId;
export const setPerson = (id) => { view.personId = id || null; };

/** « ‹ Septembre   Octobre 2026   Novembre › » (toujours un mot à côté de la flèche). */
export function monthSwitch(month) {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return `<div class="month-switch" role="group" aria-label="Choisir le mois">
      <button type="button" class="btn btn-secondary" data-mois="${prev}">${icon('retour')}${monthName(prev)}</button>
      <span class="month-current" aria-live="polite">${esc(formatMonth(`${month}-01`))}</span>
      <button type="button" class="btn btn-secondary" data-mois="${next}">${monthName(next)}${icon('suite')}</button>
    </div>`;
}

/** Filtre « Tout le monde / Maman / Papa / … ». */
export function personFilter(people, selected) {
  const chip = (id, label, color) => `<button type="button" class="pick chip${color ? ' chip-person' : ''}" data-filtre-personne="${esc(id)}"
      ${color ? `data-color="${esc(color)}"` : ''} aria-pressed="${(selected ?? '') === id}">${esc(label)}</button>`;
  return `<div class="chips" role="group" aria-label="Pour qui">
      ${chip('', 'Tout le monde')}${people.map((p) => chip(p.id, p.name, p.color)).join('')}
    </div>`;
}

/** Applique les couleurs et largeurs (pas de style en ligne : bloqué par la CSP). */
export function paint(root) {
  for (const el of root.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
  for (const el of root.querySelectorAll('[data-w]')) el.style.setProperty('--w', `${el.dataset.w}%`);
}
