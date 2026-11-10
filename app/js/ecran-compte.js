/**
 * ecran-compte.js — Réglages › Compte et synchronisation : état de la synchronisation, Face ID,
 * verrouiller, se reconnecter, se déconnecter (efface l'appareil).
 *
 * Version : 0.10.2
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Adresse : #/reglages/compte (dans la fenêtre Réglages).
 *
 * Historique :
 *   0.10.2 FRE (Fidag)  Première version (remplace ecran-synchro.js).
 */

import { icon, esc } from './ui.js';
import * as session from './session.js';
import { confirmSignOut } from './ecran-verrou.js';
import { whenText } from './ecran-sauvegarde.js';

const errorBox = '<p class="form-error" role="alert" tabindex="-1" hidden></p>';

function statusText(s) {
  if (s.busy) return 'Synchronisation en cours…';
  if (s.lastError) return s.lastError;
  return s.lastResult ? `À jour (${whenText(s.lastResult.at)})` : 'Active';
}

/** Ligne de la vue d'ensemble des Réglages. */
export async function compteRow() {
  const dev = await session.device();
  return `<a class="row" href="#/reglages/compte">
    <span class="row-text"><span class="row-title">Compte et synchronisation</span>
    <span class="row-sub">${esc(dev?.email ?? '')} · ${esc(statusText(session.getState()))}</span></span>${icon('suite')}</a>`;
}

export function compteView() {
  return {
    title: 'Compte et synchronisation',
    parent: '#/reglages',
    async render(root) {
      const rerender = () => { if (root.isConnected) this.render(root); };
      const s = session.getState();
      const dev = await session.device();
      const n = await session.pendingCount();
      let user = null;
      try { user = await session.currentUser(); } catch { /* hors ligne */ }
      const canFaceId = !dev?.passkey && await session.faceIdAvailable();
      const r = s.lastResult;
      root.innerHTML = `<section class="card card-accent">
          <div class="card-line">
            <span class="round-icon ok">${icon('ok')}</span>
            <span class="row-text"><span class="row-title">${esc(dev?.email ?? '')}</span>
              <span class="row-sub">Données chiffrées sur cet appareil et en ligne</span></span>
          </div>
          <div class="counts">
            <div class="count-line"><span>Dernière synchronisation</span><strong>${r ? esc(whenText(r.at)) : 'pas encore'}</strong></div>
            <div class="count-line"><span>Changements en attente d’envoi</span><strong>${n}</strong></div>
          </div>
          ${s.lastError ? `<p class="warn-box">${icon('attention')}<span>${esc(s.lastError)}</span></p>` : ''}
          ${errorBox}
          <button type="button" class="btn btn-primary btn-wide" data-sync-now${s.busy ? ' disabled' : ''}>${s.busy ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>
        </section>
        ${user ? '' : `<form class="card form" data-relogin>
            <h2>Se reconnecter</h2>
            <p class="note">La connexion en ligne a expiré : vos données restent sur l’appareil, mais ne se synchronisent plus.</p>
            <input type="hidden" name="email" value="${esc(dev?.email ?? '')}">
            <label class="field"><span>Mot de passe du compte ${esc(dev?.email ?? '')}</span>
              <input type="password" name="password" autocomplete="current-password" required></label>
            <p class="form-error" data-relogin-error role="alert" tabindex="-1" hidden></p>
            <button type="submit" class="btn btn-primary btn-wide">Se reconnecter</button>
          </form>`}
        <section class="card form">
          <h2>Face ID ou Touch ID</h2>
          ${dev?.passkey
            ? `<p>Face ID ou Touch ID ouvre l’app sur cet appareil (${esc(dev.passkey.label)}).</p>
               <button type="button" class="btn btn-secondary btn-wide" data-faceid-off>Ne plus utiliser Face ID ou Touch ID</button>`
            : canFaceId
              ? `<form class="form" data-faceid-on>
                  <p class="note">Tapez la phrase de secours pour activer Face ID ou Touch ID sur cet appareil.</p>
                  <label class="field"><span>Phrase de secours</span>
                    <input type="password" name="p" autocomplete="current-password" required></label>
                  <p class="form-error" data-faceid-error role="alert" tabindex="-1" hidden></p>
                  <button type="submit" class="btn btn-primary btn-wide">${icon('cadenas')}Activer Face ID ou Touch ID</button>
                </form>`
              : '<p class="note">Cet appareil ne permet pas d’ouvrir l’app avec Face ID ou Touch ID : la phrase de secours est utilisée.</p>'}
        </section>
        <section class="card">
          <button type="button" class="btn btn-secondary btn-wide" data-lock>${icon('cadenas')}Verrouiller maintenant</button>
          <p class="note">L’app se verrouille aussi toute seule une minute après l’avoir quittée.</p>
          <button type="button" class="btn btn-danger btn-wide" data-signout>Se déconnecter et effacer cet appareil</button>
          <p class="note">Les données restent dans votre espace en ligne : en vous reconnectant, vous les retrouvez.</p>
        </section>`;

      const onState = () => rerender();
      document.addEventListener('session', onState, { once: true });

      const fieldError = (sel, ex) => {
        const err = root.querySelector(sel);
        err.textContent = session.messageOf(ex);
        err.hidden = false;
        err.focus();
      };
      root.querySelector('[data-relogin]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try { await session.signIn(f.get('email'), f.get('password')); session.scheduleSync(0); rerender(); } catch (ex) { fieldError('[data-relogin-error]', ex); }
      });
      root.querySelector('[data-faceid-on]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        document.removeEventListener('session', onState);
        try { await session.enableFaceId(f.get('p'), dev?.passkey?.label ?? labelGuess()); rerender(); } catch (ex) { fieldError('[data-faceid-error]', ex); }
      });
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if ('syncNow' in b.dataset) { try { await session.syncNow(); } catch { /* affiché par l'état */ } }
        else if ('lock' in b.dataset) session.lock();
        else if ('faceidOff' in b.dataset) await session.disableFaceId();
        else if ('signout' in b.dataset) {
          document.removeEventListener('session', onState);
          if (await confirmSignOut()) location.hash = '#/accueil';
          else rerender();
        }
      };
    },
  };
}

function labelGuess() {
  return /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'iPad';
}
