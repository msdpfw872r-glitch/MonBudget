/**
 * choix.js — Fenêtre de choix avec loupe : « C'est quoi ? » (catégories) et « Pour qui ? » (personnes).
 *
 * Version : 0.4.5
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Une seule étiquette dans le formulaire ; en la touchant, cette fenêtre s'ouvre :
 * loupe, ordre « Derniers utilisés » / « De A à Z » (retenu séparément pour chaque fenêtre),
 * puis les éléments, un par ligne (avec la couleur pour les personnes).
 *
 * Historique :
 *   0.4.4  FRE (Fidag)  Première version (choix-categorie.js) : catégories.
 *   0.4.5  FRE (Fidag)  Fenêtre générique (choix.js) ; choix d'une personne quand il y en a plus de 6.
 */

import { icon, esc } from './ui.js';
import { searchCategories, orderByUse } from '../src/core/tri.js';

const RECENT_MAX = 6;

function savedOrder(key) {
  try { return localStorage.getItem(key) === 'alpha' ? 'alpha' : 'recent'; } catch { return 'recent'; }
}

function dialogEl() {
  let d = document.getElementById('fenetre-choix');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'fenetre-choix';
  d.className = 'sheet picker';
  d.setAttribute('aria-labelledby', 'fenetre-choix-titre');
  d.innerHTML = `<div class="sheet-head">
      <h2 id="fenetre-choix-titre"></h2>
      <button type="button" class="btn btn-secondary" data-fermer>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Fermer
      </button>
    </div>
    <div class="picker-tools">
      <label class="search">
        ${icon('loupe')}<span class="visually-hidden" data-libelle></span>
        <input type="search" data-chercher autocomplete="off" enterkeyhint="search">
      </label>
      <div class="order-switch" role="group" aria-label="Ordre">
        <button type="button" class="pick" data-ordre-choix="recent">Derniers utilisés</button>
        <button type="button" class="pick" data-ordre-choix="alpha">De A à Z</button>
      </div>
    </div>
    <div class="sheet-body picker-list" data-liste></div>`;
  document.body.append(d);
  return d;
}

/**
 * Ouvre la fenêtre de choix et renvoie l'identifiant choisi (ou null si fermée sans choisir).
 * @param {object} o
 * @param {string} o.title            « C'est quoi ? », « Pour qui ? »
 * @param {string} o.searchLabel      « Chercher une catégorie »
 * @param {string} o.orderKey         clé où l'ordre choisi est retenu
 * @param {object[]} o.items          éléments { id, name, color? }
 * @param {Map<string,string>} o.lastUsed
 * @param {{title: string, filter: (x) => boolean}[]} [o.groups]  groupes affichés (sinon un seul)
 * @param {string|null} o.selected
 * @param {string} o.emptyText        texte si la recherche ne trouve rien
 * @returns {Promise<string|null>}
 */
export function choose({ title, searchLabel, orderKey, items, lastUsed, groups, selected, emptyText }) {
  const d = dialogEl();
  const input = d.querySelector('[data-chercher]');
  const list = d.querySelector('[data-liste]');
  d.querySelector('#fenetre-choix-titre').textContent = title;
  d.querySelector('[data-libelle]').textContent = searchLabel;
  input.placeholder = searchLabel;
  input.value = '';
  let order = savedOrder(orderKey);

  const item = (x) => `<button type="button" class="picker-item" data-choix="${esc(x.id)}" aria-pressed="${x.id === selected}">
      <span class="picker-name">${x.color ? `<span class="swatch" data-color="${esc(x.color)}"></span>` : ''}${esc(x.name)}</span>
      ${x.id === selected ? `${icon('ok')}<span class="visually-hidden">(choisi)</span>` : ''}</button>`;
  const group = (t, xs) => (xs.length ? `${t ? `<h3 class="group-title">${t}</h3>` : ''}<div class="picker-group">${xs.map(item).join('')}</div>` : '');

  const draw = () => {
    for (const b of d.querySelectorAll('[data-ordre-choix]')) b.setAttribute('aria-pressed', String(b.dataset.ordreChoix === order));
    const q = input.value.trim();
    if (q) {
      const found = searchCategories(items, q);
      list.innerHTML = found.length ? group('', found) : `<p class="note">${esc(emptyText)}</p>`;
    } else {
      let html = '';
      if (order === 'recent') {
        html += group('Derniers utilisés', orderByUse(items.filter((x) => lastUsed.has(x.id)), 'recent', lastUsed).slice(0, RECENT_MAX));
      }
      for (const g of groups ?? [{ title: order === 'recent' ? 'Tous' : '', filter: () => true }]) {
        html += group(g.title, orderByUse(items.filter(g.filter), order, lastUsed));
      }
      list.innerHTML = html;
    }
    for (const el of list.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
  };

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
      else if (b.dataset.ordreChoix) {
        order = b.dataset.ordreChoix;
        try { localStorage.setItem(orderKey, order); } catch { /* sans gravité */ }
        draw();
      } else if (b.dataset.choix) {
        picked = b.dataset.choix;
        d.close();
      }
    };
    d.addEventListener('close', () => resolve(picked), { once: true });
  });
}

/** « C'est quoi ? » : les catégories du genre de l'opération d'abord. */
export function chooseCategory({ categories, lastUsed, type, selected }) {
  const names = { depense: 'Dépenses', recette: 'Rentrées' };
  const other = type === 'depense' ? 'recette' : 'depense';
  return choose({
    title: 'C’est quoi ?',
    searchLabel: 'Chercher une catégorie',
    orderKey: 'mon-budget.ordre-categories',
    items: categories,
    lastUsed,
    groups: [{ title: names[type], filter: (c) => c.type === type }, { title: names[other], filter: (c) => c.type === other }],
    selected,
    emptyText: 'Aucune catégorie ne correspond. Essayez un autre mot, ou ajoutez-la dans Réglages, « Mes catégories ».',
  });
}

/** « Pour qui ? » quand il y a beaucoup de personnes. */
export function choosePerson({ people, lastUsed, selected }) {
  return choose({
    title: 'Pour qui ?',
    searchLabel: 'Chercher une personne',
    orderKey: 'mon-budget.ordre-personnes',
    items: people,
    lastUsed,
    selected,
    emptyText: 'Personne ne correspond. Essayez un autre nom, ou ajoutez la personne dans Réglages, « Pour qui ».',
  });
}
