/**
 * ecran-reglages.js — Écrans Réglages : vue d'ensemble, Pour qui, Mes comptes, Mes catégories.
 *
 * Version : 0.3.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Adresses : #/reglages, #/reglages/personnes[/id|/nouveau], #/reglages/comptes[/id|/nouveau],
 *            #/reglages/categories[/id|/nouveau], #/reglages/regles.
 * Chaque écran renvoie { title, parent, render(root) } ; main.js l'affiche en fenêtre (iPad)
 * ou en plein écran (iPhone).
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version.
 */

import { APP_VERSION } from './version.js';
import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import * as R from '../src/core/reglages.js';

const go = (hash) => { location.hash = hash; };

function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

function row({ href, title, sub = '', badge = '' }) {
  return `<a class="row" href="${href}">
    <span class="row-text"><span class="row-title">${title}${badge}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>
    ${icon('suite')}
  </a>`;
}

function personTag(p) {
  return `<span class="tag" data-color="${esc(p.color)}">${esc(p.name)}</span>`;
}

/** Applique les couleurs des pastilles (pas de style en ligne : bloqué par la CSP). */
function paintTags(root) {
  for (const el of root.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
}

/** Branche un formulaire : affiche l'erreur en mots simples, sinon revient à la liste. */
function bindForm(root, { onSave, back }) {
  const form = root.querySelector('form');
  const err = root.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      await onSave(new FormData(form));
      go(back);
    } catch (ex) {
      err.textContent = ex instanceof R.ReglageError ? ex.message : 'L’enregistrement n’a pas marché. Réessayez.';
      err.hidden = false;
      err.focus();
    }
  });
}

async function runAction(root, fn, back) {
  const err = root.querySelector('.form-error');
  try {
    await fn();
    if (back) go(back);
  } catch (ex) {
    err.textContent = ex instanceof R.ReglageError ? ex.message : 'Cela n’a pas marché. Réessayez.';
    err.hidden = false;
    err.focus();
  }
}

const errorBox = '<p class="form-error" role="alert" tabindex="-1" hidden></p>';

function radios(name, options, checked) {
  return options.map((o) => `<label class="choice">
      <input type="radio" name="${name}" value="${esc(o.value)}"${o.value === checked ? ' checked' : ''} required>
      ${o.swatch ? `<span class="swatch" data-color="${esc(o.value)}"></span>` : ''}
      <span>${esc(o.label)}</span>
    </label>`).join('');
}

/* ---------- Vue d'ensemble ---------- */

function accueilReglages() {
  return {
    title: 'Réglages',
    parent: null,
    async render(root) {
      const db = await getDb();
      const o = await R.overview(db);
      root.innerHTML = `
        <section class="card card-accent">
          <div class="card-line">
            <span class="round-icon">${icon('sauvegarde')}</span>
            <span class="row-text"><span class="row-title">Sauvegarde</span>
              <span class="row-sub">Arrive dans une prochaine version.</span></span>
          </div>
          <button type="button" class="btn btn-primary btn-wide" disabled>Sauvegarder maintenant</button>
        </section>
        <section class="card list">
          ${row({ href: '#/reglages/regles', title: 'Règles retenues',
            sub: o.rulesCount ? plural(o.rulesCount, 'commerce reconnu', 'commerces reconnus') : 'Aucune pour l’instant' })}
          ${row({ href: '#/reglages/categories', title: 'Mes catégories', sub: plural(o.categoriesCount, 'catégorie', 'catégories') })}
          ${row({ href: '#/reglages/personnes', title: 'Pour qui', sub: esc(o.people.map((p) => p.name).join(', ')) })}
          ${row({ href: '#/reglages/comptes', title: 'Mes comptes', sub: esc(o.accounts.map((a) => a.name).join(', ')) || 'Aucun compte' })}
        </section>
        <p class="footnote">Mon Budget · version ${APP_VERSION}</p>`;
    },
  };
}

function regles() {
  return {
    title: 'Règles retenues',
    parent: '#/reglages',
    async render(root) {
      root.innerHTML = `<section class="card">
        <p class="note">Quand vous trierez une opération, l’app retiendra votre choix pour ce commerce.
        Les règles apparaîtront ici, et vous pourrez les modifier ou les supprimer.</p></section>`;
    },
  };
}

/* ---------- Pour qui (personnes) ---------- */

function personnes() {
  return {
    title: 'Pour qui',
    parent: '#/reglages',
    async render(root) {
      const people = await R.listPeople(await getDb());
      root.innerHTML = `
        <p class="note">Les personnes pour qui vous classez les dépenses et les rentrées.</p>
        <section class="card list">
          ${people.map((p) => row({ href: `#/reglages/personnes/${encodeURIComponent(p.id)}`, title: personTag(p) })).join('')}
        </section>
        <a class="btn btn-secondary btn-wide" href="#/reglages/personnes/nouveau">${icon('plus')}Ajouter une personne</a>`;
      paintTags(root);
    },
  };
}

function personne(id) {
  const isNew = id === 'nouveau';
  return {
    title: isNew ? 'Nouvelle personne' : 'Modifier la personne',
    parent: '#/reglages/personnes',
    async render(root) {
      const db = await getDb();
      const p = isNew ? { name: '', color: R.PERSON_COLORS[3].value } : await db.get('people', id);
      if (!p) { go('#/reglages/personnes'); return; }
      root.innerHTML = `<form class="card form" novalidate>
          <label class="field"><span>Nom</span>
            <input name="name" value="${esc(p.name)}" maxlength="40" autocomplete="off" required></label>
          <fieldset class="field"><legend>Couleur</legend>
            <div class="choices">${radios('color', R.PERSON_COLORS.map((c) => ({ ...c, swatch: true })), p.color)}</div>
          </fieldset>
          ${errorBox}
          <button class="btn btn-primary btn-wide" type="submit">Enregistrer</button>
        </form>
        ${isNew ? '' : `<button type="button" class="btn btn-danger-outline btn-wide" data-supprimer>Supprimer ${esc(p.name)}</button>`}`;
      paintTags(root);
      bindForm(root, {
        back: '#/reglages/personnes',
        onSave: (f) => R.savePerson(db, { id: isNew ? undefined : id, name: f.get('name'), color: f.get('color') }),
      });
      root.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        const ok = await confirmer({ titre: `Supprimer ${p.name} ?`, message: 'Cette personne ne sera plus proposée pour trier.', ok: 'Supprimer', danger: true });
        if (ok) runAction(root, () => R.deletePerson(db, id), '#/reglages/personnes');
      });
    },
  };
}

/* ---------- Mes comptes ---------- */

const formatLabel = (id) => R.IMPORT_FORMATS.find((f) => f.id === id)?.label ?? 'Banque inconnue';
const kindLabel = (id) => R.ACCOUNT_KINDS.find((k) => k.id === id)?.label ?? '';

function comptes() {
  return {
    title: 'Mes comptes',
    parent: '#/reglages',
    async render(root) {
      const accounts = await R.listAccounts(await getDb());
      root.innerHTML = `
        <p class="note">Les comptes et cartes dont vous importez les relevés.</p>
        <section class="card list">
          ${accounts.map((a) => row({ href: `#/reglages/comptes/${encodeURIComponent(a.id)}`, title: esc(a.name),
            sub: `${kindLabel(a.kind)} · fichier ${esc(formatLabel(a.importFormat))}` })).join('') || '<p class="note pad">Aucun compte.</p>'}
        </section>
        <a class="btn btn-secondary btn-wide" href="#/reglages/comptes/nouveau">${icon('plus')}Ajouter un compte</a>`;
    },
  };
}

function compte(id) {
  const isNew = id === 'nouveau';
  return {
    title: isNew ? 'Nouveau compte' : 'Modifier le compte',
    parent: '#/reglages/comptes',
    async render(root) {
      const db = await getDb();
      const a = isNew ? { name: '', kind: 'compte', importFormat: 'ubs-transactions-xlsx' } : await db.get('accounts', id);
      if (!a) { go('#/reglages/comptes'); return; }
      const formats = R.IMPORT_FORMATS.map((f) => ({ value: f.id, label: f.available ? f.label : `${f.label} (bientôt)` }));
      root.innerHTML = `<form class="card form" novalidate>
          <label class="field"><span>Nom</span>
            <input name="name" value="${esc(a.name)}" maxlength="40" autocomplete="off" required></label>
          <fieldset class="field"><legend>Genre</legend>
            <div class="choices">${radios('kind', R.ACCOUNT_KINDS.map((k) => ({ value: k.id, label: k.label })), a.kind)}</div>
          </fieldset>
          <fieldset class="field"><legend>Fichier de quelle banque ?</legend>
            <div class="choices">${radios('importFormat', formats, a.importFormat)}</div>
          </fieldset>
          ${errorBox}
          <button class="btn btn-primary btn-wide" type="submit">Enregistrer</button>
        </form>
        ${isNew ? '' : `<button type="button" class="btn btn-danger-outline btn-wide" data-supprimer>Supprimer ${esc(a.name)}</button>`}`;
      bindForm(root, {
        back: '#/reglages/comptes',
        onSave: (f) => R.saveAccount(db, { id: isNew ? undefined : id, name: f.get('name'), kind: f.get('kind'), importFormat: f.get('importFormat') }),
      });
      root.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        const ok = await confirmer({ titre: `Supprimer ${a.name} ?`, message: 'Ce compte ne sera plus proposé pour importer.', ok: 'Supprimer', danger: true });
        if (ok) runAction(root, () => R.deleteAccount(db, id), '#/reglages/comptes');
      });
    },
  };
}

/* ---------- Mes catégories ---------- */

function categories() {
  return {
    title: 'Mes catégories',
    parent: '#/reglages',
    async render(root) {
      const all = await R.listCategories(await getDb());
      const line = (c) => row({ href: `#/reglages/categories/${encodeURIComponent(c.id)}`, title: esc(c.name),
        sub: c.excludeFromTotals ? 'Pas comptée dans les totaux' : '' });
      const group = (title, list) => (list.length ? `<h2 class="group-title">${title}</h2>
        <section class="card list">${list.map(line).join('')}</section>` : '');
      root.innerHTML = `
        <a class="btn btn-secondary btn-wide" href="#/reglages/categories/nouveau">${icon('plus')}Ajouter une catégorie</a>
        ${group('Dépenses', all.filter((c) => !c.archived && c.type === 'depense'))}
        ${group('Rentrées', all.filter((c) => !c.archived && c.type === 'recette'))}
        ${group('Mises de côté (plus proposées pour trier)', all.filter((c) => c.archived))}`;
    },
  };
}

function categorie(id) {
  const isNew = id === 'nouveau';
  return {
    title: isNew ? 'Nouvelle catégorie' : 'Modifier la catégorie',
    parent: '#/reglages/categories',
    async render(root) {
      const db = await getDb();
      const c = isNew ? { name: '', type: 'depense', excludeFromTotals: false, archived: false } : await db.get('categories', id);
      if (!c) { go('#/reglages/categories'); return; }
      root.innerHTML = `<form class="card form" novalidate>
          <label class="field"><span>Nom</span>
            <input name="name" value="${esc(c.name)}" maxlength="40" autocomplete="off" required></label>
          <fieldset class="field"><legend>C’est une…</legend>
            <div class="choices">${radios('type', [{ value: 'depense', label: 'Dépense' }, { value: 'recette', label: 'Rentrée' }], c.type)}</div>
          </fieldset>
          <label class="choice choice-check">
            <input type="checkbox" name="excludeFromTotals"${c.excludeFromTotals ? ' checked' : ''}>
            <span>Ne pas compter dans les totaux<br><span class="row-sub">Pour les virements entre vos comptes, l’épargne, le paiement de la facture de carte.</span></span>
          </label>
          ${errorBox}
          <button class="btn btn-primary btn-wide" type="submit">Enregistrer</button>
        </form>
        ${isNew ? '' : `<div class="actions">
          <button type="button" class="btn btn-secondary btn-wide" data-archiver>${c.archived ? 'Proposer à nouveau pour trier' : 'Mettre de côté (ne plus proposer)'}</button>
          <button type="button" class="btn btn-danger-outline btn-wide" data-supprimer>Supprimer ${esc(c.name)}</button>
        </div>`}`;
      bindForm(root, {
        back: '#/reglages/categories',
        onSave: (f) => R.saveCategory(db, { id: isNew ? undefined : id, name: f.get('name'), type: f.get('type'),
          excludeFromTotals: f.get('excludeFromTotals') === 'on' }),
      });
      root.querySelector('[data-archiver]')?.addEventListener('click', () =>
        runAction(root, () => R.setCategoryArchived(db, id, !c.archived), '#/reglages/categories'));
      root.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        const ok = await confirmer({ titre: `Supprimer ${c.name} ?`, message: 'La catégorie disparaîtra de la liste.', ok: 'Supprimer', danger: true });
        if (ok) runAction(root, () => R.deleteCategory(db, id), '#/reglages/categories');
      });
    },
  };
}

/* ---------- Aiguillage ---------- */

/** @param {string[]} path segments après « reglages » */
export function reglagesView(path) {
  const [section, id] = path.map(decodeURIComponent);
  switch (section) {
    case 'personnes': return id ? personne(id) : personnes();
    case 'comptes': return id ? compte(id) : comptes();
    case 'categories': return id ? categorie(id) : categories();
    case 'regles': return regles();
    default: return accueilReglages();
  }
}
