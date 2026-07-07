import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const FIREBASE_NOT_CONFIGURED_CODE = "FIREBASE_NOT_CONFIGURED";

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

export async function ensureAnonymousFirebaseUser() {
  const auth = getFirebaseAuthInstance();

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const credential = await signInAnonymously(auth);
  return credential.user;
}

