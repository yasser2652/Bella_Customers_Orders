import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const FIREBASE_NOT_CONFIGURED_CODE = "FIREBASE_NOT_CONFIGURED";
export const AUTHORIZED_BELLA_USER_UID = "DpDO8x2lERecpHYKdj9jGcXB4y52";

const FIREBASE_ENV_FIELDS = [
  ["apiKey", "REACT_APP_FIREBASE_API_KEY", "VITE_FIREBASE_API_KEY"],
  ["authDomain", "REACT_APP_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_AUTH_DOMAIN"],
  ["projectId", "REACT_APP_FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID"],
  [
    "storageBucket",
    "REACT_APP_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_STORAGE_BUCKET"
  ],
  [
    "messagingSenderId",
    "REACT_APP_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_MESSAGING_SENDER_ID"
  ],
  ["appId", "REACT_APP_FIREBASE_APP_ID", "VITE_FIREBASE_APP_ID"]
];

let appInstance = null;

function readEnvValue(...names) {
  const env = import.meta.env || {};
  const matchedName = names.find((name) => String(env[name] || "").trim());

  return matchedName ? String(env[matchedName]).trim() : "";
}

export function getFirebaseConfigStatus() {
  const config = FIREBASE_ENV_FIELDS.reduce(
    (currentConfig, [key, reactName, viteName]) => {
      currentConfig[key] = readEnvValue(reactName, viteName);
      return currentConfig;
    },
    {}
  );
  const missing = FIREBASE_ENV_FIELDS.filter(
    ([key]) => !config[key]
  ).map(([, reactName]) => reactName);

  return {
    configured: missing.length === 0,
    missing,
    config
  };
}

export function getFirebaseAppInstance() {
  const status = getFirebaseConfigStatus();

  if (!status.configured) {
    const error = new Error("Firebase is not configured.");
    error.code = FIREBASE_NOT_CONFIGURED_CODE;
    error.missing = status.missing;
    throw error;
  }

  if (!appInstance) {
    appInstance = getApps().length
      ? getApps()[0]
      : initializeApp(status.config);
  }

  return appInstance;
}

export function getFirebaseAuthInstance() {
  return getAuth(getFirebaseAppInstance());
}

export function getFirestoreDb() {
  return getFirestore(getFirebaseAppInstance());
}

export function isAuthorizedBellaUser(user) {
  return Boolean(user && user.uid === AUTHORIZED_BELLA_USER_UID);
}

export function createUnauthorizedUserError() {
  const error = new Error("This Firebase account is not authorized for Bella Customer Orders.");
  error.code = "auth/not-authorized";
  error.allowedUid = AUTHORIZED_BELLA_USER_UID;
  return error;
}

export function subscribeToBellaAuthState(onChange, onError) {
  try {
    return onAuthStateChanged(getFirebaseAuthInstance(), onChange, onError);
  } catch (error) {
    onError(error);
    return () => {};
  }
}

export async function signInBellaEmail(email, password) {
  const auth = getFirebaseAuthInstance();
  const credential = await signInWithEmailAndPassword(
    auth,
    String(email || "").trim(),
    password
  );

  if (!isAuthorizedBellaUser(credential.user)) {
    await signOut(auth);
    throw createUnauthorizedUserError();
  }

  return credential.user;
}

export async function signInBellaGoogle() {
  const auth = getFirebaseAuthInstance();
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);

  if (!isAuthorizedBellaUser(credential.user)) {
    await signOut(auth);
    throw createUnauthorizedUserError();
  }

  return credential.user;
}

export async function signOutBellaUser() {
  await signOut(getFirebaseAuthInstance());
}

export async function ensureAuthorizedFirebaseUser() {
  const auth = getFirebaseAuthInstance();

  if (isAuthorizedBellaUser(auth.currentUser)) {
    return auth.currentUser;
  }

  throw createUnauthorizedUserError();
}

