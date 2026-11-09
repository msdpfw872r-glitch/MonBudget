/**
 * operation.js — Fenêtre « Modifier l'opération » (depuis le Journal).
 *
 * Version : 0.7.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Pour qui ? C'est quoi ? Si l'opération avait été classée par une règle et qu'on la change,
 * l'app demande : « Changer aussi la règle ? » (CLAUDE.md § 4, règle 5).
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version.
 *   0.7.0  FRE (Fidag)  « Toujours classer » décoché d'office pour un texte générique.
 */

import { icon, esc, confirmer } from './ui.js';
import { chooseCategory, choosePerson } from './choix.js';
import { formatAmount, formatDateLong, displayName } from '../src/core/format.js';
import { classify, isGenericKey } from '../src/core/regles.js';
import { ReglageError } from '../src/core/reglages.js';

const PEOPLE_BUTTONS_MAX = 6;

function dialogEl() {
  let d = document.getElementById('fenetre-operation');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'fenetre-operation';
  d.className = 'sheet';
  d.setAttribute('aria-labelledby', 'fenetre-operation-titre');
  document.body.append(d);
  return d;
}

/**
 * Ouvre la fenêtre pour une opération.
 * @param {object} db
 * @param {object} tx
 * @param {{people: object[], categories: object[], accounts: Map, lastUsed: Map, lastUsedPerson: Map}} ctx
 * @returns {Promise<boolean>} vrai si l'opération a été modifiée
 */
export function editOperation(db, tx, ctx) {
  const d = dialogEl();
  const name = displayName(tx.description);
  const st = { personId: tx.personId ?? ctx.accounts.get(tx.accountId)?.personId ?? null, categoryId: tx.categoryId ?? null, remember: tx.status !== 'classee' && !isGenericKey(tx.merchantKey) };
  const rule = Boolean(tx.ruleId);

  const draw = () => {
    const chosen = ctx.categories.find((c) => c.id === st.categoryId);
    const person = ctx.people.find((p) => p.id === st.personId);
    const people = ctx.people.length > PEOPLE_BUTTONS_MAX
      ? `<button type="button" class="tag-choice${person ? ' chosen' : ''}" data-ouvrir-personnes>${person
        ? `<span class="swatch" data-color="${esc(person.color)}"></span><span class="tag-name">${esc(person.name)}</span><span class="tag-change">Changer</span>`
        : `${icon('loupe')}<span class="tag-name">Choisir une personne…</span>`}</button>`
      : `<div class="picks picks-people">${ctx.people.map((p) => `<button type="button" class="pick pick-person" data-color="${esc(p.color)}"
          data-person="${esc(p.id)}" aria-pressed="${p.id === st.personId}">${esc(p.name)}</button>`).join('')}</div>`;
    d.innerHTML = `<div class="sheet-head">
        <h2 id="fenetre-operation-titre">${tx.status === 'classee' ? 'Modifier l’opération' : 'Trier l’opération'}</h2>
        <button type="button" class="btn btn-secondary" data-fermer>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Fermer
        </button>
      </div>
      <div class="sheet-body">
        <section class="card">
          <div class="sort-head">
            <div class="row-text">
              <span class="row-sub">${esc(formatDateLong(tx.date, { capital: true }))} · ${esc(ctx.accounts.get(tx.accountId)?.name ?? '')}</span>
              <span class="sort-name">${esc(name)}</span>
            </div>
            <span class="sort-amount ${tx.amount < 0 ? '' : 'positive'}">${formatAmount(tx.amount)}</span>
          </div>
          <p class="row-sub">Texte de la banque : ${esc(tx.description)}</p>
          ${rule ? '<p class="row-sub">Classée toute seule par une règle retenue.</p>' : ''}
          <h2>Pour qui ?</h2>
          ${people}
          <h2>C’est quoi ?</h2>
          <button type="button" class="tag-choice${chosen ? ' chosen' : ''}" data-ouvrir-categories>
            ${chosen ? `${icon('ok')}<span class="tag-name">${esc(chosen.name)}</span><span class="tag-change">Changer</span>`
              : `${icon('loupe')}<span class="tag-name">Choisir une catégorie…</span>`}
          </button>
          ${rule ? '' : `<label class="choice choice-check remember">
            <input type="checkbox" data-remember${st.remember ? ' checked' : ''}>
            <span>Toujours classer <strong>${esc(name)}</strong> comme ça</span></label>`}
          <p class="form-error" role="alert" tabindex="-1" hidden></p>
          <button type="button" class="btn btn-primary btn-wide" data-enregistrer>Enregistrer</button>
        </section>
      </div>`;
    for (const el of d.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
    d.querySelector('[data-remember]')?.addEventListener('change', (e) => { st.remember = e.target.checked; });
  };

  draw();
  d.showModal();

  return new Promise((resolve) => {
    let saved = false;
    d.onclick = async (e) => {
      if (e.target === d) { d.close(); return; }
      const b = e.target.closest('button');
      if (!b) return;
      if ('fermer' in b.dataset) d.close();
      else if (b.dataset.person) { st.personId = b.dataset.person; draw(); }
      else if ('ouvrirPersonnes' in b.dataset) {
        const id = await choosePerson({ people: ctx.people, lastUsed: ctx.lastUsedPerson, selected: st.personId });
        if (id) { st.personId = id; draw(); }
      } else if ('ouvrirCategories' in b.dataset) {
        const id = await chooseCategory({ categories: ctx.categories, lastUsed: ctx.lastUsed, type: tx.amount < 0 ? 'depense' : 'recette', selected: st.categoryId });
        if (id) { st.categoryId = id; draw(); }
      } else if ('enregistrer' in b.dataset) {
        const err = d.querySelector('.form-error');
        try {
          const changed = st.personId !== tx.personId || st.categoryId !== tx.categoryId;
          let updateRule = false;
          if (rule && changed) {
            updateRule = await confirmer({
              titre: 'Changer aussi la règle ?',
              message: `L’app classe toute seule « ${name} ». Voulez-vous qu’elle classe aussi les prochaines opérations de ce commerce comme ça ?`,
              ok: 'Oui, la règle aussi',
              non: 'Non, seulement celle-ci',
            });
          }
          if (changed || tx.status !== 'classee' || (!rule && st.remember)) {
            await classify(db, tx.id, { personId: st.personId, categoryId: st.categoryId, remember: !rule && st.remember, updateRule });
            saved = true;
          }
          d.close();
        } catch (ex) {
          err.textContent = ex instanceof ReglageError ? ex.message : 'L’enregistrement n’a pas marché. Réessayez.';
          err.hidden = false;
          err.focus();
        }
      }
    };
    d.addEventListener('close', () => resolve(saved), { once: true });
  });
}
