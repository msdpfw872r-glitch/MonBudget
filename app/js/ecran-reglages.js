/**
 * ecran-reglages.js — Écrans Réglages : vue d'ensemble, Pour qui, Mes comptes, Mes catégories.
 *
 * Version : 0.4.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Adresses : #/reglages, #/reglages/personnes[/id|/nouveau], #/reglages/comptes[/id|/nouveau],
 *            #/reglages/categories[/id|/nouveau], #/reglages/regles[/id].
 * Chaque écran renvoie { title, parent, render(root) } ; main.js l'affiche en fenêtre (iPad)
 * ou en plein écran (iPhone).
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version.
 *   0.4.0  FRE (Fidag)  Cartes (à qui, facture prélevée sur, numéros reconnus), règles retenues
 *                       modifiables et supprimables, accès aux factures de carte.
 */

import { APP_VERSION } from './version.js';
import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import * as R from '../src/core/reglages.js';
import { saveRule, deleteRule } from '../src/core/regles.js';
import { shortRef } from '../src/core/import.js';

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
      ${o.swatch ? `<span class="swatch" data-color="${esc(o.color ?? o.value)}"></span>` : ''}
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
          ${row({ href: '#/factures', title: 'Factures de carte', sub: 'Rattacher les achats des cartes à la facture' })}
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
      const db = await getDb();
      const [rules, people, cats] = await Promise.all([db.getAll('rules'), db.getAll('people'), db.getAll('categories')]);
      const P = new Map(people.map((p) => [p.id, p]));
      const C = new Map(cats.map((c) => [c.id, c]));
      rules.sort((a, b) => a.merchantKey.localeCompare(b.merchantKey, 'fr'));
      root.innerHTML = rules.length
        ? `<p class="note">Quand une opération contient ces mots, l’app la classe toute seule.</p>
           <section class="card list">${rules.map((r) => {
             const p = P.get(r.personId);
             return row({ href: `#/reglages/regles/${encodeURIComponent(r.id)}`, title: esc(r.merchantKey),
               sub: `${esc(C.get(r.categoryId)?.name ?? 'Catégorie supprimée')} · ${p ? personTag(p) : 'Personne supprimée'}` });
           }).join('')}</section>`
        : `<section class="card"><p class="note">Quand vous trierez une opération, l’app retiendra votre choix pour ce commerce.
            Les règles apparaîtront ici, et vous pourrez les modifier ou les supprimer.</p></section>`;
      paintTags(root);
    },
  };
}

function regle(id) {
  return {
    title: 'Modifier la règle',
    parent: '#/reglages/regles',
    async render(root) {
      const db = await getDb();
      const r = await db.get('rules', id);
      if (!r) { go('#/reglages/regles'); return; }
      const people = await R.listPeople(db);
      const cats = await R.listCategories(db, { archived: false });
      const options = (type) => cats.filter((c) => c.type === type)
        .map((c) => `<option value="${esc(c.id)}"${c.id === r.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
      root.innerHTML = `<form class="card form" novalidate>
          <label class="field"><span>Reconnaître les opérations qui contiennent</span>
            <input name="merchantKey" value="${esc(r.merchantKey)}" maxlength="60" autocomplete="off" autocapitalize="characters" required>
            <span class="row-sub">Par exemple « MIGROS » reconnaît tous les magasins Migros.</span></label>
          <fieldset class="field"><legend>Pour qui ?</legend>
            <div class="choices">${radios('personId', people.map((p) => ({ value: p.id, label: p.name, swatch: true, color: p.color })), r.personId)}</div>
          </fieldset>
          <label class="field"><span>C’est quoi ?</span>
            <select name="categoryId" required>
              <optgroup label="Dépenses">${options('depense')}</optgroup>
              <optgroup label="Rentrées">${options('recette')}</optgroup>
            </select></label>
          <p class="row-sub">Utilisée ${r.hits ?? 0} fois.</p>
          ${errorBox}
          <button class="btn btn-primary btn-wide" type="submit">Enregistrer</button>
        </form>
        <button type="button" class="btn btn-danger-outline btn-wide" data-supprimer>Supprimer cette règle</button>`;
      paintTags(root);
      bindForm(root, {
        back: '#/reglages/regles',
        onSave: (f) => saveRule(db, id, { merchantKey: f.get('merchantKey'), personId: f.get('personId'), categoryId: f.get('categoryId') }),
      });
      root.querySelector('[data-supprimer]').addEventListener('click', async () => {
        const ok = await confirmer({ titre: 'Supprimer cette règle ?', message: 'Les opérations déjà classées ne changent pas. Les prochaines seront à trier.', ok: 'Supprimer', danger: true });
        if (ok) runAction(root, () => deleteRule(db, id), '#/reglages/regles');
      });
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
      const names = new Map(accounts.map((a) => [a.id, a.name]));
      root.innerHTML = `
        <p class="note">Les comptes et cartes dont vous importez les relevés.</p>
        <section class="card list">
          ${accounts.map((a) => row({ href: `#/reglages/comptes/${encodeURIComponent(a.id)}`, title: esc(a.name),
            sub: `${kindLabel(a.kind)} · fichier ${esc(formatLabel(a.importFormat))}${a.billPaidFrom ? ` · facture payée par ${esc(names.get(a.billPaidFrom) ?? '?')}` : ''}` })).join('') || '<p class="note pad">Aucun compte.</p>'}
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
      const a = isNew ? { name: '', kind: 'compte', importFormat: 'ubs-transactions-xlsx', personId: null, billPaidFrom: null, bankRefs: [] } : await db.get('accounts', id);
      if (!a) { go('#/reglages/comptes'); return; }
      const formats = R.IMPORT_FORMATS.map((f) => ({ value: f.id, label: f.available ? f.label : `${f.label} (bientôt)` }));
      const people = await R.listPeople(db);
      const payers = (await R.listAccounts(db)).filter((x) => x.kind === 'compte' && x.id !== id);
      const refs = a.bankRefs ?? [];
      root.innerHTML = `<form class="card form" novalidate>
          <label class="field"><span>Nom</span>
            <input name="name" value="${esc(a.name)}" maxlength="40" autocomplete="off" required></label>
          <fieldset class="field"><legend>Genre</legend>
            <div class="choices">${radios('kind', R.ACCOUNT_KINDS.map((k) => ({ value: k.id, label: k.label })), a.kind)}</div>
          </fieldset>
          <fieldset class="field"><legend>Fichier de quelle banque ?</legend>
            <div class="choices">${radios('importFormat', formats, a.importFormat)}</div>
          </fieldset>
          <div class="card-fields" data-carte-champs${a.kind === 'carte' ? '' : ' hidden'}>
            <fieldset class="field"><legend>À qui est la carte ?</legend>
              <p class="row-sub">Cette personne sera proposée d’avance pour trier ses achats.</p>
              <div class="choices">${radios('personId', [{ value: '', label: 'Personne en particulier (carte commune)' }]
                .concat(people.map((p) => ({ value: p.id, label: p.name, swatch: true, color: p.color }))), a.personId ?? '')}</div>
            </fieldset>
            <fieldset class="field"><legend>La facture est prélevée sur</legend>
              <div class="choices">${radios('billPaidFrom', [{ value: '', label: 'Aucun de mes comptes' }]
                .concat(payers.map((x) => ({ value: x.id, label: x.name }))), a.billPaidFrom ?? '')}</div>
            </fieldset>
          </div>
          ${refs.length ? `<div class="field"><span>Numéros reconnus dans les fichiers</span>
            <div class="refs">${refs.map((r) => `<span class="ref">${esc(shortRef(r))}
              <button type="button" class="btn btn-secondary btn-small" data-oublier="${esc(r)}">Oublier</button></span>`).join('')}</div></div>` : ''}
          ${errorBox}
          <button class="btn btn-primary btn-wide" type="submit">Enregistrer</button>
        </form>
        ${isNew ? '' : `<button type="button" class="btn btn-danger-outline btn-wide" data-supprimer>Supprimer ${esc(a.name)}</button>`}`;
      paintTags(root);
      bindForm(root, {
        back: '#/reglages/comptes',
        onSave: (f) => R.saveAccount(db, { id: isNew ? undefined : id, name: f.get('name'), kind: f.get('kind'), importFormat: f.get('importFormat'),
          personId: f.get('personId') || null, billPaidFrom: f.get('billPaidFrom') || null }),
      });
      root.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener('change', () => {
        root.querySelector('[data-carte-champs]').hidden = root.querySelector('input[name="kind"]:checked')?.value !== 'carte';
      }));
      root.querySelectorAll('[data-oublier]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmer({ titre: `Oublier ${shortRef(b.dataset.oublier)} ?`, message: 'Au prochain import, l’app vous redemandera à quel compte il appartient.', ok: 'Oublier', danger: true });
        if (ok) { await R.removeBankRef(db, id, b.dataset.oublier); this.render(root); }
      }));
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
    case 'regles': return id ? regle(id) : regles();
    default: return accueilReglages();
  }
}
