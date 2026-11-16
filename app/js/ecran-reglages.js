/**
 * ecran-reglages.js — Écrans Réglages : vue d'ensemble, Pour qui, Mes comptes, Mes catégories.
 *
 * Version : 0.23.0
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
 *   0.6.0  FRE (Fidag)  Carte « Sauvegarde » (sauvegarder, restaurer, guide Raccourcis).
 *   0.6.1  FRE (Fidag)  Question « Le fichier a-t-il bien été enregistré ? » après le menu Partager.
 *   0.8.6  FRE (Fidag)  Synchronisation entre les iPad (#/reglages/synchro).
 *   0.9.1  FRE (Fidag)  Synchronisation en haut des Réglages (visible sans défiler sur iPhone).
 *   0.10.2 FRE (Fidag)  « Compte et synchronisation » (#/reglages/compte) remplace l'ancien écran Synchronisation.
 *   0.11.0 FRE (Fidag)  Plus de carte « Sauvegarde » (synchronisation) : lignes Imports, Copie de sécurité,
 *                       Supprimer des données (#/reglages/imports, /copie, /supprimer).
 *   0.12.0 FRE (Fidag)  Mes catégories : « Remettre les catégories d'exemple » s'il en manque.
 *   0.13.0 FRE (Fidag)  Mes catégories de A à Z, groupes qu'on peut fermer ; règle modifiée : « Reclasser les
 *                       anciennes opérations ? » (Reclasser / Laisser comme ça).
 *   0.17.0 FRE (Fidag)  Règles retenues : recherche, filtres Pour qui / Catégorie, ordre ; question « Reclasser … ? »
 *                       commune (aussi les opérations triées à la main, au choix).
 *   0.21.0 FRE (Fidag)  « Relancer le classement » (#/reglages/relancer).
 *   0.22.0 FRE (Fidag)  Règle « pour qui : la titulaire de la carte utilisée ».
 *   0.23.0 FRE (Fidag)  Règles retenues : « Contrats détectés » (même créancier, références différentes) → une règle par contrat.
 */

import { APP_VERSION } from './version.js';
import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import * as R from '../src/core/reglages.js';
import { saveRule, deleteRule, filterRules, sortRules, RULE_ORDERS, CARD_HOLDER, CARD_HOLDER_LABEL } from '../src/core/regles.js';
import { askReclassify } from './reclasser.js';
import { chooseOption } from './choix.js';
import { filterChip } from './mois.js';
import { shortRef } from '../src/core/import.js';
import { restaurerView, raccourciView } from './ecran-sauvegarde.js';
import { compteView, compteRow } from './ecran-compte.js';
import { supprimerView, importsView, copieView, copieRow } from './ecran-supprimer.js';
import { relancerView } from './ecran-relancer.js';
import { contractsToSetUp, saveContractRule } from '../src/core/contrats.js';
import { choose } from './choix.js';
import { formatCHF, formatDateShort } from '../src/core/format.js';

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
        <section class="card list">${await compteRow()}</section>
        <section class="card list">
          ${row({ href: '#/reglages/regles', title: 'Règles retenues',
            sub: o.rulesCount ? plural(o.rulesCount, 'commerce reconnu', 'commerces reconnus') : 'Aucune pour l’instant' })}
          ${row({ href: '#/reglages/categories', title: 'Mes catégories', sub: plural(o.categoriesCount, 'catégorie', 'catégories') })}
          ${row({ href: '#/reglages/personnes', title: 'Pour qui', sub: esc(o.people.map((p) => p.name).join(', ')) })}
          ${row({ href: '#/reglages/comptes', title: 'Mes comptes', sub: esc(o.accounts.map((a) => a.name).join(', ')) || 'Aucun compte' })}
          ${row({ href: '#/factures', title: 'Factures de carte', sub: 'Rattacher les achats des cartes à la facture' })}
          ${row({ href: '#/reglages/imports', title: 'Imports', sub: plural(await db.count('imports'), 'fichier importé', 'fichiers importés') })}
          ${row({ href: '#/reglages/relancer', title: 'Relancer le classement', sub: 'Bonnes cartes, règles, factures — sans réimporter' })}
        </section>
        <section class="card list">
          ${await copieRow()}
          <a class="row row-danger" href="#/reglages/supprimer"><span class="row-text"><span class="row-title">Supprimer des données</span>
            <span class="row-sub">Imports, opérations, tri, règles…</span></span>${icon('suite')}</a>
        </section>
        <p class="footnote">Mon Budget · version ${APP_VERSION}</p>`;
    },
  };
}

// Filtres de la liste des règles (gardés tant que l'app est ouverte).
const ruleFilters = { query: '', personId: null, categoryId: null, order: 'alpha' };

function regles() {
  return {
    title: 'Règles retenues',
    parent: '#/reglages',
    async render(root) {
      const db = await getDb();
      const [rules, people, cats] = await Promise.all([db.getAll('rules'), db.getAll('people'), db.getAll('categories')]);
      const P = new Map(people.map((p) => [p.id, p]));
      const C = new Map(cats.map((c) => [c.id, c]));
      const contracts = await contractsToSetUp(db);
      const contractsHtml = contracts.map((c, ci) => `<section class="card contract-card">
          <h2>${esc(c.name)} : ${c.groups.length} contrats détectés</h2>
          <p class="note">Même créancier, mais des paiements en parallèle avec des références différentes. Une règle par contrat permet
          de les classer différemment${c.groups[0].general ? ` (aujourd’hui, la règle « ${esc(c.merchantKey)} » les classe tous pareil)` : ''}.</p>
          <div class="list">${c.groups.map((g, gi) => {
            const avg = g.items.reduce((x, t) => x + Math.abs(t.amount), 0) / g.items.length;
            const last = g.items.map((t) => t.date).sort().at(-1);
            const rr = g.rule;
            return `<div class="row row-static">
              <span class="row-text"><span class="row-title">Contrat ${esc(g.label)}</span>
                <span class="row-sub">${g.items.length} paiements · en moyenne ${formatCHF(avg)} · dernier le ${esc(formatDateShort(last))}</span>
                ${rr ? `<span class="row-sub">${icon('ok')} ${esc(C.get(rr.categoryId)?.name ?? '')} · ${rr.personId === CARD_HOLDER ? CARD_HOLDER_LABEL : esc(P.get(rr.personId)?.name ?? '')}</span>` : ''}</span>
              <button type="button" class="btn btn-${rr ? 'secondary' : 'primary'} btn-small" data-contrat="${ci}:${gi}">${rr ? 'Changer' : 'Pour qui, quoi ?'}</button>
            </div>`;
          }).join('')}</div>
        </section>`).join('');
      // Contrat détecté : pour qui, quoi → règle du contrat, puis « Reclasser les opérations ? ».
      const render = () => this.render(root);
      const onContract = async (b) => {
          const [ci, gi] = b.dataset.contrat.split(':').map(Number);
          const c = contracts[ci];
          const g = c.groups[gi];
          const base = g.rule ?? g.general;
          const personId = await chooseOption({ title: `Contrat ${g.label} : pour qui ?`, selected: base?.personId ?? null,
            options: people.map((p) => ({ id: p.id, name: p.name, color: p.color })) });
          if (!personId) return;
          const categoryId = await choose({ title: `Contrat ${g.label} : c’est quoi ?`, searchLabel: 'Chercher une catégorie', orderKey: 'mon-budget.ordre-categories',
            items: cats.filter((x) => !x.archived), selected: base?.categoryId ?? null,
            groups: [{ title: 'Dépenses', filter: (x) => x.type === 'depense' }, { title: 'Rentrées', filter: (x) => x.type === 'recette' }],
            emptyText: 'Aucune catégorie ne correspond. Essayez un autre mot.' });
          if (!categoryId) return;
          const rule = await saveContractRule(db, { merchantKey: c.merchantKey, prefix: g.prefix, label: g.label, personId, categoryId });
          await askReclassify(db, rule.id);
          await render();
      };
      if (!rules.length) {
        root.onclick = async (e) => { const b = e.target.closest('[data-contrat]'); if (b) await onContract(b); };
        root.innerHTML = `${contractsHtml}<section class="card"><p class="note">Quand vous trierez une opération, l’app retiendra votre choix pour ce commerce.
            Les règles apparaîtront ici, et vous pourrez les modifier ou les supprimer.</p></section>`;
        return;
      }
      const active = () => Boolean(ruleFilters.query.trim() || ruleFilters.personId || ruleFilters.categoryId);
      const drawList = () => {
        const list = sortRules(filterRules(rules, ruleFilters, { categoriesById: C, peopleById: P }), ruleFilters.order);
        root.querySelector('[data-regles]').innerHTML = `<p class="note">${list.length === rules.length
            ? `${rules.length} règle${rules.length > 1 ? 's' : ''}. Quand une opération contient ces mots, l’app la classe toute seule.`
            : `${list.length} règle${list.length > 1 ? 's' : ''} sur ${rules.length}.`}</p>
          ${list.length ? `<section class="card list">${list.map((r) => {
            const p = P.get(r.personId);
            return row({ href: `#/reglages/regles/${encodeURIComponent(r.id)}`, title: `${esc(r.merchantKey)}${r.refPrefix ? ` · contrat ${esc(r.contractLabel ?? '')}` : ''}`,
              sub: `${esc(C.get(r.categoryId)?.name ?? 'Catégorie supprimée')} · ${r.personId === CARD_HOLDER ? `<span class="tag">${CARD_HOLDER_LABEL}</span>` : p ? personTag(p) : 'Personne supprimée'} · utilisée ${r.hits ?? 0} fois` });
          }).join('')}</section>` : '<section class="card"><p class="note">Aucune règle ne correspond. Essayez un autre mot ou touchez « Effacer les filtres ».</p></section>'}`;
        paintTags(root);
      };
      const draw = () => {
        const who = ruleFilters.personId === CARD_HOLDER ? { name: CARD_HOLDER_LABEL } : P.get(ruleFilters.personId);
        const cat = C.get(ruleFilters.categoryId);
        root.innerHTML = `${contractsHtml}<div class="filter-bar">
            <div class="filter-search">
              <label class="search">${icon('loupe')}<span class="visually-hidden">Chercher une règle</span>
                <input type="search" data-chercher-regle value="${esc(ruleFilters.query)}" placeholder="Chercher un commerce, une catégorie…" autocomplete="off" enterkeyhint="search"></label>
              ${active() ? '<button type="button" class="btn btn-secondary btn-small" data-effacer>Effacer les filtres</button>' : ''}
            </div>
            <div class="fchips fchips-3">
              ${filterChip({ attr: 'data-filtre-qui', label: 'Pour qui', value: who ? who.name : 'Tout le monde', active: Boolean(who) })}
              ${filterChip({ attr: 'data-filtre-categorie', label: 'Catégorie', value: cat ? cat.name : 'Toutes', active: Boolean(cat) })}
              ${filterChip({ attr: 'data-filtre-ordre', label: 'Ordre', value: RULE_ORDERS.find((o) => o.id === ruleFilters.order).short })}
            </div>
          </div>
          <div class="stack" data-regles></div>`;
        drawList();
        const input = root.querySelector('[data-chercher-regle]');
        input.addEventListener('input', () => {
          const had = active();
          ruleFilters.query = input.value;
          if (had !== active()) { draw(); root.querySelector('[data-chercher-regle]').focus(); } else drawList();
        });
      };
      draw();
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.contrat) { await onContract(b); return; }
        if ('filtreQui' in b.dataset) {
          const id = await chooseOption({ title: 'Pour qui ?', selected: ruleFilters.personId ?? '__tous',
            options: [{ id: '__tous', name: 'Tout le monde' }, ...people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
              { id: CARD_HOLDER, name: CARD_HOLDER_LABEL }] });
          if (id) { ruleFilters.personId = id === '__tous' ? null : id; draw(); }
        } else if ('filtreCategorie' in b.dataset) {
          const used = cats.filter((c) => rules.some((r) => r.categoryId === c.id));
          const id = await chooseOption({ title: 'Quelle catégorie ?', selected: ruleFilters.categoryId ?? '__toutes',
            options: [{ id: '__toutes', name: 'Toutes les catégories' },
              ...used.sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => ({ id: c.id, name: c.name,
                sub: `${rules.filter((r) => r.categoryId === c.id).length} règle(s)` }))] });
          if (id) { ruleFilters.categoryId = id === '__toutes' ? null : id; draw(); }
        } else if ('filtreOrdre' in b.dataset) {
          const id = await chooseOption({ title: 'Dans quel ordre ?', selected: ruleFilters.order, options: RULE_ORDERS.map((o) => ({ id: o.id, name: o.label })) });
          if (id) { ruleFilters.order = id; draw(); }
        } else if ('effacer' in b.dataset) {
          Object.assign(ruleFilters, { query: '', personId: null, categoryId: null });
          draw();
        }
      };
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
            <div class="choices">${radios('personId', people.map((p) => ({ value: p.id, label: p.name, swatch: true, color: p.color }))
              .concat([{ value: CARD_HOLDER, label: 'La titulaire de la carte utilisée' }]), r.personId)}</div>
            <span class="row-sub">« Titulaire de la carte » : avec la carte de Maman → Maman, avec celle de Papa → Papa
              (les paiements depuis un compte bancaire restent à trier).</span>
          </fieldset>
          <label class="field"><span>C’est quoi ?</span>
            <select name="categoryId" required>
              <optgroup label="Dépenses">${options('depense')}</optgroup>
              <optgroup label="Rentrées">${options('recette')}</optgroup>
            </select></label>
          ${r.refPrefix ? `<p class="note">Règle du <strong>contrat ${esc(r.contractLabel ?? '')}</strong> : seulement les paiements dont la référence commence par ${esc(r.refPrefix)}.</p>` : ''}
          <p class="row-sub">Utilisée ${r.hits ?? 0} fois.</p>
          ${errorBox}
          <button class="btn btn-primary btn-wide" type="submit">Enregistrer</button>
        </form>
        <button type="button" class="btn btn-danger-outline btn-wide" data-supprimer>Supprimer cette règle</button>`;
      paintTags(root);
      bindForm(root, {
        back: '#/reglages/regles',
        onSave: async (f) => {
          const updated = await saveRule(db, id, { merchantKey: f.get('merchantKey'), personId: f.get('personId'), categoryId: f.get('categoryId') });
          // « Reclasser les opérations existantes ? » (classées par la règle, à trier, ou toutes).
          await askReclassify(db, updated.id);
        },
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
        const ok = await confirmer({ titre: `Oublier ${shortRef(b.dataset.oublier)} ?`, message: 'Au prochain import, l’app vous redemandera à quel compte il appartient. Pour remettre tout de suite les opérations déjà importées sur la bonne carte : Réglages › Relancer le classement.', ok: 'Oublier', danger: true });
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

const closedGroups = new Set(); // groupes de « Mes catégories » fermés

function categories() {
  return {
    title: 'Mes catégories',
    parent: '#/reglages',
    async render(root) {
      const db = await getDb();
      const all = await R.listCategories(db);
      const seed = await (await fetch('./src/data/seed.json')).json();
      const missing = seed.categories.filter((c) => !all.some((x) => x.id === c.id)).length;
      all.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      const line = (c) => row({ href: `#/reglages/categories/${encodeURIComponent(c.id)}`, title: esc(c.name),
        sub: c.excludeFromTotals ? 'Pas comptée dans les totaux' : '' });
      // Groupes qu'on peut fermer (toucher le titre) ; l'état est retenu pendant la session.
      const group = (key, title, list) => (list.length ? `<details class="cat-group" data-group="${key}"${closedGroups.has(key) ? '' : ' open'}>
          <summary><span class="cat-group-title">${title} <span class="cat-group-count">(${list.length})</span></span>
            <span class="cat-group-state">${icon('suite')}<span data-open-word>${closedGroups.has(key) ? 'Ouvrir' : 'Fermer'}</span></span></summary>
          <section class="card list">${list.map(line).join('')}</section>
        </details>` : '');
      root.innerHTML = `
        <a class="btn btn-secondary btn-wide" href="#/reglages/categories/nouveau">${icon('plus')}Ajouter une catégorie</a>
        ${group('depense', 'Dépenses', all.filter((c) => !c.archived && c.type === 'depense'))}
        ${group('recette', 'Rentrées', all.filter((c) => !c.archived && c.type === 'recette'))}
        ${group('archive', 'Mises de côté (plus proposées pour trier)', all.filter((c) => c.archived))}
        ${all.length ? '' : '<section class="card"><p class="note">Aucune catégorie. Ajoutez les vôtres, ou remettez celles d’exemple.</p></section>'}
        ${missing ? `<button type="button" class="btn btn-secondary btn-wide" data-exemple>Remettre les catégories d’exemple (${missing})</button>` : ''}`;
      for (const d of root.querySelectorAll('.cat-group')) {
        d.addEventListener('toggle', () => {
          if (d.open) closedGroups.delete(d.dataset.group); else closedGroups.add(d.dataset.group);
          d.querySelector('[data-open-word]').textContent = d.open ? 'Fermer' : 'Ouvrir';
        });
      }
      root.onclick = async (e) => {
        if (!e.target.closest('[data-exemple]')) return;
        const ok = await confirmer({ titre: 'Remettre les catégories d’exemple ?', message: `${missing} catégories d’exemple vont être ajoutées. Vos catégories actuelles ne changent pas.`, ok: 'Remettre', non: 'Annuler' });
        if (!ok) return;
        await R.restoreSampleCategories(db, seed);
        this.render(root);
      };
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
    case 'restaurer': return restaurerView();
    case 'raccourci': return raccourciView();
    case 'compte':
    case 'synchro': return compteView();
    case 'supprimer': return supprimerView(path[1]);
    case 'imports': return importsView();
    case 'copie': return copieView();
    case 'relancer': return relancerView();
    default: return accueilReglages();
  }
}
