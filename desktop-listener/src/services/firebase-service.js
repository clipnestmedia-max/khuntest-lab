"use strict";

const admin = require("firebase-admin");
const { initializeApp } = require("firebase/app");
const {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} = require("firebase/auth");
const {
  getFirestore,
  collection,
  addDoc,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp
} = require("firebase/firestore");

class FirebaseService {
  constructor(appStore, logger) {
    this.appStore = appStore;
    this.logger = logger;
    this.clientApp = null;
    this.auth = null;
    this.user = null;
    this.clientDb = null;
    this.db = null;
    this.connected = false;
    this.lastSyncTime = "";
  }

  initClient() {
    if (this.clientApp) return;
    this.clientApp = initializeApp(this.appStore.get("firebase"));
    this.auth = getAuth(this.clientApp);
    this.clientDb = getFirestore(this.clientApp);
    onAuthStateChanged(this.auth, (user) => {
      this.user = user ? { uid: user.uid, email: user.email } : null;
    });
  }

  async restoreSession() {
    this.initClient();
    const saved = this.appStore.getAuth();
    if (saved?.email && saved?.password && saved?.remember) {
      await this.login(saved).catch((err) => this.logger.warn("auth", "Saved login failed", { details: err.message }));
    }
  }

  async login({ email, password, remember }) {
    this.initClient();
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    this.user = { uid: credential.user.uid, email: credential.user.email };
    if (remember) this.appStore.setAuth({ email, password, remember: true });
    if (!remember) this.appStore.setAuth(null);
    await this.initAdminIfConfigured();
    this.connected = true;
    this.logger.info("auth", "Logged in", { patient: credential.user.email });
    return { ok: true, user: this.user };
  }

  async logout() {
    if (this.auth) await signOut(this.auth);
    this.user = null;
    this.connected = false;
    this.appStore.setAuth(null);
  }

  async initAdminIfConfigured() {
    const serviceAccount = this.appStore.get("firebase.serviceAccount");
    if (!serviceAccount || admin.apps.length) return;
    const projectId = this.appStore.get("firebase.projectId");
    admin.initializeApp({ projectId, credential: admin.credential.cert(serviceAccount) });
    this.db = admin.firestore();
  }

  async uploadMachineResult(item) {
    if (!this.clientDb && !this.db) throw new Error("Firebase is not connected. Login first.");
    const { rawMessage, parsed, analyzer } = item.payload || item;
    const booking = await this.findBooking(parsed);
    const machineDoc = {
      source: analyzer?.name || parsed.source || "Mindray BC-5000",
      analyzerModel: analyzer?.model || parsed.analyzerModel || "BC-5000",
      protocol: parsed.protocol || analyzer?.protocol || "HL7",
      sampleId: parsed.sampleId || "",
      billNo: parsed.billNo || parsed.sampleId || "",
      patientName: parsed.patientName || "",
      patientId: parsed.patientId || "",
      testDate: parsed.testDate || "",
      analyzerName: parsed.analyzerName || analyzer?.name || "Mindray BC-5000",
      labId: this.appStore.get("lab.labId", "KHUNTEST-LAB"),
      receivedAt: this.timestamp(),
      status: "received",
      matchStatus: booking ? "matched" : "unmatched",
      bookingId: booking?.id || "",
      rawMessage,
      parsedResults: parsed.results || []
    };
    const machineRef = await this.add("machineResults", machineDoc);
    if (booking) await this.createDraftReport(machineRef.id, booking, parsed);
    this.lastSyncTime = new Date().toISOString();
    this.logger.info("firebase", "Uploaded machine result", {
      analyzer: machineDoc.analyzerName,
      patient: machineDoc.patientName,
      sample: machineDoc.sampleId
    });
    return { ok: true, machineResultId: machineRef.id, matched: Boolean(booking), bookingId: booking?.id || "" };
  }

  async findBooking(parsed) {
    const candidates = [parsed.billNo, parsed.sampleId].filter(Boolean).map(String);
    for (const value of candidates) {
      const rows = await this.queryBy("bookings", "billNo", value);
      if (rows.length) return rows[0];
    }
    return null;
  }

  async createDraftReport(machineResultId, booking, parsed) {
    const billNo = booking.billNo || parsed.billNo || parsed.sampleId || "";
    const reportDraft = {
      billNo,
      bookingId: booking.id,
      patientName: booking.patientName || parsed.patientName || "",
      patientEmail: booking.patientEmail || booking.email || "",
      phone: booking.phone || "",
      whatsapp: booking.whatsapp || booking.phone || "",
      age: booking.age || "",
      gender: booking.gender || "",
      doctor: booking.doctor || "",
      refBy: booking.refBy || booking.doctor || "",
      collectionDate: booking.collDate || booking.collectionDate || booking.date || "",
      reportingDate: new Date().toISOString(),
      tests: booking.selectedTests || booking.tests || [{ testCode: "CBC", name: "COMPLETE BLOOD COUNT(CBC)", category: "HAEMATOLOGY" }],
      selectedTests: booking.selectedTests || booking.tests || [],
      results: mapMachineResultsToReport(parsed),
      reportStatus: "Draft",
      status: "Draft",
      source: "machine",
      machineResultId,
      machineImportedAt: this.timestamp(),
      updatedAt: this.timestamp(),
      createdAt: this.timestamp()
    };
    await this.set("reports", String(billNo), reportDraft, { merge: true });
    await this.set("bookings", booking.id, {
      status: "Report Entry",
      machineResultReceived: true,
      machineResultId,
      updatedAt: this.timestamp()
    }, { merge: true });
    await this.set("machineResults", machineResultId, { reportBillNo: billNo }, { merge: true });
  }

  timestamp() {
    return this.db ? admin.firestore.FieldValue.serverTimestamp() : serverTimestamp();
  }

  async add(name, payload) {
    if (this.db) return this.db.collection(name).add(payload);
    return addDoc(collection(this.clientDb, name), payload);
  }

  async set(name, id, payload, options) {
    if (this.db) return this.db.collection(name).doc(String(id)).set(payload, options);
    return setDoc(doc(this.clientDb, name, String(id)), payload, options);
  }

  async queryBy(name, field, value) {
    if (this.db) {
      const snap = await this.db.collection(name).where(field, "==", value).limit(1).get();
      return snap.docs.map((row) => ({ id: row.id, ...row.data() }));
    }
    const snap = await getDocs(query(collection(this.clientDb, name), where(field, "==", value), limit(1)));
    return snap.docs.map((row) => ({ id: row.id, ...row.data() }));
  }

  status() {
    return {
      connected: this.connected,
      user: this.user,
      lastSyncTime: this.lastSyncTime
    };
  }
}

function mapMachineResultsToReport(parsed) {
  return (parsed.results || []).map((row) => ({
    category: "HAEMATOLOGY",
    testName: "COMPLETE BLOOD COUNT(CBC)",
    parameterName: row.khunTestName || row.name || row.code || "Result",
    resultValue: row.value || "",
    normalRange: row.normalRange || "",
    unit: row.unit || "",
    method: "Machine: Mindray BC-5000",
    sample: "W.B. EDTA",
    abnormalFlag: row.abnormalFlag || "",
    code: row.code || "",
    source: "machine"
  }));
}

module.exports = { FirebaseService, mapMachineResultsToReport };
