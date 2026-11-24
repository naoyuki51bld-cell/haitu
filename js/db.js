import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export { where, orderBy, limit, serverTimestamp, deleteField };

export const configured =
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('YOUR-') &&
  !!firebaseConfig.projectId && !firebaseConfig.projectId.includes('YOUR-');

const app = configured ? initializeApp(firebaseConfig) : null;
const auth = app && getAuth(app);
const fs = app && getFirestore(app);

/** Firestore のドキュメントを普通のオブジェクトに（日時は ISO 文字列に） */
function plain(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
const toPlain = (snap) => ({ id: snap.id, ...plain(snap.data()) });

export const db = {
  async list(name, ...constraints) {
    const ref = collection(fs, name);
    const snap = await getDocs(constraints.length ? query(ref, ...constraints) : ref);
    return snap.docs.map(toPlain);
  },
  async get(name, id) {
    const snap = await getDoc(doc(fs, name, id));
    return snap.exists() ? toPlain(snap) : null;
  },
  async add(name, data) {
    const ref = await addDoc(collection(fs, name), { ...data, created_at: serverTimestamp() });
    return ref.id;
  },
  /** merge: true なので、書かなかった項目は残る */
  set: (name, id, data) => setDoc(doc(fs, name, id), data, { merge: true }),
  update: (name, id, data) => updateDoc(doc(fs, name, id), data),
  remove: (name, id) => deleteDoc(doc(fs, name, id)),
};

export const authApi = {
  ready: () => auth.authStateReady(),
  user: () => auth.currentUser,
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => signOut(auth),
  updatePassword: (pw) => updatePassword(auth.currentUser, pw),
};
