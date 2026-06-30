import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC9h49-3J9sMXRJ4Vdp904k62YPJBHREOo",
  authDomain: "khuntest-lab-e5966.firebaseapp.com",
  projectId: "khuntest-lab-e5966",
  storageBucket: "khuntest-lab-e5966.firebasestorage.app",
  messagingSenderId: "916565216779",
  appId: "1:916565216779:web:2cf3a49f14828fd6b1c10e"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
