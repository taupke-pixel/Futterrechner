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
    for (const [bid, geraete] of [["A", ["a1", "a2"]], ["B", ["b1"]], ["F", ["f1"]]]) {
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
    // Betreiber = Betrieb F (Fritz), Gerät f1
    await setDoc(doc(db, "system/betreiber"), { betriebId: "F" });
    await setDoc(doc(db, "zugriffe/alt123"), { status: "erlaubt" });
    // Offene Anfrage von Gerät r1 (ohne Betrieb) und eine von r2
    for (const [id, uid] of [["anf1", "r1"], ["anf2", "r2"]]) {
      await setDoc(doc(db, `anfragen/${id}`), {
        vorname: "Rita", nachname: "Muster", betriebsname: "Hof " + uid, email: uid + "@x.de", uid,
        alteGeraeteId: "", agbFassung: "AGB-1", datenschutzFassung: "DS-1", zeitpunkt: new Date(), status: "offen"
      });
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

// ---------- Phase 2: Zugangsanfrage und Freigabe nur durch den Betreiber ----------
const gueltigeAnfrage = uid => ({
  vorname: "Max", nachname: "Bauer", betriebsname: "Hof Bauer", email: "max@bauer.de", uid,
  alteGeraeteId: "abc", agbFassung: "AGB-1", datenschutzFassung: "DS-1", zeitpunkt: serverTimestamp(), status: "offen"
});

function freigabePaket(db, anfrageId, uid, betriebId, neuerBetrieb) {
  const b = writeBatch(db);
  if (neuerBetrieb) b.set(doc(db, `betriebe/${betriebId}`), { name: "Hof Neu", angelegt: serverTimestamp(), anfrageId });
  b.set(doc(db, `betriebe/${betriebId}/geraete/${uid}`), { name: "Gerät von Rita", seit: serverTimestamp(), anfrageId });
  b.set(doc(db, `geraetezuordnung/${uid}`), { betriebId });
  b.update(doc(db, `anfragen/${anfrageId}`), { status: "erlaubt", betriebId, entschieden: serverTimestamp() });
  return b.commit();
}

test("Neues Gerät stellt eine gültige Anfrage", async () => {
  const db = als("neu1");
  await assertSucceeds(setDoc(doc(db, "anfragen/x1"), gueltigeAnfrage("neu1")));
});

test("Anfrage ohne AGB-/Datenschutz-Fassung, mit fremder uid, eigener Uhrzeit oder schon 'erlaubt' wird abgelehnt", async () => {
  const db = als("neu1");
  const { agbFassung, ...ohneAgb } = gueltigeAnfrage("neu1");
  const { datenschutzFassung, ...ohneDs } = gueltigeAnfrage("neu1");
  await assertFails(setDoc(doc(db, "anfragen/y1"), ohneAgb));
  await assertFails(setDoc(doc(db, "anfragen/y2"), ohneDs));
  await assertFails(setDoc(doc(db, "anfragen/y3"), { ...gueltigeAnfrage("neu1"), agbFassung: "" }));
  await assertFails(setDoc(doc(db, "anfragen/y4"), gueltigeAnfrage("jemandAnders")));
  await assertFails(setDoc(doc(db, "anfragen/y5"), { ...gueltigeAnfrage("neu1"), zeitpunkt: new Date(2020, 0, 1) }));
  await assertFails(setDoc(doc(db, "anfragen/y6"), { ...gueltigeAnfrage("neu1"), status: "erlaubt" }));
  await assertFails(setDoc(doc(db, "anfragen/y7"), { ...gueltigeAnfrage("neu1"), betriebId: "A" }));
  await assertFails(setDoc(doc(anonym(), "anfragen/y8"), gueltigeAnfrage("neu1")));
});

test("Gerät mit Betrieb kann keine Anfrage stellen", async () => {
  await assertFails(setDoc(doc(als("a1"), "anfragen/y9"), gueltigeAnfrage("a1")));
});

test("LÜCKE GESCHLOSSEN: Anfragender kann sich nicht selbst freischalten", async () => {
  const db = als("r1");
  // Status der eigenen Anfrage ändern
  await assertFails(updateDoc(doc(db, "anfragen/anf1"), { status: "erlaubt" }));
  await assertFails(updateDoc(doc(db, "anfragen/anf1"), { status: "erlaubt", betriebId: "A", entschieden: serverTimestamp() }));
  // Selbst einen Betrieb + sich als Gerät anlegen
  await assertFails(freigabePaket(db, "anf1", "r1", "R1", true));
  // Sich in einen bestehenden Betrieb eintragen
  await assertFails(freigabePaket(db, "anf1", "r1", "A", false));
  // Anfrage löschen oder überschreiben (Nachweis der Zustimmung)
  await assertFails(deleteDoc(doc(db, "anfragen/anf1")));
  await assertFails(setDoc(doc(db, "anfragen/anf1"), gueltigeAnfrage("r1")));
  // Altes System
  await assertFails(setDoc(doc(db, "zugriffe/r1"), { status: "erlaubt" }));
  await assertFails(getDoc(doc(db, "zugriffe/alt123")));
  await assertFails(getDoc(doc(db, "system/betreiber")));
  await assertFails(setDoc(doc(db, "system/betreiber"), { betriebId: "R1" }));
});

test("Normales Gerät (nicht Betreiber) kann nicht freigeben und fremde Anfragen nicht lesen", async () => {
  const db = als("a1");
  await assertFails(getDoc(doc(db, "anfragen/anf1")));
  await assertFails(getDocs(collection(db, "anfragen")));
  await assertFails(freigabePaket(db, "anf1", "r1", "NEU", true));
  await assertFails(freigabePaket(db, "anf1", "r1", "A", false));
  await assertFails(updateDoc(doc(db, "anfragen/anf1"), { status: "abgelehnt", entschieden: serverTimestamp() }));
});

test("Anfragender sieht nur die eigene Anfrage", async () => {
  const { query, where } = require("firebase/firestore");
  const db = als("r1");
  await assertSucceeds(getDoc(doc(db, "anfragen/anf1")));
  await assertSucceeds(getDocs(query(collection(db, "anfragen"), where("uid", "==", "r1"))));
  await assertFails(getDoc(doc(db, "anfragen/anf2")));
  await assertFails(getDocs(collection(db, "anfragen")));
});

test("Betreiber gibt frei: neuer Betrieb, Gerät hat danach Zugriff", async () => {
  const f = als("f1");
  await assertSucceeds(getDoc(doc(f, "anfragen/anf1")));
  await assertSucceeds(getDocs(collection(f, "anfragen")));
  await assertSucceeds(getDoc(doc(f, "zugriffe/alt123")));
  await assertSucceeds(freigabePaket(f, "anf1", "r1", "R1", true));
  const r = als("r1");
  await assertSucceeds(getDoc(doc(r, "geraetezuordnung/r1")));
  await assertSucceeds(setDoc(doc(r, "betriebe/R1/daten/futter"), { inhalt: {} }));
  // Schon entschieden → nicht nochmal
  await assertFails(updateDoc(doc(f, "anfragen/anf1"), { status: "abgelehnt", entschieden: serverTimestamp() }));
});

test("Betreiber sieht Betriebsnamen, aber keine Futterdaten fremder Betriebe", async () => {
  const f = als("f1");
  await assertSucceeds(getDocs(collection(f, "betriebe")));
  await assertFails(getDoc(doc(f, "betriebe/A/daten/futter")));
  await assertFails(getDocs(collection(f, "betriebe/A/history")));
  await assertFails(getDocs(collection(f, "betriebe/A/geraete")));
});

test("Betreiber fügt Anfragenden zu bestehendem Betrieb hinzu (z. B. neues Handy)", async () => {
  const f = als("f1");
  await assertSucceeds(freigabePaket(f, "anf2", "r2", "A", false));
  await assertSucceeds(getDoc(doc(als("r2"), "betriebe/A/daten/futter")));
});

test("Betreiber: Freigabe nur passend zur Anfrage", async () => {
  const f = als("f1");
  // Falsches Gerät (uid passt nicht zur Anfrage)
  const b = writeBatch(f);
  b.set(doc(f, "betriebe/A/geraete/fremd"), { name: "x", seit: serverTimestamp(), anfrageId: "anf1" });
  b.set(doc(f, "geraetezuordnung/fremd"), { betriebId: "A" });
  b.update(doc(f, "anfragen/anf1"), { status: "erlaubt", betriebId: "A", entschieden: serverTimestamp() });
  await assertFails(b.commit());
  // Gerät, das schon in einem anderen Betrieb ist
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "anfragen/anf3"), { vorname: "B", nachname: "B", betriebsname: "B", email: "b@b.de", uid: "b1",
      agbFassung: "A", datenschutzFassung: "D", zeitpunkt: new Date(), status: "offen" });
  });
  await assertFails(freigabePaket(f, "anf3", "b1", "A", false));
});

test("Betreiber lehnt ab", async () => {
  const f = als("f1");
  await assertSucceeds(updateDoc(doc(f, "anfragen/anf1"), { status: "abgelehnt", entschieden: serverTimestamp() }));
  const z = await assertSucceeds(getDoc(doc(als("r1"), "geraetezuordnung/r1")));
  if (z.exists()) throw new Error("abgelehntes Gerät hat trotzdem einen Betrieb");
  await assertFails(setDoc(doc(als("r1"), "betriebe/A/daten/futter"), { inhalt: {} }));
});
