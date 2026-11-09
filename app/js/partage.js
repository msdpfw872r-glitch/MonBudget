/**
 * partage.js — Envoyer un fichier : « Enregistrer dans Fichiers » (partage de l'iPad), sinon téléchargement.
 *
 * Version : 0.6.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.5.1  FRE (Fidag)  Sorti de ecran-resume.js (utilisé aussi par le Journal).
 *   0.6.0  FRE (Fidag)  Type de fichier au choix ; renvoie « partagé », « annulé » ou « téléchargé ».
 */

/**
 * Partage le fichier (menu Partager : « Enregistrer dans Fichiers », un raccourci…) ou, à défaut, le télécharge.
 * @returns {Promise<'shared'|'cancelled'|'downloaded'>}
 */
export async function shareOrDownload(text, fileName, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const file = new File([blob], fileName, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'; // la personne a fermé le partage
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

