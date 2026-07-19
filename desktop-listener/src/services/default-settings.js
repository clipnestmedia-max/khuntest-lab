"use strict";

function defaultAnalyzer() {
  return {
    id: "mindray-bc5000",
    name: "Mindray BC5000",
    model: "BC-5000",
    protocol: "HL7",
    connectionType: "LAN",
    host: "0.0.0.0",
    port: 5001,
    reconnectAutomatically: true,
    enabled: true
  };
}

function defaultSettings() {
  return {
    firebase: {
      apiKey: "AIzaSyC9h49-3J9sMXRJ4Vdp904k62YPJBHREOo",
      authDomain: "khuntest-lab-e5966.firebaseapp.com",
      projectId: "khuntest-lab-e5966",
      storageBucket: "khuntest-lab-e5966.firebasestorage.app",
      messagingSenderId: "916565216779",
      appId: "1:916565216779:web:2cf3a49f14828fd6b1c10e"
    },
    lab: {
      labId: "KHUNTEST-LAB"
    },
    listener: {
      autoStart: true,
      darkMode: false,
      autoUpdate: true
    },
    analyzers: [defaultAnalyzer()]
  };
}

module.exports = { defaultSettings, defaultAnalyzer };
