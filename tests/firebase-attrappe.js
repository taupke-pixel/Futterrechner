// Firebase-Attrappe NUR für den Vergleichstest der alten Fassung (ohne Cloud-Speicher).
// Ersetzt firebase-app.js / firebase-firestore.js, damit der Test nie die echte Datenbank anfragt.
// Jedes Gerät gilt als freigegeben.
(function () {
  if (window.firebase) return;
  function doc(id) {
    return {
      id: id || "attrappe",
      get: async () => ({ exists: true, data: () => ({ status: "erlaubt", deviceID: "x" }) }),
      set: async () => {},
      update: async () => {}
    };
  }
  window.firebase = {
    initializeApp() {},
    firestore() {
      return { collection: () => ({ doc, add: async () => doc("neu") }) };
    }
  };
})();
