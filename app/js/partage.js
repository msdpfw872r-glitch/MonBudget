/**
 * partage.js — Envoyer un fichier : « Enregistrer dans Fichiers » (partage de l'iPad), sinon téléchargement.
 *
 * Version : 0.5.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.5.1  FRE (Fidag)  Sorti de ecran-resume.js (utilisé aussi par le Journal).
 */

/** Partage le fichier (« Enregistrer dans Fichiers ») ou, à défaut, le télécharge. */
export async function shareOrDownload(text, fileName) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], fileName, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // la personne a fermé le partage
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
}

