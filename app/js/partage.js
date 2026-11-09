/**
 * partage.js — Envoyer un fichier : « Enregistrer dans Fichiers » (partage de l'iPad), sinon téléchargement.
 *
 * Version : 0.6.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.5.1  FRE (Fidag)  Sorti de ecran-resume.js (utilisé aussi par le Journal).
 *   0.6.0  FRE (Fidag)  Type de fichier au choix ; renvoie « partagé », « annulé » ou « téléchargé ».
 *   0.6.1  FRE (Fidag)  Plus de titre partagé (un raccourci l'enregistrait comme 2e fichier « texte ») ;
 *                       « incertain » au lieu de « annulé » : l'iPad répond pareil pour un raccourci et pour une annulation.
 */

/**
 * Partage le fichier (menu Partager : « Enregistrer dans Fichiers », un raccourci…) ou, à défaut, le télécharge.
 * @returns {Promise<'shared'|'unsure'|'downloaded'>}  « unsure » : menu fermé ou raccourci utilisé, on ne peut pas savoir
 */
export async function shareOrDownload(text, fileName, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const file = new File([blob], fileName, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      // Seulement le fichier : un titre serait reçu par un raccourci comme un 2e élément (fichier texte).
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      // L'iPad répond « annulé » aussi quand un raccourci a reçu le fichier : on ne peut pas savoir.
      if (e?.name === 'AbortError') return 'unsure';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

