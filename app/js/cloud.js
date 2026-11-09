/**
 * cloud.js — Adaptateur Firebase : connexion (Auth) et documents chiffrés (Firestore lite).
 *
 * Version : 0.12.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Fournit l'objet « remote » attendu par app/src/core/synchro.js. Le SDK est chargé à la demande
 * (seulement si la synchronisation est utilisée) depuis la copie locale app/vendor/firebase/13.2.0/.
 * Rien n'est envoyé en clair : les documents arrivent ici déjà chiffrés.
 *
 * Historique :
 *   0.8.5  FRE (Fidag)  Première version.
 *   0.12.0 FRE (Fidag)  Copies de sécurité en ligne (users/{uid}/copies).
 */

import { FIREBASE_CONFIG, ALLOWED_UID } from './firebase-config.js';
import { BATCH } from '../src/core/synchro.js';

const SDK = '../vendor/firebase/13.2.0/'; // relatif à ce fichier (app/js/)
let sdk = null;

/** Erreur à montrer telle quelle. */
export class CloudError extends Error {}

/** Charge Firebase une seule fois. */
async function load() {
  if (sdk) return sdk;
  const [appMod, authMod, fs] = await Promise.all([
    import(`${SDK}firebase-app.js`), import(`${SDK}firebase-auth.js`), import(`${SDK}firebase-firestore-lite.js`),
  ]);
  const app = appMod.initializeApp(FIREBASE_CONFIG);
  const auth = authMod.initializeAuth(app, { persistence: authMod.browserLocalPersistence });
  auth.languageCode = 'fr';
  const db = fs.getFirestore(app);
  // Attendre que la session enregistrée soit relue.
  await new Promise((resolve) => { const stop = authMod.onAuthStateChanged(auth, () => { stop(); resolve(); }); });
  sdk = { authMod, fs, auth, db };
  return sdk;
}

/** Message en mots simples pour une erreur Firebase. */
export function friendlyError(e) {
  if (e instanceof CloudError) return e.message;
  const code = String(e?.code ?? '');
  if (/network-request-failed|unavailable|deadline-exceeded/.test(code) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return 'Pas de connexion à Internet. Vos changements sont gardés sur l’iPad et partiront plus tard.';
  }
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(code)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/too-many-requests/.test(code)) return 'Trop d’essais. Attendez quelques minutes, puis réessayez.';
  if (/user-disabled/.test(code)) return 'Ce compte est désactivé.';
  if (/permission-denied|unauthenticated/.test(code)) return 'Ce compte n’a pas accès aux données. Reconnectez-vous.';
  if (/resource-exhausted/.test(code)) return 'La limite gratuite du jour est atteinte. La synchronisation reprendra demain.';
  return e?.message && !code ? e.message : 'La synchronisation n’a pas marché. Réessayez plus tard.';
}

/** Utilisateur connecté (ou null). */
export async function currentUser() {
  const { auth } = await load();
  return auth.currentUser ? { uid: auth.currentUser.uid, email: auth.currentUser.email } : null;
}

/** Connexion par e-mail et mot de passe (pas d'inscription : le compte est créé dans la console). */
export async function signIn(email, password) {
  const { authMod, auth } = await load();
  try {
    const cred = await authMod.signInWithEmailAndPassword(auth, String(email).trim(), password);
    if (cred.user.uid !== ALLOWED_UID) {
      await authMod.signOut(auth);
      throw new CloudError('Ce compte ne peut pas être utilisé avec Mon Budget.');
    }
    return { uid: cred.user.uid, email: cred.user.email };
  } catch (e) {
    throw new CloudError(friendlyError(e), { cause: e });
  }
}

export async function signOutCloud() {
  const { authMod, auth } = await load();
  await authMod.signOut(auth);
}

/**
 * Objet « remote » pour synchro.js (chemins users/{uid}/keys et users/{uid}/records).
 * Curseur = heure du serveur du dernier document lu : { s: secondes, n: nanosecondes }.
 */
export async function firestoreRemote(uid) {
  const { fs, db } = await load();
  const keyRef = (name) => fs.doc(db, 'users', uid, 'keys', name);
  const records = fs.collection(db, 'users', uid, 'records');
  const wrap = (fn) => async (...args) => {
    try { return await fn(...args); } catch (e) { throw new CloudError(friendlyError(e), { cause: e }); }
  };
  return {
    getKey: wrap(async (name) => {
      const snap = await fs.getDoc(keyRef(name));
      return snap.exists() ? snap.data() : null;
    }),
    setKey: wrap(async (name, env) => { await fs.setDoc(keyRef(name), env); }),
    listKeys: wrap(async () => (await fs.getDocs(fs.collection(db, 'users', uid, 'keys'))).docs.map((d) => ({ name: d.id, ...d.data() }))),
    pull: wrap(async (cursor) => {
      const q = cursor
        ? fs.query(records, fs.where('syncedAt', '>', new fs.Timestamp(cursor.s, cursor.n)), fs.orderBy('syncedAt'))
        : fs.query(records, fs.orderBy('syncedAt'));
      const snap = await fs.getDocs(q);
      let last = cursor;
      const docs = snap.docs.map((d) => {
        const { v, iv, ct, updatedAt, deleted, syncedAt } = d.data();
        if (syncedAt) last = { s: syncedAt.seconds, n: syncedAt.nanoseconds };
        return { docId: d.id, v, iv, ct, updatedAt, deleted: Boolean(deleted) };
      });
      return { docs, cursor: last };
    }),
    // Copies de sécurité (copies.js) : les morceaux d'abord, la fiche ensuite (une copie sans fiche est invisible).
    listCopies: wrap(async () => (await fs.getDocs(fs.collection(db, 'users', uid, 'copies'))).docs.map((d) => ({ id: d.id, ...d.data() }))),
    putCopy: wrap(async (id, meta, parts) => {
      for (const p of parts) await fs.setDoc(fs.doc(db, 'users', uid, 'copies', id, 'parts', String(p.n)), p);
      await fs.setDoc(fs.doc(db, 'users', uid, 'copies', id), meta);
    }),
    getCopyParts: wrap(async (id) => (await fs.getDocs(fs.collection(db, 'users', uid, 'copies', id, 'parts'))).docs.map((d) => d.data())),
    deleteCopy: wrap(async (id, parts = 0) => {
      const batch = fs.writeBatch(db);
      batch.delete(fs.doc(db, 'users', uid, 'copies', id));
      for (let n = 0; n < parts; n++) batch.delete(fs.doc(db, 'users', uid, 'copies', id, 'parts', String(n)));
      await batch.commit();
    }),
    push: wrap(async (list) => {
      if (list.length > BATCH) throw new Error('lot trop grand');
      const batch = fs.writeBatch(db);
      for (const d of list) {
        batch.set(fs.doc(records, d.docId), { v: d.v, iv: d.iv, ct: d.ct, updatedAt: d.updatedAt, deleted: d.deleted, syncedAt: fs.serverTimestamp() });
      }
      await batch.commit();
    }),
  };
}
