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
    // Verwaltungs-PIN 123456 für Betrieb A und B
    for (const bid of ["A", "B"]) await setDoc(doc(db, `betriebe/${bid}/geheim/verwaltung`), { pruefwert: sha(nachweis(bid, "123456")), gesetzt: new Date() });
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

const als = uid => { const db = env.authenticatedContext(uid).firestore(); db.__uid = uid; return db; };
const crypto = require("crypto");
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
// Nachweis wie in der App: sha256("futterrechner:" + Betrieb + ":" + PIN); gespeichert wird sha256(Nachweis)
const nachweis = (bid, pin) => sha("futterrechner:" + bid + ":" + pin);
// Gerät gibt die Verwaltungs-PIN ein
const freischalten = (db, bid, uid, pin = "123456") =>
  setDoc(doc(db, `betriebe/${bid}/freischaltung/${uid}`), { nachweis: nachweis(bid, pin), zeit: serverTimestamp() });
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
  await assertSucceeds(freischalten(a1, "A", "a1"));
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

const uidVon = db => db.__uid;
function ablehnen(db, anfrageId, eigeneUid) {
  const b = writeBatch(db);
  b.update(doc(db, `anfragen/${anfrageId}`), { status: "abgelehnt", entschieden: serverTimestamp() });
  b.set(doc(db, `approvals/${anfrageId}`), { aktion: "deny", zeit: serverTimestamp(), geraet: eigeneUid });
  return b.commit();
}

function freigabePaket(db, anfrageId, uid, betriebId, neuerBetrieb) {
  const b = writeBatch(db);
  if (neuerBetrieb) b.set(doc(db, `betriebe/${betriebId}`), { name: "Hof Neu", angelegt: serverTimestamp(), anfrageId });
  b.set(doc(db, `betriebe/${betriebId}/geraete/${uid}`), { name: "Gerät von Rita", seit: serverTimestamp(), anfrageId });
  b.set(doc(db, `geraetezuordnung/${uid}`), { betriebId });
  b.update(doc(db, `anfragen/${anfrageId}`), { status: "erlaubt", betriebId, entschieden: serverTimestamp() });
  b.set(doc(db, `approvals/${anfrageId}`), { aktion: "approve", zeit: serverTimestamp(), geraet: uidVon(db) });
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
  await assertSucceeds(ablehnen(f, "anf1", "f1"));
  const z = await assertSucceeds(getDoc(doc(als("r1"), "geraetezuordnung/r1")));
  if (z.exists()) throw new Error("abgelehntes Gerät hat trotzdem einen Betrieb");
  await assertFails(setDoc(doc(als("r1"), "betriebe/A/daten/futter"), { inhalt: {} }));
});

// ---------- Phase 3: Geräte per PIN / QR-Code ----------
async function einladungAnlegen(code, betriebId, minutenAlt) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), `einladungen/${code}`), {
      betriebId, betriebName: "Betrieb " + betriebId, von: "a1", art: code.length === 8 ? "pin" : "qr",
      erstellt: new Date(Date.now() - minutenAlt * 60000)
    });
  });
}

function einloesen(db, uid, code, betriebId, mitLoeschen = true) {
  const b = writeBatch(db);
  b.set(doc(db, `betriebe/${betriebId}/geraete/${uid}`), { name: "Neues Handy", seit: serverTimestamp(), einladung: code });
  b.set(doc(db, `geraetezuordnung/${uid}`), { betriebId });
  if (mitLoeschen) b.delete(doc(db, `einladungen/${code}`));
  return b.commit();
}

test("Gerät des Betriebs erzeugt PIN- und QR-Einladung, Fremde nicht", async () => {
  const a1 = als("a1");
  await assertSucceeds(freischalten(a1, "A", "a1"));
  const e = { betriebId: "A", betriebName: "Betrieb A", von: "a1", erstellt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(a1, "einladungen/12345678"), { ...e, art: "pin" }));
  await assertSucceeds(setDoc(doc(a1, "einladungen/abcdefghijkmnopqrstuvwxyzABCDEFGH23456"), { ...e, art: "qr" }));
  await assertFails(setDoc(doc(a1, "einladungen/1234abcd"), { ...e, art: "pin" }));          // PIN mit Buchstaben
  await assertFails(setDoc(doc(a1, "einladungen/kurz"), { ...e, art: "qr" }));               // QR zu kurz
  await assertFails(setDoc(doc(a1, "einladungen/22222222"), { ...e, von: "b1", art: "pin" })); // falscher Absender
  await assertFails(setDoc(doc(a1, "einladungen/33333333"), { ...e, erstellt: new Date(Date.now() + 3600000), art: "pin" })); // Uhr manipuliert
  await assertFails(setDoc(doc(a1, "einladungen/44444444"), { ...e, betriebId: "B", art: "pin" })); // für fremden Betrieb
  await assertFails(setDoc(doc(als("fremd"), "einladungen/55555555"), { ...e, von: "fremd", art: "pin" }));
  // Vorhandene PIN überschreiben geht nicht
  await assertFails(setDoc(doc(a1, "einladungen/12345678"), { ...e, art: "pin" }));
});

test("Neues Gerät tritt mit gültiger PIN bei und hat danach Zugriff", async () => {
  await einladungAnlegen("87654321", "A", 1);
  const n = als("n1");
  await assertSucceeds(getDoc(doc(n, "einladungen/87654321")));
  await assertSucceeds(einloesen(n, "n1", "87654321", "A"));
  await assertSucceeds(getDoc(doc(n, "betriebe/A/daten/futter")));
});

test("PIN nur einmal nutzbar", async () => {
  await einladungAnlegen("11112222", "A", 1);
  await assertSucceeds(einloesen(als("n1"), "n1", "11112222", "A"));
  await assertFails(einloesen(als("n2"), "n2", "11112222", "A"));
  await assertFails(getDoc(doc(als("n2"), "betriebe/A/daten/futter")));
});

test("Einladung nach 10 Minuten abgelaufen (Serverzeit)", async () => {
  await einladungAnlegen("99998888", "A", 11);
  await assertFails(einloesen(als("n1"), "n1", "99998888", "A"));
  await einladungAnlegen("99997777", "A", 9);
  await assertSucceeds(einloesen(als("n2"), "n2", "99997777", "A"));
});

test("Einlösen ohne Löschen der Einladung, für falschen Betrieb oder ohne Einladung geht nicht", async () => {
  await einladungAnlegen("12121212", "A", 1);
  await assertFails(einloesen(als("n1"), "n1", "12121212", "A", false));
  await assertFails(einloesen(als("n1"), "n1", "12121212", "B"));
  await assertFails(einloesen(als("n1"), "n1", "00000000", "A"));
  // Fremdes Gerät eintragen (nicht sich selbst)
  const n = als("n1");
  const b = writeBatch(n);
  b.set(doc(n, "betriebe/A/geraete/jemand"), { name: "x", seit: serverTimestamp(), einladung: "12121212" });
  b.set(doc(n, "geraetezuordnung/jemand"), { betriebId: "A" });
  b.delete(doc(n, "einladungen/12121212"));
  await assertFails(b.commit());
});

test("Gerät, das schon in einem Betrieb ist, kann nicht zusätzlich beitreten", async () => {
  await einladungAnlegen("34343434", "A", 1);
  await assertFails(einloesen(als("b1"), "b1", "34343434", "A"));
});

test("Einladungen: Liste nur für den eigenen Betrieb, Löschen nicht für Fremde", async () => {
  const { query, where } = require("firebase/firestore");
  await einladungAnlegen("56565656", "A", 1);
  await assertSucceeds(getDocs(query(collection(als("a2"), "einladungen"), where("betriebId", "==", "A"))));
  await assertFails(getDocs(query(collection(als("b1"), "einladungen"), where("betriebId", "==", "A"))));
  await assertFails(getDocs(collection(als("fremd"), "einladungen")));
  await assertFails(deleteDoc(doc(als("fremd"), "einladungen/56565656")));
  await assertSucceeds(deleteDoc(doc(als("a2"), "einladungen/56565656")));
});

// ---------- Verwaltungs-PIN: Geräte hinzufügen/entfernen nur mit PIN ----------
test("Ohne Verwaltungs-PIN: keine Einladung, kein Entfernen anderer Geräte", async () => {
  const a1 = als("a1");
  await assertFails(setDoc(doc(a1, "einladungen/24242424"), { betriebId: "A", betriebName: "A", von: "a1", erstellt: serverTimestamp(), art: "pin" }));
  await assertFails(deleteDoc(doc(a1, "betriebe/A/geraete/a2")));
  await assertFails(deleteDoc(doc(a1, "geraetezuordnung/a2")));
});

test("Falsche Verwaltungs-PIN wird abgelehnt, richtige freigeschaltet", async () => {
  const a1 = als("a1");
  await assertFails(freischalten(a1, "A", "a1", "654321"));
  await assertFails(freischalten(a1, "A", "a1", "12345"));
  // PIN von Betrieb A gilt nicht als Nachweis für Betrieb B
  await assertFails(freischalten(als("b1"), "B", "b1", "000000"));
  await assertSucceeds(freischalten(a1, "A", "a1"));
  // Fremde Uhrzeit oder für ein anderes Gerät geht nicht
  await assertFails(setDoc(doc(a1, "betriebe/A/freischaltung/a1"), { nachweis: nachweis("A", "123456"), zeit: new Date(Date.now() + 3600000) }));
  await assertFails(setDoc(doc(a1, "betriebe/A/freischaltung/a2"), { nachweis: nachweis("A", "123456"), zeit: serverTimestamp() }));
  // Fremde Betriebe: auch mit „richtiger“ PIN nicht
  await assertFails(freischalten(a1, "B", "a1"));
});

test("Mit Verwaltungs-PIN: Einladung erzeugen und anderes Gerät entfernen", async () => {
  const a1 = als("a1");
  await assertSucceeds(freischalten(a1, "A", "a1"));
  await assertSucceeds(setDoc(doc(a1, "einladungen/24242424"), { betriebId: "A", betriebName: "A", von: "a1", erstellt: serverTimestamp(), art: "pin" }));
  const b = writeBatch(a1);
  b.delete(doc(a1, "betriebe/A/geraete/a2"));
  b.delete(doc(a1, "geraetezuordnung/a2"));
  await assertSucceeds(b.commit());
});

test("Freischaltung gilt nur 10 Minuten", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "betriebe/A/freischaltung/a1"), { nachweis: nachweis("A", "123456"), zeit: new Date(Date.now() - 11 * 60000) });
  });
  await assertFails(deleteDoc(doc(als("a1"), "betriebe/A/geraete/a2")));
});

test("PIN und Nachweis kann niemand lesen", async () => {
  const a1 = als("a1");
  await assertSucceeds(freischalten(a1, "A", "a1"));
  await assertFails(getDoc(doc(a1, "betriebe/A/geheim/verwaltung")));
  await assertFails(getDoc(doc(a1, "betriebe/A/freischaltung/a1")));
  await assertFails(getDocs(collection(a1, "betriebe/A/freischaltung")));
  await assertFails(getDoc(doc(als("f1"), "betriebe/A/geheim/verwaltung")));
});

test("PIN festlegen: einmal am Anfang; ändern nur mit alter PIN", async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "betriebe/NEU"), { name: "Neu" });
    await setDoc(doc(ctx.firestore(), "betriebe/NEU/geraete/n1"), { name: "n1" }); });
  const n1 = als("n1");
  await assertSucceeds(setDoc(doc(n1, "betriebe/NEU/geheim/verwaltung"), { pruefwert: sha(nachweis("NEU", "777777")), gesetzt: serverTimestamp() }));
  // Überschreiben ohne alte PIN geht nicht
  await assertFails(setDoc(doc(n1, "betriebe/NEU/geheim/verwaltung"), { pruefwert: sha(nachweis("NEU", "000000")), gesetzt: serverTimestamp() }));
  // Mit alter PIN geht es
  await assertSucceeds(freischalten(n1, "NEU", "n1", "777777"));
  await assertSucceeds(setDoc(doc(n1, "betriebe/NEU/geheim/verwaltung"), { pruefwert: sha(nachweis("NEU", "888888")), gesetzt: serverTimestamp() }));
  // Fremde können keine PIN für einen anderen Betrieb festlegen
  await assertFails(setDoc(doc(als("b1"), "betriebe/NEU/geheim/verwaltung"), { pruefwert: sha("x"), gesetzt: serverTimestamp() }));
});

test("PIN vergessen: nur der Betreiber kann sie zurücksetzen", async () => {
  await assertFails(deleteDoc(doc(als("a1"), "betriebe/A/geheim/verwaltung")));
  await assertSucceeds(deleteDoc(doc(als("f1"), "betriebe/A/geheim/verwaltung")));
});

// ---------- Betreiber-PIN: Freigabe auf jedem Gerät ----------
const betreiberNachweis = pin => sha("futterrechner-betreiber:" + pin);
async function betreiberPinAnlegen(pin) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "config/admin"), { pruefwert: sha(betreiberNachweis(pin)), gesetzt: new Date() });
  });
}
const betreiberFreischalten = (db, uid, pin) =>
  setDoc(doc(db, `betreiberFreischaltung/${uid}`), { nachweis: betreiberNachweis(pin), zeit: serverTimestamp() });

test("Betreiber-PIN: fremdes Gerät (z. B. PC im Gmail-Fenster) kann mit richtiger PIN freigeben", async () => {
  await betreiberPinAnlegen("12345678");
  const pc = als("pc1");
  await assertFails(getDoc(doc(pc, "anfragen/anf1")));                      // ohne PIN: nichts
  await assertSucceeds(betreiberFreischalten(pc, "pc1", "12345678"));
  await assertSucceeds(getDoc(doc(pc, "anfragen/anf1")));
  await assertSucceeds(freigabePaket(pc, "anf1", "r1", "PC1", true));
  await assertSucceeds(getDoc(doc(als("r1"), "betriebe/PC1/daten/futter")));
  // Ablehnen geht genauso
  await assertSucceeds(ablehnen(pc, "anf2", "pc1"));
});

test("Betreiber-PIN: falsche PIN, abgelaufene Freischaltung → nichts", async () => {
  await betreiberPinAnlegen("12345678");
  const pc = als("pc2");
  await assertFails(betreiberFreischalten(pc, "pc2", "87654321"));
  await assertFails(freigabePaket(pc, "anf1", "r1", "X1", true));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "betreiberFreischaltung/pc3"), { nachweis: betreiberNachweis("12345678"), zeit: new Date(Date.now() - 31 * 60000) });
  });
  await assertFails(freigabePaket(als("pc3"), "anf1", "r1", "X2", true));
});

test("Betreiber-PIN: Anfragender kann sich auch mit PIN nicht selbst freigeben", async () => {
  await betreiberPinAnlegen("12345678");
  const r = als("r1");
  await assertSucceeds(betreiberFreischalten(r, "r1", "12345678"));        // angenommen, er kennt die PIN
  await assertFails(freigabePaket(r, "anf1", "r1", "SELBST", true));
  await assertFails(freigabePaket(r, "anf1", "r1", "A", false));
  await assertFails(ablehnen(r, "anf1", "r1"));
});

test("Betreiber-PIN: Prüfwert, Freischaltung und Protokoll kann niemand lesen", async () => {
  await betreiberPinAnlegen("12345678");
  const pc = als("pc4");
  await assertSucceeds(betreiberFreischalten(pc, "pc4", "12345678"));
  await assertSucceeds(freigabePaket(pc, "anf1", "r1", "P4", true));
  for (const p of ["config/admin", "betreiberFreischaltung/pc4", "approvals/anf1"]) {
    await assertFails(getDoc(doc(pc, p)));
    await assertFails(getDoc(doc(als("f1"), p)));
  }
});

test("Betreiber-PIN festlegen: nur auf Betreiber-Gerät; ändern auch mit PIN; Entscheidung nur mit Protokoll", async () => {
  const neu = { pruefwert: sha(betreiberNachweis("11112222")), gesetzt: serverTimestamp() };
  await assertFails(setDoc(doc(als("a1"), "config/admin"), neu));            // normales Gerät
  await assertFails(setDoc(doc(als("fremd"), "config/admin"), neu));
  await assertSucceeds(setDoc(doc(als("f1"), "config/admin"), neu));         // Fritz' Gerät
  const pc = als("pc5");
  await assertSucceeds(betreiberFreischalten(pc, "pc5", "11112222"));
  await assertSucceeds(setDoc(doc(pc, "config/admin"), { pruefwert: sha(betreiberNachweis("33334444")), gesetzt: serverTimestamp() }));
  // Entscheidung ohne Protokolleintrag geht nicht
  await assertFails(updateDoc(doc(als("f1"), "anfragen/anf1"), { status: "abgelehnt", entschieden: serverTimestamp() }));
});
