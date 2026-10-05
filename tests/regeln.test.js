// Tests der Security Rules im Firebase-Emulator (nie gegen ein echtes Projekt).
// Start:  firebase emulators:exec --only firestore --project demo-futterrechner "node --test tests/regeln.test.js"
const { test, before, beforeEach, after } = require("node:test");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch, serverTimestamp, increment, setLogLevel
} = require("firebase/firestore");
setLogLevel("silent"); // erwartete „PERMISSION_DENIED“-Meldungen nicht ausgeben

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-futterrechner",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 }
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  // Ausgangslage: Betrieb A mit Gerät a1 und a2, Betrieb B mit Gerät b1
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [bid, geraete] of [["A", ["a1", "a2"]], ["B", ["b1"]]]) {
      await setDoc(doc(db, "betriebe", bid), { name: "Betrieb " + bid });
      await setDoc(doc(db, `betriebe/${bid}/daten/futter`), { inhalt: { kuehe: { anz: 100 } } });
      await setDoc(doc(db, `betriebe/${bid}/daten/lager`), { inhalt: { agf: { bestand: 1000 } } });
      await setDoc(doc(db, `betriebe/${bid}/history/h1`), { e: { datum: "01.10.2026" }, s: 1 });
      await setDoc(doc(db, `betriebe/${bid}/lieferungen/l1`), { e: { menge: 5 }, s: 1 });
      for (const g of geraete) {
        await setDoc(doc(db, `betriebe/${bid}/geraete/${g}`), { name: g });
        await setDoc(doc(db, `geraetezuordnung/${g}`), { betriebId: bid });
      }
    }
  });
});
after(async () => { await env.cleanup(); });

const als = uid => env.authenticatedContext(uid).firestore();
const anonym = () => env.unauthenticatedContext().firestore();

// ---------- Phase 1: strikte Trennung der Betriebe ----------
test("Gerät aus Betrieb A liest und schreibt eigene Daten", async () => {
  const db = als("a1");
  await assertSucceeds(getDoc(doc(db, "betriebe/A/daten/futter")));
  await assertSucceeds(setDoc(doc(db, "betriebe/A/daten/futter"), { inhalt: { kuehe: { anz: 101 } } }));
  await assertSucceeds(setDoc(doc(db, "betriebe/A/daten/lager"), { inhalt: { agf: { bestand: increment(-5) } } }, { merge: true }));
  await assertSucceeds(getDocs(collection(db, "betriebe/A/history")));
  await assertSucceeds(setDoc(doc(db, "betriebe/A/history/h2"), { e: { datum: "02.10.2026" }, s: 2 }));
  await assertSucceeds(deleteDoc(doc(db, "betriebe/A/history/h1")));
  await assertSucceeds(setDoc(doc(db, "betriebe/A/lieferungen/l2"), { e: { menge: 7 }, s: 2 }));
  await assertSucceeds(getDocs(collection(db, "betriebe/A/geraete")));
  await assertSucceeds(getDoc(doc(db, "geraetezuordnung/a1")));
});

test("Gerät aus Betrieb A kann Betrieb B weder lesen noch schreiben", async () => {
  const db = als("a1");
  await assertFails(getDoc(doc(db, "betriebe/B")));
  await assertFails(getDoc(doc(db, "betriebe/B/daten/futter")));
  await assertFails(setDoc(doc(db, "betriebe/B/daten/futter"), { inhalt: {} }));
  await assertFails(getDocs(collection(db, "betriebe/B/history")));
  await assertFails(setDoc(doc(db, "betriebe/B/history/x"), { e: {} }));
  await assertFails(deleteDoc(doc(db, "betriebe/B/history/h1")));
  await assertFails(getDocs(collection(db, "betriebe/B/lieferungen")));
  await assertFails(getDocs(collection(db, "betriebe/B/geraete")));
  await assertFails(deleteDoc(doc(db, "betriebe/B/geraete/b1")));
  await assertFails(getDoc(doc(db, "geraetezuordnung/b1")));
  await assertFails(deleteDoc(doc(db, "geraetezuordnung/b1")));
});

test("Gerät kann sich nicht selbst in einen fremden Betrieb eintragen", async () => {
  const db = als("a1");
  await assertFails(setDoc(doc(db, "betriebe/B/geraete/a1"), { name: "Eindringling" }));
  await assertFails(setDoc(doc(db, "geraetezuordnung/a1"), { betriebId: "B" }));
  const fremd = als("fremd");
  await assertFails(setDoc(doc(db, "betriebe/A/geraete/fremd"), { name: "x" }));
  await assertFails(setDoc(doc(fremd, "betriebe/A/geraete/fremd"), { name: "x" }));
  await assertFails(setDoc(doc(fremd, "geraetezuordnung/fremd"), { betriebId: "A" }));
});

test("Fremdes Gerät (in keinem Betrieb) kann gar nichts", async () => {
  const db = als("fremd");
  await assertFails(getDoc(doc(db, "betriebe/A")));
  await assertFails(getDoc(doc(db, "betriebe/A/daten/futter")));
  await assertFails(getDocs(collection(db, "betriebe")));
  await assertFails(setDoc(doc(db, "betriebe/C"), { name: "neu" }));
  await assertFails(getDocs(collection(db, "geraetezuordnung")));
});

test("Ohne Anmeldung geht gar nichts", async () => {
  const db = anonym();
  await assertFails(getDoc(doc(db, "betriebe/A/daten/futter")));
  await assertFails(getDoc(doc(db, "geraetezuordnung/a1")));
  await assertFails(setDoc(doc(db, "betriebe/X"), { name: "x" }));
});

test("Nur erlaubte Daten-Dokumente", async () => {
  const db = als("a1");
  await assertFails(setDoc(doc(db, "betriebe/A/daten/sonstwas"), { inhalt: {} }));
  await assertFails(setDoc(doc(db, "betriebe/A/fremdsammlung/x"), { a: 1 }));
});

test("Betrieb: nur Name änderbar, nicht löschbar", async () => {
  const db = als("a1");
  await assertSucceeds(updateDoc(doc(db, "betriebe/A"), { name: "Hof Müller" }));
  await assertFails(updateDoc(doc(db, "betriebe/A"), { sonstwas: 1 }));
  await assertFails(deleteDoc(doc(db, "betriebe/A")));
});

test("Entferntes Gerät verliert sofort den Zugriff", async () => {
  const a1 = als("a1");
  const batch = writeBatch(a1);
  batch.delete(doc(a1, "betriebe/A/geraete/a2"));
  batch.delete(doc(a1, "geraetezuordnung/a2"));
  await assertSucceeds(batch.commit());
  const a2 = als("a2");
  await assertFails(getDoc(doc(a2, "betriebe/A/daten/futter")));
  await assertFails(setDoc(doc(a2, "betriebe/A/history/x"), { e: {} }));
  await assertFails(getDocs(collection(a2, "betriebe/A/geraete")));
  // a1 hat weiterhin Zugriff
  await assertSucceeds(getDoc(doc(a1, "betriebe/A/daten/futter")));
});

test("Gerät kann sich selbst abmelden", async () => {
  const a2 = als("a2");
  const batch = writeBatch(a2);
  batch.delete(doc(a2, "betriebe/A/geraete/a2"));
  batch.delete(doc(a2, "geraetezuordnung/a2"));
  await assertSucceeds(batch.commit());
});
