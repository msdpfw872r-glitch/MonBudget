/**
 * ecran-supprimer.js — Réglages › Supprimer des données (choisir, vérifier, taper SUPPRIMER, valider),
 * Réglages › Imports (supprimer un import), Réglages › Copie de sécurité (fichier).
 *
 * Version : 0.11.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Adresses : #/reglages/supprimer, #/reglages/supprimer/<groupe>, #/reglages/supprimer/verifier,
 *            #/reglages/imports, #/reglages/copie. Maquette : docs/maquette/supprimer-donnees.html.
 *
 * Historique :
 *   0.11.0 FRE (Fidag)  Première version.
 */

import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import * as session from './session.js';
import * as D from '../src/core/suppression.js';
import { formatMonth } from '../src/core/format.js';
import { saveNow, showSaveResult, whenText } from './ecran-sauvegarde.js';

let selection = {};   // { groupe: 'all' | [ids] }
let done = null;      // résultat de la dernière suppression
let seedCache = null;
const seed = async () => (seedCache ??= await (await fetch('./src/data/seed.json')).json());
const opts = async () => ({ seed: await seed() });
const go = (h) => { location.hash = h; };

/** État d'un groupe : 'none' | 'all' | 'some', et le nombre choisi. */
function stateOf(groupId, total) {
  const s = selection[groupId];
  if (!s || (Array.isArray(s) && !s.length) || !total) return { st: 'none', n: 0 };
  if (s === 'all' || s.length >= total) return { st: 'all', n: total };
  return { st: 'some', n: s.length };
}

const boxSvg = (st) => (st === 'all' ? icon('ok') : st === 'some' ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>' : '');
const ariaChecked = (st) => (st === 'all' ? 'true' : st === 'some' ? 'mixed' : 'false');
const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '’');

/* ---------- 1. Choisir ---------- */

function chooseView() {
  return {
    title: 'Supprimer des données',
    parent: '#/reglages',
    async render(root) {
      const db = await getDb();
      const o = await opts();
      if (done) return doneView(root);
      const totals = {};
      for (const g of D.GROUPS) totals[g.id] = (await D.listGroup(db, g.id, o)).length;
      const chosen = D.GROUPS.filter((g) => stateOf(g.id, totals[g.id]).st !== 'none').length;
      root.innerHTML = `<p class="steps"><strong>1. Choisir</strong> › 2. Vérifier › 3. Confirmer</p>
        <p class="note">Pour chaque genre de données : rien, tout, ou seulement certains éléments.</p>
        ${D.GROUPS.map((g) => {
          const { st, n } = stateOf(g.id, totals[g.id]);
          const pill = st === 'none' ? 'Rien' : st === 'all' ? `Tout · ${fmtN(n)}` : `${fmtN(n)} sur ${fmtN(totals[g.id])}`;
          return `<section class="del-group${st !== 'none' ? ' on' : ''}">
            <button type="button" class="tbox ${st}" role="checkbox" aria-checked="${ariaChecked(st)}" data-toggle="${g.id}"
              aria-label="${esc(g.title)} : ${esc(pill)}"${totals[g.id] ? '' : ' disabled'}>${boxSvg(st)}</button>
            <span class="row-text"><span class="row-title">${esc(g.title)}</span><span class="row-sub">${esc(g.help)}</span></span>
            <span class="del-pill ${st}">${totals[g.id] ? esc(pill) : 'Aucun'}</span>
            ${totals[g.id] ? `<a class="btn btn-secondary btn-small" href="#/reglages/supprimer/${g.id}">Choisir</a>` : ''}
          </section>`;
        }).join('')}
        <button type="button" class="btn btn-danger btn-wide btn-big" data-next${chosen ? '' : ' disabled'}>
          ${chosen ? `Continuer : vérifier (${chosen} choix)` : 'Choisissez d’abord quoi supprimer'}</button>`;
      root.onclick = (e) => {
        const t = e.target.closest('[data-toggle]');
        if (t) {
          const id = t.dataset.toggle;
          selection[id] = stateOf(id, totals[id]).st === 'all' ? null : 'all';
          this.render(root);
        } else if (e.target.closest('[data-next]')) go('#/reglages/supprimer/verifier');
      };
    },
  };
}

/* ---------- Choisir parmi les éléments d'un groupe ---------- */

function pickView(groupId) {
  const g = D.groupById(groupId);
  return {
    title: g.title,
    parent: '#/reglages/supprimer',
    async render(root) {
      const db = await getDb();
      const items = await D.listGroup(db, groupId, await opts());
      const cur = selection[groupId];
      const picked = new Set(cur === 'all' ? items.map((i) => i.id) : cur ?? []);
      const byMonth = groupId === 'operations' || groupId === 'tri';
      let html = '';
      let lastMonth = null;
      for (const it of items) {
        if (byMonth && it.month !== lastMonth) {
          if (lastMonth !== null) html += '</section>';
          lastMonth = it.month;
          html += `<section class="card list del-month" data-month="${it.month}">
            <label class="del-item del-month-head"><input type="checkbox" data-month-box="${it.month}">
            <span class="row-title">${esc(formatMonth(`${it.month}-01`))}</span></label>`;
        }
        html += `<label class="del-item" data-search="${esc(`${it.label} ${it.sub}`.toLowerCase())}">
          <input type="checkbox" value="${esc(it.id)}"${picked.has(it.id) ? ' checked' : ''}${byMonth ? ` data-in-month="${it.month}"` : ''}>
          <span class="row-text"><span class="row-title">${esc(it.label)}</span><span class="row-sub">${esc(it.sub)}</span></span></label>`;
      }
      if (byMonth && lastMonth !== null) html += '</section>';
      root.innerHTML = `<div class="del-quick">
          <button type="button" class="btn btn-secondary" data-all>Tout cocher</button>
          <button type="button" class="btn btn-secondary" data-none>Tout décocher</button></div>
        <label class="search">${icon('loupe')}<input type="search" placeholder="Chercher" aria-label="Chercher" data-search-input></label>
        ${byMonth ? html : `<section class="card list">${html}</section>`}
        <div class="del-bar"><button type="button" class="btn btn-primary btn-wide" data-keep></button></div>`;
      const boxes = () => [...root.querySelectorAll('input[type=checkbox][value]')];
      const refresh = () => {
        const n = boxes().filter((b) => b.checked).length;
        root.querySelector('[data-keep]').textContent = `Garder ce choix (${fmtN(n)} sur ${fmtN(items.length)})`;
        for (const mb of root.querySelectorAll('[data-month-box]')) {
          const inMonth = boxes().filter((b) => b.dataset.inMonth === mb.dataset.monthBox);
          const c = inMonth.filter((b) => b.checked).length;
          mb.checked = c === inMonth.length && c > 0;
          mb.indeterminate = c > 0 && c < inMonth.length;
        }
      };
      refresh();
      root.onchange = (e) => {
        const mb = e.target.closest('[data-month-box]');
        if (mb) for (const b of boxes()) if (b.dataset.inMonth === mb.dataset.monthBox) b.checked = mb.checked;
        refresh();
      };
      root.querySelector('[data-search-input]').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        for (const el of root.querySelectorAll('[data-search]')) el.hidden = Boolean(q) && !el.dataset.search.includes(q);
      });
      root.onclick = (e) => {
        const visible = boxes().filter((b) => !b.closest('[data-search]').hidden);
        if (e.target.closest('[data-all]')) { for (const b of visible) b.checked = true; refresh(); }
        else if (e.target.closest('[data-none]')) { for (const b of visible) b.checked = false; refresh(); }
        else if (e.target.closest('[data-keep]')) {
          const ids = boxes().filter((b) => b.checked).map((b) => b.value);
          selection[groupId] = ids.length === items.length && ids.length ? 'all' : ids;
          go('#/reglages/supprimer');
        }
      };
    },
  };
}

/* ---------- 2–3. Vérifier et confirmer ---------- */

function verifyView() {
  return {
    title: 'Vérifier',
    parent: '#/reglages/supprimer',
    async render(root) {
      const db = await getDb();
      const o = await opts();
      const plan = await D.planDeletion(db, selection, o);
      if (!plan.lines.length) { go('#/reglages/supprimer'); return; }
      root.innerHTML = `<p class="steps">1. Choisir › <strong>2. Vérifier › 3. Confirmer</strong></p>
        <section class="danger-zone" aria-labelledby="del-titre">
          <div class="danger-head">${icon('attention')}<h2 id="del-titre">Ceci sera supprimé</h2></div>
          <ul class="del-list">${plan.lines.map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>
          <p><strong>Aussi sur vos autres appareils.</strong> Cela ne peut pas être annulé.</p>
          <label class="field"><span>Pour confirmer, tapez SUPPRIMER</span>
            <input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-mot class="del-word"></label>
          <p class="form-error" role="alert" tabindex="-1" hidden></p>
          <button type="button" class="btn btn-danger btn-wide btn-big" data-valider disabled>${icon('corbeille')}Valider la suppression</button>
          <button type="button" class="btn btn-secondary btn-wide" data-annuler>Annuler, ne rien supprimer</button>
        </section>`;
      const btn = root.querySelector('[data-valider]');
      root.querySelector('[data-mot]').addEventListener('input', (e) => {
        btn.disabled = e.target.value.trim().toUpperCase() !== 'SUPPRIMER';
      });
      root.onclick = async (e) => {
        if (e.target.closest('[data-annuler]')) { selection = {}; go('#/reglages'); return; }
        if (!e.target.closest('[data-valider]') || btn.disabled) return;
        const ok = await confirmer({ titre: 'Supprimer maintenant ?', message: plan.lines.map((l) => l.text).join(' · '), ok: 'Oui, supprimer', non: 'Non', danger: true });
        if (!ok) return;
        try {
          btn.disabled = true;
          btn.textContent = 'Suppression…';
          done = await D.applyDeletion(db, selection, o);
          selection = {};
          document.dispatchEvent(new CustomEvent('donnees-modifiees'));
          session.scheduleSync(0);
          go('#/reglages/supprimer');
        } catch {
          const err = root.querySelector('.form-error');
          err.textContent = 'La suppression n’a pas pu se terminer. Vérifiez ce qui reste, puis réessayez.';
          err.hidden = false;
          err.focus();
        }
      };
    },
  };
}

function doneView(root) {
  const labels = [['imports', 'Imports supprimés'], ['operations', 'Opérations supprimées'], ['tri', 'Opérations remises à trier'],
    ['regles', 'Règles supprimées'], ['rattachements', 'Factures détachées de leurs achats'], ['numeros', 'Numéros oubliés'],
    ['ajouts', 'Catégories et personnes supprimées']];
  root.innerHTML = `<section class="card del-done">
      <span class="round-icon ok">${icon('ok')}</span>
      <h2>C’est supprimé</h2>
      <div class="counts">${labels.filter(([k]) => done[k]).map(([k, t]) => `<div class="count-line"><span>${t}</span><strong>${fmtN(done[k])}</strong></div>`).join('')}</div>
      <p class="note">Vos autres appareils seront mis à jour à la prochaine synchronisation.</p>
    </section>
    <a class="btn btn-primary btn-wide" href="#/reglages" data-fini>Retour aux Réglages</a>`;
  root.onclick = (e) => { if (e.target.closest('[data-fini]')) done = null; };
}

export function supprimerView(sub) {
  if (sub === 'verifier') return verifyView();
  if (sub && D.groupById(sub)) return pickView(sub);
  return chooseView();
}

/* ---------- Réglages › Imports ---------- */

export function importsView() {
  return {
    title: 'Imports',
    parent: '#/reglages',
    async render(root) {
      const db = await getDb();
      const items = await D.listGroup(db, 'imports', await opts());
      root.innerHTML = items.length
        ? `<p class="note">Les fichiers de banque importés, du plus récent au plus ancien.</p>
           <section class="card list">${items.map((i) => `<div class="row row-static">
             <span class="row-text"><span class="row-title">${esc(i.label)}</span><span class="row-sub">${esc(i.sub)}</span></span>
             <button type="button" class="btn btn-secondary btn-small" data-del="${esc(i.id)}">${icon('corbeille')}Supprimer</button></div>`).join('')}</section>
           <a class="btn btn-secondary btn-wide" href="#/reglages/supprimer/imports">Supprimer plusieurs imports</a>`
        : '<section class="card"><p class="note">Aucun fichier importé pour l’instant.</p></section>';
      root.onclick = (e) => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        selection = { imports: [b.dataset.del] };
        go('#/reglages/supprimer/verifier');
      };
    },
  };
}

/* ---------- Réglages › Copie de sécurité ---------- */

export async function copieRow(db) {
  const s = await db.get('settings', 'app');
  return `<a class="row" href="#/reglages/copie"><span class="row-text"><span class="row-title">Copie de sécurité (fichier)</span>
    <span class="row-sub">${s?.lastBackupAt ? `Dernière : ${esc(whenText(s.lastBackupAt))}` : 'Facultatif : en cas de suppression par erreur'}</span></span>${icon('suite')}</a>`;
}

export function copieView() {
  return {
    title: 'Copie de sécurité',
    parent: '#/reglages',
    async render(root) {
      root.innerHTML = `<section class="card">
          <p>Vos données sont déjà synchronisées entre vos appareils. Une copie dans un fichier sert seulement à
          <strong>revenir en arrière</strong> après une suppression par erreur (une suppression est recopiée partout).</p>
          <p class="flash" data-message-sauvegarde role="status" hidden></p>
          <button type="button" class="btn btn-secondary btn-wide" data-sauvegarder>${icon('sauvegarde')}Enregistrer une copie maintenant</button>
          <a class="btn btn-secondary btn-wide" href="#/reglages/restaurer">Remettre une copie</a>
          <a class="row" href="#/reglages/raccourci"><span class="row-text"><span class="row-title">Avec l’app Raccourcis</span>
            <span class="row-sub">Enregistrer la copie dans votre dossier</span></span>${icon('suite')}</a>
        </section>`;
      root.onclick = async (e) => {
        const b = e.target.closest('[data-sauvegarder]');
        if (!b) return;
        b.disabled = true;
        const r = await saveNow();
        b.disabled = false;
        showSaveResult(root.querySelector('[data-message-sauvegarde]'), r);
      };
    },
  };
}
