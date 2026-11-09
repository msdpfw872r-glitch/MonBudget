/**
 * ui.js — Petits outils d'interface partagés : icônes, échappement du texte, confirmation.
 *
 * Version : 0.5.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.3.0  FRE (Fidag)  Première version (icônes sorties de main.js, fenêtre de confirmation).
 *   0.4.0  FRE (Fidag)  Icônes « ok » et « carte ».
 *   0.4.2  FRE (Fidag)  Icône « loupe ».
 *   0.5.0  FRE (Fidag)  Confirmation : texte du bouton « non » au choix ; icône « exporter ».
 */

/* Icônes au trait (même dessin que la maquette). */
const ICONS = {
  accueil: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  trier: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  journal: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  resume: '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>',
  importer: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>',
  reglages: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  retour: '<path d="M15 6l-6 6 6 6"/>',
  suite: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sauvegarde: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  loupe: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  exporter: '<path d="M12 4v11M7 9l5-5 5 5"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  ok: '<path d="M5 12l5 5 9-10"/>',
  carte: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
  attention: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
};

export const icon = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24">${ICONS[name]}</svg>`;

/** Échappe un texte avant de le mettre dans du HTML (noms saisis par la personne). */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Demande une confirmation dans une fenêtre en gros caractères.
 * @returns {Promise<boolean>} vrai si la personne confirme.
 */
export function confirmer({ titre, message, ok = 'Confirmer', non = 'Annuler', danger = false }) {
  const d = document.getElementById('confirmer');
  d.querySelector('h2').textContent = titre;
  d.querySelector('p').textContent = message;
  const okBtn = d.querySelector('[data-ok]');
  okBtn.textContent = ok;
  d.querySelector('[data-annuler]').textContent = non;
  okBtn.classList.toggle('btn-danger', danger);
  okBtn.classList.toggle('btn-primary', !danger);
  d.returnValue = '';
  d.showModal();
  d.querySelector('[data-annuler]').focus();
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
  });
}
