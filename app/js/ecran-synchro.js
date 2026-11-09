/**
 * ecran-synchro.js — Réglages › Synchronisation : connexion, création du coffre, Face ID,
 * déverrouillage, état ; bandeau « synchronisation en pause » de l'accueil.
 *
 * Version : 0.9.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Adresse : #/reglages/synchro (dans la fenêtre Réglages).
 *
 * Historique :
 *   0.8.6  FRE (Fidag)  Première version.
 *   0.9.1  FRE (Fidag)  Textes pour tous les appareils (iPad et iPhone).
 */

import { icon, esc, confirmer } from './ui.js';
import * as sync from './synchro-service.js';
import { passphraseProblem, normalizePassphrase, MIN_PASSPHRASE } from '../src/core/chiffrement.js';
import { whenText } from './ecran-sauvegarde.js';

const errorBox = '<p class="form-error" role="alert" tabindex="-1" hidden></p>';
// Phrase de passe gardée un instant (même écran) pour proposer Face ID juste après ; effacée ensuite.
let justTyped = null;

function showError(root, e) {
  const err = root.querySelector('.form-error');
  err.textContent = typeof e === 'string' ? e : sync.messageOf(e);
  err.hidden = false;
  err.focus();
}

/** Bouton occupé pendant une action. */
async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

/** Petit texte d'état (Réglages, accueil). */
export async function statusText() {
  const s = sync.getState();
  if (s.phase === 'inactif') return 'Pas encore activée';
  if (!s.unlocked) return 'En pause : à déverrouiller';
  if (s.busy) return 'Synchronisation en cours…';
  if (s.lastError) return s.lastError;
  return s.lastResult ? `À jour (${whenText(s.lastResult.at)})` : 'Active';
}

/** Ligne de la vue d'ensemble des Réglages. */
export async function synchroRow() {
  return `<a class="row" href="#/reglages/synchro">
    <span class="row-text"><span class="row-title">Synchronisation entre appareils</span>
    <span class="row-sub">${esc(await statusText())}</span></span>${icon('suite')}</a>`;
}

/** Bandeau de l'accueil quand la synchronisation est en pause. */
export async function synchroBanner() {
  const s = sync.getState();
  if (s.phase !== 'verrouille' || s.unlocked) return '';
  const dev = await sync.deviceSettings();
  return `<div class="warn-box warn-action sync-banner" role="status">${icon('cadenas')}
      <span><strong>Synchronisation en pause.</strong> Vos changements restent sur cet appareil.</span>
      ${dev?.credentialId
        ? `<button type="button" class="btn btn-primary" data-faceid>${icon('cadenas')}Déverrouiller avec Face ID</button>`
        : `<a class="btn btn-primary" href="#/reglages/synchro">${icon('cadenas')}Déverrouiller</a>`}
    </div>
    <p class="form-error sync-error" role="alert" tabindex="-1" hidden></p>`;
}

/**
 * À brancher dans l'accueil : bouton Face ID du bandeau.
 * @returns {Promise<null|boolean>} null : pas ce bouton ; vrai : déverrouillé ; faux : erreur affichée.
 */
export async function handleBannerClick(e, root) {
  const b = e.target.closest('[data-faceid]');
  if (!b) return null;
  try {
    await busy(b, 'Face ID…', () => sync.unlockWithFaceId());
    return true;
  } catch (ex) {
    const err = root.querySelector('.sync-error');
    err.textContent = sync.messageOf(ex);
    err.hidden = false;
    err.focus();
    return false;
  }
}

/* ---------- Écrans ---------- */

function loginHtml() {
  return `<section class="card">
      <h2>Synchroniser entre l’iPad et l’iPhone</h2>
      <p class="note">Les données sont <strong>chiffrées sur l’appareil</strong> avant d’être envoyées : personne d’autre, pas même
      Google (Firebase), ne peut les lire. Elles restent aussi sur chaque appareil (iPad, iPhone), et l’app fonctionne sans Internet.</p>
    </section>
    <form class="card form" data-login>
      <h2>Se connecter</h2>
      <label class="field"><span>Adresse e-mail</span>
        <input type="email" name="email" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>Mot de passe</span>
        <input type="password" name="password" autocomplete="current-password" required></label>
      ${errorBox}
      <button type="submit" class="btn btn-primary btn-wide">Se connecter</button>
    </form>`;
}

function createHtml() {
  return `<section class="danger-zone" aria-labelledby="coffre-titre">
      <div class="danger-head">${icon('attention')}<h2 id="coffre-titre">Important : la phrase de passe ne peut pas être retrouvée</h2></div>
      <p>La phrase de passe est la <strong>seule clé</strong> des données envoyées dans le cloud. Personne ne peut la retrouver
      ni la remettre à zéro, pas même le développeur.</p>
      <p><strong>Si vous perdez la phrase de passe ET Face ID sur tous les appareils, les données du cloud sont perdues pour toujours.</strong>
      (Les données restent sur chaque appareil et dans vos sauvegardes fichiers.)</p>
      <p>Écrivez-la sur papier et rangez-la en lieu sûr.</p>
    </section>
    <form class="card form" data-create>
      <h2>Créer le coffre</h2>
      <label class="field"><span>Phrase de passe (au moins ${MIN_PASSPHRASE} caractères, par exemple quatre mots)</span>
        <input type="password" name="p1" autocomplete="new-password" required></label>
      <label class="field"><span>La même phrase, encore une fois</span>
        <input type="password" name="p2" autocomplete="new-password" required></label>
      <label class="field"><span>Nom de cet appareil (par exemple « iPhone de Maman »)</span>
        <input type="text" name="label" value="iPad" maxlength="40" required></label>
      <label class="choice choice-check danger-check">
        <input type="checkbox" name="compris" required>
        <span>J’ai compris : <strong>sans la phrase de passe ni Face ID, les données du cloud sont irrécupérables.</strong>
        J’ai écrit la phrase de passe sur papier.</span>
      </label>
      ${errorBox}
      <button type="submit" class="btn btn-primary btn-wide btn-big">Créer le coffre et synchroniser</button>
    </form>`;
}

function unlockHtml(dev, firstTime) {
  return `<section class="card">
      <h2>Ouvrir les données du cloud</h2>
      ${firstTime ? `<p class="note">Première fois sur cet appareil : les données du cloud y seront copiées. Quand une même opération
        existe des deux côtés, c’est celle du cloud qui est gardée ; ce qui n’existe que sur cet appareil est ajouté au cloud.</p>` : ''}
      ${dev?.credentialId ? `<button type="button" class="btn btn-primary btn-wide btn-big" data-faceid>${icon('cadenas')}Déverrouiller avec Face ID</button>` : ''}
    </section>
    <form class="card form" data-unlock>
      <h2>${dev?.credentialId ? 'Ou avec la phrase de passe' : 'Avec la phrase de passe'}</h2>
      <label class="field"><span>Phrase de passe</span>
        <input type="password" name="p" autocomplete="current-password" required></label>
      ${dev?.credentialId ? '' : `<label class="field"><span>Nom de cet appareil (par exemple « iPhone de Maman »)</span>
        <input type="text" name="label" value="iPad" maxlength="40"></label>`}
      ${errorBox}
      <button type="submit" class="btn btn-${dev?.credentialId ? 'secondary' : 'primary'} btn-wide">Ouvrir avec la phrase de passe</button>
    </form>`;
}

async function activeHtml(dev, canFaceId) {
  const s = sync.getState();
  const n = await sync.pendingCount();
  const r = s.lastResult;
  return `<section class="card card-accent">
      <div class="card-line">
        <span class="round-icon ok">${icon('ok')}</span>
        <span class="row-text"><span class="row-title">Synchronisation active</span>
          <span class="row-sub">${esc(s.user?.email ?? '')}</span></span>
      </div>
      <div class="counts">
        <div class="count-line"><span>Dernière synchronisation</span><strong>${r ? esc(whenText(r.at)) : 'pas encore'}</strong></div>
        <div class="count-line"><span>Changements en attente d’envoi</span><strong>${n}</strong></div>
        ${r && r.applied ? `<div class="count-line"><span>Reçus des autres appareils (dernière fois)</span><strong>${r.applied}</strong></div>` : ''}
      </div>
      ${s.lastError ? `<p class="warn-box">${icon('attention')}<span>${esc(s.lastError)}</span></p>` : ''}
      ${errorBox}
      <button type="button" class="btn btn-primary btn-wide" data-sync-now${s.busy ? ' disabled' : ''}>${s.busy ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>
    </section>
    ${canFaceId && !dev?.credentialId ? `<form class="card form" data-faceid-on>
        <h2>Activer Face ID sur cet appareil</h2>
        <p class="note">Ensuite, un simple regard suffit pour ouvrir les données. La phrase de passe reste la clé de secours.</p>
        ${justTyped ? '' : `<label class="field"><span>Phrase de passe</span>
          <input type="password" name="p" autocomplete="current-password" required></label>`}
        <label class="field"><span>Nom de cet appareil (par exemple « iPhone de Maman »)</span>
          <input type="text" name="label" value="${esc(justTyped?.label ?? 'iPad')}" maxlength="40" required></label>
        <p class="form-error" data-faceid-error role="alert" tabindex="-1" hidden></p>
        <button type="submit" class="btn btn-primary btn-wide">${icon('cadenas')}Activer Face ID</button>
      </form>` : ''}
    ${dev?.credentialId ? `<p class="note">Face ID est activé sur cet appareil (${esc(dev.label ?? '')}).</p>` : ''}
    <section class="card">
      <button type="button" class="btn btn-secondary btn-wide" data-lock>${icon('cadenas')}Verrouiller</button>
      <button type="button" class="btn btn-secondary btn-wide" data-signout>Se déconnecter de cet appareil</button>
      <p class="note">Verrouiller : la synchronisation s’arrête jusqu’au prochain Face ID. Se déconnecter : cet appareil ne synchronise plus ;
      ses données y restent.</p>
    </section>`;
}

export function synchroView() {
  return {
    title: 'Synchronisation',
    parent: '#/reglages',
    async render(root) {
      const rerender = () => this.render(root);
      root.innerHTML = '<p class="note">Un instant…</p>';
      const s = sync.getState();
      const dev = await sync.deviceSettings();
      let user = null;
      try {
        user = await sync.currentUser();
      } catch (e) {
        root.innerHTML = `<section class="card">${errorBox}</section>`;
        showError(root, e);
        return;
      }

      if (!user) {
        justTyped = null;
        root.innerHTML = loginHtml();
        root.querySelector('[data-login]').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = new FormData(e.target);
          try {
            await busy(e.target.querySelector('button'), 'Connexion…', () => sync.signIn(f.get('email'), f.get('password')));
            rerender();
          } catch (ex) { showError(root, ex); }
        });
        return;
      }

      if (!s.unlocked) {
        justTyped = null;
        let exists;
        try { exists = await sync.vaultExists(); } catch (e) {
          root.innerHTML = `<section class="card">${errorBox}<button type="button" class="btn btn-secondary btn-wide" data-retry>Réessayer</button></section>`;
          showError(root, e);
          root.querySelector('[data-retry]').onclick = rerender;
          return;
        }
        if (!exists) {
          root.innerHTML = createHtml();
          root.querySelector('[data-create]').addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            const p1 = normalizePassphrase(f.get('p1'));
            if (p1 !== normalizePassphrase(f.get('p2'))) return showError(root, 'Les deux phrases ne sont pas identiques. Retapez-les.');
            const problem = passphraseProblem(p1);
            if (problem) return showError(root, problem);
            const ok = await confirmer({
              titre: 'Avez-vous écrit la phrase de passe ?',
              message: 'Sans elle (et sans Face ID), les données du cloud ne pourront jamais être ouvertes.',
              ok: 'Oui, elle est écrite', non: 'Non, attendre',
            });
            if (!ok) return;
            try {
              await busy(e.target.querySelector('[type=submit]'), 'Création…', () => sync.createVault(p1));
              justTyped = { p: p1, label: String(f.get('label') || 'iPad').trim() };
              rerender();
            } catch (ex) { showError(root, ex); }
          });
          return;
        }
        root.innerHTML = unlockHtml(dev, !(await sync.deviceSettings())?.configured);
        root.onclick = async (e) => {
          if (!e.target.closest('[data-faceid]')) return;
          try {
            await busy(e.target.closest('[data-faceid]'), 'Face ID…', () => sync.unlockWithFaceId());
            rerender();
          } catch (ex) { showError(root, ex); }
        };
        root.querySelector('[data-unlock]').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = new FormData(e.target);
          try {
            await busy(e.target.querySelector('[type=submit]'), 'Ouverture…', () => sync.unlockWithPassphrase(f.get('p')));
            justTyped = { p: f.get('p'), label: String(f.get('label') || dev?.label || 'iPad').trim() };
            rerender();
          } catch (ex) { showError(root, ex); }
        });
        return;
      }

      const canFaceId = await sync.faceIdAvailable();
      root.innerHTML = await activeHtml(dev, canFaceId);
      const onState = () => { if (root.isConnected) rerender(); };
      document.addEventListener('synchro-etat', onState, { once: true });
      const faceForm = root.querySelector('[data-faceid-on]');
      faceForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(faceForm);
        const p = justTyped?.p ?? f.get('p');
        try {
          document.removeEventListener('synchro-etat', onState);
          await busy(faceForm.querySelector('[type=submit]'), 'Face ID…', () => sync.enableFaceId(p, String(f.get('label')).trim()));
          justTyped = null;
          rerender();
        } catch (ex) {
          const err = faceForm.querySelector('[data-faceid-error]');
          err.textContent = sync.messageOf(ex);
          err.hidden = false;
          err.focus();
        }
      });
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if ('syncNow' in b.dataset) {
          try { await sync.syncNow(); } catch { /* affiché par l'état */ }
        } else if ('lock' in b.dataset) {
          justTyped = null;
          sync.lock();
        } else if ('signout' in b.dataset) {
          const ok = await confirmer({
            titre: 'Se déconnecter de cet appareil ?',
            message: 'Cet appareil ne synchronisera plus. Ses données y restent. Pour reprendre, il faudra se reconnecter et la phrase de passe.',
            ok: 'Se déconnecter', non: 'Annuler', danger: true,
          });
          if (!ok) return;
          justTyped = null;
          document.removeEventListener('synchro-etat', onState);
          try { await sync.signOut(); } catch (ex) { return showError(root, ex); }
          rerender();
        }
      };
    },
  };
}
