/**
 * ecran-verrou.js — Écrans plein écran avant l'app : connexion, création de l'espace chiffré,
 * arrivée d'un nouvel appareil, activation de Face ID, écran « Mon Budget est verrouillé ».
 *
 * Version : 0.14.3
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Tant que l'app n'est pas ouverte, l'interface habituelle est masquée (et vidée au verrouillage).
 * Quand l'app passe en arrière-plan, son contenu est caché (aperçu du sélecteur d'apps).
 *
 * Historique :
 *   0.10.2 FRE (Fidag)  Première version.
 *   0.14.1 FRE (Fidag)  Écran Bienvenue : phrase sur Google retirée.
 *   0.14.3 FRE (Fidag)  Activer Face ID : conseil « choisissez Mots de passe (Apple) ».
 */

import { icon, esc, confirmer } from './ui.js';
import * as session from './session.js';
import { passphraseProblem, normalizePassphrase, MIN_PASSPHRASE } from '../src/core/chiffrement.js';

const root = () => document.getElementById('verrou');
const shell = () => document.querySelector('.shell');

let step = 'login';        // connexion : 'login' | 'creer' | 'rejoindre'
let offerFaceId = null;    // { p, label } juste après création / arrivée : proposer Face ID ou Touch ID
let autoTried = false;     // Face ID ou Touch ID déjà proposé tout seul pour ce verrouillage
let onOpenCb = null;       // l'app réapparaît : redessiner l'écran courant
const errorBox = '<p class="form-error" role="alert" tabindex="-1" hidden></p>';

function showError(e) {
  const err = root().querySelector('.form-error');
  err.textContent = typeof e === 'string' ? e : session.messageOf(e);
  err.hidden = false;
  err.focus();
}

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

function frame(inner) {
  return `<div class="lock-inner">
      <div class="lock-brand"><img src="icons/icon-192.png" alt="" width="72" height="72"><span>Mon Budget</span></div>
      ${inner}
    </div>`;
}

/* ---------- Contenus ---------- */

const loginHtml = () => frame(`<form class="card form" data-login>
    <h1>Bienvenue</h1>
    <p class="note">Connectez-vous avec le compte Mon Budget.</p>
    <label class="field"><span>Adresse e-mail</span>
      <input type="email" name="email" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
    <label class="field"><span>Mot de passe</span>
      <input type="password" name="password" autocomplete="current-password" required></label>
    ${errorBox}
    <button type="submit" class="btn btn-primary btn-wide btn-big">Se connecter</button>
  </form>`);

const createHtml = () => frame(`<section class="danger-zone" aria-labelledby="coffre-titre">
    <div class="danger-head">${icon('attention')}<h2 id="coffre-titre">Choisissez votre phrase de secours</h2></div>
    <p>Elle sert de <strong>clé</strong> à vos données. Elle ouvre l’app quand Face ID ou Touch ID n’est pas disponible
    (nouvel appareil, Face ID ou Touch ID qui ne reconnaît pas).</p>
    <p><strong>Personne ne peut la retrouver ni la remettre à zéro. Si vous perdez la phrase de secours ET Face ID ou Touch ID,
    les données sont perdues pour toujours.</strong></p>
    <p>Écrivez-la sur papier et rangez-la en lieu sûr.</p>
  </section>
  <form class="card form" data-create>
    <label class="field"><span>Phrase de secours (au moins ${MIN_PASSPHRASE} caractères, par exemple quatre mots)</span>
      <input type="password" name="p1" autocomplete="new-password" required></label>
    <label class="field"><span>La même phrase, encore une fois</span>
      <input type="password" name="p2" autocomplete="new-password" required></label>
    <label class="field"><span>Nom de cet appareil</span>
      <input type="text" name="label" value="${esc(defaultLabel())}" maxlength="40" required></label>
    <label class="choice choice-check danger-check">
      <input type="checkbox" name="compris" required>
      <span>J’ai compris : <strong>sans la phrase de secours ni Face ID ou Touch ID, mes données sont irrécupérables.</strong>
      Je l’ai écrite sur papier.</span>
    </label>
    ${errorBox}
    <button type="submit" class="btn btn-primary btn-wide btn-big">Créer mon espace et ouvrir l’app</button>
  </form>`);

const joinHtml = () => frame(`<form class="card form" data-join>
    <h1>Ouvrir vos données sur cet appareil</h1>
    <p class="note">Votre espace existe déjà. Tapez la phrase de secours choisie sur le premier appareil :
    vos données arriveront ici.</p>
    <label class="field"><span>Phrase de secours</span>
      <input type="password" name="p" autocomplete="current-password" required></label>
    <label class="field"><span>Nom de cet appareil</span>
      <input type="text" name="label" value="${esc(defaultLabel())}" maxlength="40" required></label>
    ${errorBox}
    <button type="submit" class="btn btn-primary btn-wide btn-big">Ouvrir</button>
    <button type="button" class="btn btn-secondary btn-wide" data-other-account>Utiliser un autre compte</button>
  </form>`);

const faceIdHtml = () => frame(`<section class="card form">
    <h1>Ouvrir l’app avec Face ID ou Touch ID ?</h1>
    <p>Ensuite, un simple regard suffit pour ouvrir Mon Budget. La phrase de secours reste la clé de secours.</p>
    <p class="note">Si l’iPad demande où enregistrer la clé, choisissez <strong>Mots de passe</strong> (Apple) : les apps de mots de passe externes ne permettent souvent pas d’ouvrir les données.</p>
    <p class="note">L’app se verrouille toute seule une minute après l’avoir quittée.</p>
    ${errorBox}
    <button type="button" class="btn btn-primary btn-wide btn-big" data-enable-faceid>${icon('cadenas')}Activer Face ID ou Touch ID</button>
    <button type="button" class="btn btn-secondary btn-wide" data-skip-faceid>Plus tard</button>
  </section>`);

const lockedHtml = (dev) => frame(`<section class="card form lock-card">
    <span class="round-icon">${icon('cadenas')}</span>
    <h1>Mon Budget est verrouillé</h1>
    ${dev?.passkey ? `<button type="button" class="btn btn-primary btn-wide btn-big" data-faceid>${icon('cadenas')}Ouvrir avec Face ID ou Touch ID</button>` : ''}
    ${errorBox}
    <form class="form" data-unlock ${dev?.passkey ? 'hidden' : ''}>
      <label class="field"><span>Phrase de secours</span>
        <input type="password" name="p" autocomplete="current-password" required></label>
      <button type="submit" class="btn btn-${dev?.passkey ? 'secondary' : 'primary'} btn-wide">Ouvrir avec la phrase de secours</button>
    </form>
    ${dev?.passkey ? '<button type="button" class="btn btn-secondary btn-wide" data-show-phrase>Utiliser la phrase de secours</button>' : ''}
  </section>`);

function defaultLabel() {
  const ua = navigator.userAgent;
  if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  return 'Appareil';
}

/* ---------- Affichage ---------- */

function show(html) {
  const r = root();
  r.innerHTML = html;
  r.hidden = false;
  shell().hidden = true;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  r.querySelector('input:not([type=checkbox]):not([value]), input[type=email]')?.focus({ preventScroll: true });
}

function hide() {
  const wasShown = !root().hidden;
  root().hidden = true;
  root().innerHTML = '';
  shell().hidden = false;
  if (wasShown) onOpenCb?.();
}

/** L'écran plein écran (connexion, verrou, proposition Face ID) est-il affiché ? */
export const lockScreenShown = () => !root().hidden;

async function paint() {
  const { phase } = session.getState();
  if (phase === 'demarrage') return show(frame('<p class="note">Un instant…</p>'));
  if (phase === 'ouvert') {
    if (offerFaceId) return paintFaceIdOffer();
    return hide();
  }
  if (phase === 'verrouille') return paintLocked();
  // Connexion (appareil pas configuré)
  if (step === 'creer') return paintCreate();
  if (step === 'rejoindre') return paintJoin();
  return paintLogin();
}

function paintLogin() {
  show(loginHtml());
  root().querySelector('[data-login]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      step = await busy(e.target.querySelector('[type=submit]'), 'Connexion…', () => session.signIn(f.get('email'), f.get('password')));
      paint();
    } catch (ex) { showError(ex); }
  });
}

function paintCreate() {
  show(createHtml());
  root().querySelector('[data-create]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p1 = normalizePassphrase(f.get('p1'));
    if (p1 !== normalizePassphrase(f.get('p2'))) return showError('Les deux phrases ne sont pas identiques. Retapez-les.');
    const problem = passphraseProblem(p1);
    if (problem) return showError(problem);
    const ok = await confirmer({
      titre: 'Avez-vous écrit la phrase de secours ?',
      message: 'Sans elle (et sans Face ID ou Touch ID), vos données ne pourront jamais être ouvertes.',
      ok: 'Oui, elle est écrite', non: 'Non, attendre',
    });
    if (!ok) return;
    const label = String(f.get('label') || defaultLabel()).trim();
    try {
      await busy(e.target.querySelector('[type=submit]'), 'Création de votre espace…', async () => {
        if (await session.faceIdAvailable()) offerFaceId = { p: p1, label };
        await session.createSpace(p1);
      });
    } catch (ex) { offerFaceId = null; showError(ex); }
  });
}

function paintJoin() {
  show(joinHtml());
  const form = root().querySelector('[data-join]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const label = String(f.get('label') || defaultLabel()).trim();
    try {
      await busy(form.querySelector('[type=submit]'), 'Ouverture…', async () => {
        if (await session.faceIdAvailable()) offerFaceId = { p: f.get('p'), label };
        await session.joinSpace(f.get('p'));
      });
    } catch (ex) { offerFaceId = null; showError(ex); }
  });
  form.querySelector('[data-other-account]').addEventListener('click', async () => {
    await session.signOut();
    step = 'login';
    paint();
  });
}

function paintFaceIdOffer() {
  show(faceIdHtml());
  const r = root();
  r.querySelector('[data-skip-faceid]').addEventListener('click', () => { offerFaceId = null; paint(); });
  r.querySelector('[data-enable-faceid]').addEventListener('click', async (e) => {
    try {
      await busy(e.currentTarget, 'Face ID ou Touch ID…', () => session.enableFaceId(offerFaceId.p, offerFaceId.label));
      offerFaceId = null;
      paint();
    } catch (ex) { showError(ex); }
  });
}

async function paintLocked() {
  const dev = await session.device();
  show(lockedHtml(dev));
  const r = root();
  const unlockForm = r.querySelector('[data-unlock]');
  const faceBtn = r.querySelector('[data-faceid]');
  const tryFaceId = async (silent) => {
    try {
      await busy(faceBtn, 'Face ID ou Touch ID…', () => session.unlockWithFaceId());
    } catch (ex) { if (!silent) showError(ex); }
  };
  faceBtn?.addEventListener('click', () => tryFaceId(false));
  r.querySelector('[data-show-phrase]')?.addEventListener('click', (e) => {
    unlockForm.hidden = false;
    e.currentTarget.hidden = true;
    unlockForm.querySelector('input').focus();
  });
  unlockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(unlockForm);
    try {
      await busy(unlockForm.querySelector('[type=submit]'), 'Ouverture…', () => session.unlockWithPassphrase(f.get('p')));
    } catch (ex) { showError(ex); }
  });
  // Face ID proposé tout de suite (si l'iPad le permet sans toucher ; sinon le bouton reste).
  if (faceBtn && !autoTried && document.visibilityState === 'visible') {
    autoTried = true;
    tryFaceId(true);
  }
}

/** Branche les écrans sur la session. `onOpen` : appelé quand l'app s'ouvre (redessiner l'écran). */
export function initLockScreens({ onOpen, onLock }) {
  onOpenCb = onOpen;
  let last = null;
  document.addEventListener('session', (e) => {
    const { phase } = e.detail;
    if (phase === last) return;
    if (phase === 'verrouille') { autoTried = false; onLock?.(); }
    if (phase === 'connexion') { step = 'login'; onLock?.(); }
    last = phase;
    paint();
  });
  // Aperçu du sélecteur d'apps : rien de lisible quand l'app passe en arrière-plan.
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('masque', document.visibilityState === 'hidden');
  });
}

/** Déconnexion depuis Réglages (efface l'appareil). */
export async function confirmSignOut() {
  const n = await session.pendingCount();
  if (n) {
    try { await session.syncNow(); } catch { /* voir ci-dessous */ }
  }
  const left = await session.pendingCount();
  const ok = await confirmer({
    titre: 'Se déconnecter et effacer cet appareil ?',
    message: left
      ? `Attention : ${left} changement(s) n’ont pas encore pu être envoyés et seront PERDUS. Connectez-vous à Internet et réessayez plutôt.`
      : 'Les données de cet appareil seront effacées. Elles restent dans votre espace en ligne : reconnectez-vous pour les retrouver.',
    ok: left ? 'Effacer quand même' : 'Se déconnecter', non: 'Annuler', danger: true,
  });
  if (!ok) return false;
  await session.signOut();
  return true;
}
