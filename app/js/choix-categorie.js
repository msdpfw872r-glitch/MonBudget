/**
 * choix-categorie.js — Fenêtre « C'est quoi ? » : choisir une catégorie avec une loupe.
 *
 * Version : 0.4.4
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Une seule étiquette dans le formulaire ; en la touchant, cette fenêtre s'ouvre :
 * loupe « Chercher une catégorie », ordre « Derniers utilisés » / « De A à Z » (retenu),
 * puis les catégories, une par ligne (dépenses ou rentrées selon l'opération d'abord).
 *
 * Historique :
 *   0.4.4  FRE (Fidag)  Première version.
 */

import { icon, esc } from './ui.js';
import { searchCategories, orderCategories } from '../src/core/tri.js';

const ORDER_KEY = 'mon-budget.ordre-categories';
const RECENT_MAX = 6;

function savedOrder() {
  try { return localStorage.getItem(ORDER_KEY) === 'alpha' ? 'alpha' : 'recent'; } catch { return 'recent'; }
}

function dialogEl() {
  let d = document.getElementById('choix-categorie');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'choix-categorie';
  d.className = 'sheet picker';
  d.setAttribute('aria-labelledby', 'choix-categorie-titre');
  d.innerHTML = `<div class="sheet-head">
      <h2 id="choix-categorie-titre">C’est quoi ?</h2>
      <button type="button" class="btn btn-secondary" data-fermer>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Fermer
      </button>
    </div>
    <div class="picker-tools">
      <label class="search">
        ${icon('loupe')}<span class="visually-hidden">Chercher une catégorie</span>
        <input type="search" data-chercher placeholder="Chercher une catégorie" autocomplete="off" enterkeyhint="search">
      </label>
      <div class="order-switch" role="group" aria-label="Ordre des catégories">
        <button type="button" class="pick" data-ordre-cat="recent">Derniers utilisés</button>
        <button type="button" class="pick" data-ordre-cat="alpha">De A à Z</button>
      </div>
    </div>
    <div class="sheet-body picker-list" data-liste></div>`;
  document.body.append(d);
  return d;
}

/**
 * Ouvre la fenêtre et renvoie l'identifiant choisi (ou null si fermée sans choisir).
 * @param {object} opts
 * @param {object[]} opts.categories  catégories non archivées
 * @param {Map<string,string>} opts.lastUsed  id → date de dernière utilisation
 * @param {'depense'|'recette'} opts.type     genre proposé d'abord
 * @param {string|null} opts.selected
 * @returns {Promise<string|null>}
 */
export function chooseCategory({ categories, lastUsed, type, selected }) {
  const d = dialogEl();
  const input = d.querySelector('[data-chercher]');
  const list = d.querySelector('[data-liste]');
  let order = savedOrder();

  const item = (c) => `<button type="button" class="picker-item" data-category="${esc(c.id)}" aria-pressed="${c.id === selected}">
      <span>${esc(c.name)}</span>${c.id === selected ? `${icon('ok')}<span class="visually-hidden">(choisie)</span>` : ''}</button>`;
  const group = (title, items) => (items.length ? `<h3 class="group-title">${title}</h3><div class="picker-group">${items.map(item).join('')}</div>` : '');

  const draw = () => {
    for (const b of d.querySelectorAll('[data-ordre-cat]')) b.setAttribute('aria-pressed', String(b.dataset.ordreCat === order));
    const q = input.value.trim();
    if (q) {
      const found = searchCategories(categories, q);
      list.innerHTML = found.length ? `<div class="picker-group">${found.map(item).join('')}</div>`
        : '<p class="note">Aucune catégorie ne correspond. Essayez un autre mot, ou ajoutez-la dans Réglages, « Mes catégories ».</p>';
      return;
    }
    const other = type === 'depense' ? 'recette' : 'depense';
    const names = { depense: 'Dépenses', recette: 'Rentrées' };
    const ofType = (t) => orderCategories(categories.filter((c) => c.type === t), order, lastUsed);
    let html = '';
    if (order === 'recent') {
      const recent = orderCategories(categories.filter((c) => lastUsed.has(c.id)), 'recent', lastUsed).slice(0, RECENT_MAX);
      html += group('Derniers utilisés', recent);
    }
    html += group(names[type], ofType(type)) + group(names[other], ofType(other));
    list.innerHTML = html;
  };

  draw();
  input.value = '';
  draw();
  list.scrollTop = 0;
  d.showModal();

  return new Promise((resolve) => {
    let picked = null;
    input.oninput = draw;
    d.onclick = (e) => {
      if (e.target === d) { d.close(); return; } // toucher le fond ferme la fenêtre
      const b = e.target.closest('button');
      if (!b) return;
      if ('fermer' in b.dataset) d.close();
      else if (b.dataset.ordreCat) {
        order = b.dataset.ordreCat;
        try { localStorage.setItem(ORDER_KEY, order); } catch { /* sans gravité */ }
        draw();
      } else if (b.dataset.category) {
        picked = b.dataset.category;
        d.close();
      }
    };
    d.addEventListener('close', () => resolve(picked), { once: true });
  });
}
