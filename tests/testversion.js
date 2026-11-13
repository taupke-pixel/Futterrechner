// Test Testversion = SPIEGEL (Paket Fressmengen, Wahl Fritz 13.11.2026):
//  - liest die echten Daten des Betriebs (hier: Emulator), schreibt aber nie außerhalb von „test/“
//  - einzige Ausnahme: das Gerät per PIN in den Betrieb aufnehmen (wie ein neues Handy)
//  - eigener Gerätespeicher (Vorsilbe „fmtest:“), die normale App auf derselben Adresse wird nie berührt
//  - Änderungen der normalen App kommen sofort in der Testversion an
// Lokal mit ?testversion=1. Nur gegen den Emulator.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/testversion.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5072;
const FS_URL = "http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents";
const S1 = szenarien[0];

// Dokument direkt aus dem Emulator lesen (Admin), als Text zum Vergleichen
async function rohDok(pfad) {
  const r = await fetch(`${FS_URL}/${pfad}`, { headers: { Authorization: "Bearer owner" } });
  if (!r.ok) return null;
  const j = await r.json();
  delete j.updateTime; delete j.createTime;
  return JSON.stringify(j);
}
async function rohSammlung(pfad) {
  const r = await fetch(`${FS_URL}/${pfad}?pageSize=300`, { headers: { Authorization: "Bearer owner" } });
  const j = await r.json();
  return JSON.stringify((j.documents || []).map(d => [d.name, d.fields]));
}
async function betriebRoh(bid) {
  const teile = [];
  for (const d of ["daten/futter", "daten/einstellungen", "daten/lager"]) teile.push(await rohDok(`betriebe/${bid}/${d}`));
  for (const c of ["history", "lieferungen", "geraete"]) teile.push(await rohSammlung(`betriebe/${bid}/${c}`));
  teile.push(await rohSammlung("anfragen"));
  return teile.join("\n");
}

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 5).join("\n   ")); }
  };
  const neueSeite = async () => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
    const page = await context.newPage();
    page.meldungen = [];
    page.on("dialog", d => { page.meldungen.push(d.message()); d.accept(); });
    page.on("pageerror", e => page.meldungen.push("SEITENFEHLER: " + e.message));
    await zugang.vorbereiten(context, page, "emulator");
    return page;
  };
  const stand = p => p.evaluate(() => gleicherStand({ data: { ...data, restbullen: null }, globalCfg, lagerData, historyData, lieferungen }));

  // Normale App (Gerät A) mit Daten
  const A = await neueSeite();
  // Testversion (Gerät T, eigener Browser wie Chrome neben der App)
  const T = await neueSeite();
  let bid, vorher;
  const ECHT = { futter: '{"merker":"ECHT"}', betriebId: "ECHTER-BETRIEB", deviceID: "echtes-geraet", gCfg: '{"kueheName":"Echte Kühe"}' };

  try {
    await pruefe("Normale App: Betrieb mit Daten (Backup) angelegt", async () => {
      await A.goto(`http://localhost:${PORT}/?emulator=1`);
      await zugang.warteAufApp(A, "emulator");
      await A.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
      await A.waitForFunction(() => historyData.length > 10);
      await A.evaluate(() => cloudSyncFertig());
      bid = await A.evaluate(() => betriebId);
    });

    await pruefe("Testversion ohne Betrieb: Hinweisleiste, statt Anfrage-Formular nur PIN-Hinweis", async () => {
      // Speicher der „normalen App“ auf derselben Adresse vorbelegen (so, als wäre sie hier schon benutzt worden)
      await T.goto(`http://localhost:${PORT}/agb.html`);
      await T.evaluate(e => { localStorage.clear(); Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v)); }, ECHT);
      await T.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await T.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 30000 });
      assert.strictEqual(await T.evaluate(() => istTestversion), true);
      assert((await T.textContent("#testversion-hinweis")).includes("echten Zahlen"));
      assert(await T.locator("#testversion-zugang").isVisible());
      assert(!(await T.locator("#anfrage-knopf").isVisible()));
      vorher = await betriebRoh(bid);
    });

    await pruefe("Testversion: neue Zugangsanfrage wird gesperrt (nichts in „anfragen“)", async () => {
      const code = await T.evaluate(() => db.collection("anfragen").add({ x: 1 }).then(() => "ok", e => e.code));
      assert.strictEqual(code, "testversion-nur-lesen");
    });

    await pruefe("Testversion per PIN als Gerät aufgenommen → zeigt dieselben echten Daten wie die normale App", async () => {
      const pin = String(10000000 + Math.floor(Math.random() * 89999999));
      const r = await fetch(`${FS_URL}/einladungen/${pin}`, {
        method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { betriebId: { stringValue: bid }, betriebName: { stringValue: "Test" }, von: { stringValue: "x" },
          art: { stringValue: "pin" }, erstellt: { timestampValue: new Date().toISOString() } } })
      });
      assert(r.ok, "Einladung anlegen");
      await T.evaluate(() => pinBereichZeigen());
      await T.fill("#pin-eingabe", pin);
      await Promise.all([T.waitForNavigation(), T.evaluate(() => pinEinloesen())]);
      await zugang.warteAufApp(T, "emulator", true);
      assert(T.url().includes("testversion=1"), T.url());
      assert.strictEqual(await T.evaluate(() => betriebId), bid);
      assert.strictEqual(await T.evaluate(() => fbApp.name), "testversion");
      await T.waitForFunction(() => historyData.length > 10);
      assert.strictEqual(await stand(T), await stand(A));
      assert.strictEqual(await rohDok(`einladungen/${pin}`), null, "Einladung nicht verbraucht");
    });

    await pruefe("Testversion: Eingaben, Speichern, Lager, Lieferung → nichts davon kommt in den Betrieb; Hinweisleiste wird rot", async () => {
      vorher = await betriebRoh(bid);
      await T.evaluate(() => showTab("calc"));
      await T.evaluate(() => { data.kuehe.anz = 77; save(); saveGlobal && saveGlobal(); lagerData.agf.bestand += 3; saveLagerStorage();
        historyData.unshift({ ...historyData[0], datum: "01.01.2030", test: true }); saveHistoryStorage();
        lieferungen.unshift({ ...(lieferungen[0] || { produkt: "agf", datum: "2030-01-01", menge: 5 }), id: 999999, test: true }); saveLieferungen(); });
      assert.strictEqual(await T.evaluate(() => document.getElementById("testversion-hinweis").style.background), "rgb(196, 0, 0)");
      await T.waitForTimeout(2000);
      assert.strictEqual(await T.evaluate(() => Object.keys(cloud.offen).length), 0);
      assert.strictEqual(await betriebRoh(bid), vorher, "Betrieb wurde verändert!");
    });

    await pruefe("Testversion: direkte Schreibversuche außerhalb von test/ werden abgefangen (Dokument, Paket, Gerät entfernen)", async () => {
      const codes = await T.evaluate(async b => {
        const r = [];
        r.push(await db.collection("betriebe").doc(b).collection("daten").doc("futter").set({ inhalt: {} }).then(() => "ok", e => e.code));
        r.push(await db.collection("betriebe").doc(b).update({ name: "X" }).then(() => "ok", e => e.code));
        r.push(await db.collection("betriebe").doc(b).collection("geraete").doc(geraeteUid).delete().then(() => "ok", e => e.code));
        r.push(await db.collection("geraetezuordnung").doc(geraeteUid).delete().then(() => "ok", e => e.code));
        try { const p = db.batch(); p.set(db.collection("betriebe").doc(b).collection("history").doc("2030-01"), { eintraege: [] }); await p.commit(); r.push("ok"); }
        catch (e) { r.push(e.code); }
        r.push(await db.runTransaction(async t => 1).then(() => "ok", e => e.code));
        // test/… geht durch die Sperre (der Emulator lehnt es ab, solange keine Regel dafür da ist)
        r.push(await db.collection("test").doc(b).collection("daten").doc("x").set({ a: 1 }).then(() => "ok", e => e.code));
        return r;
      }, bid);
      assert.deepStrictEqual(codes.slice(0, 6), Array(6).fill("testversion-nur-lesen"), codes.join(","));
      assert.notStrictEqual(codes[6], "testversion-nur-lesen");
      await T.waitForTimeout(1000);
      assert.strictEqual(await betriebRoh(bid), vorher, "Betrieb wurde verändert!");
    });

    await pruefe("Änderung in der normalen App kommt in der Testversion an (überschreibt die nur lokale Testeingabe)", async () => {
      await A.evaluate(() => { data.kuehe.anz = 55; save(); });
      await A.evaluate(() => cloudSyncFertig());
      await T.waitForFunction(() => data.kuehe.anz === 55, null, { timeout: 15000 });
      await A.evaluate(() => { lagerData.agf.bestand -= 1; saveLagerStorage(); historyData.unshift({ ...historyData[0], datum: "02.01.2030", vonA: true }); saveHistoryStorage(); });
      await A.evaluate(() => cloudSyncFertig());
      await T.waitForFunction(() => historyData.some(e => e.vonA), null, { timeout: 15000 });
      await T.waitForTimeout(500);
      const a = JSON.parse(await stand(A)), t = JSON.parse(await stand(T));
      assert.deepStrictEqual(t.data, a.data); assert.deepStrictEqual(t.historyData, a.historyData); assert.deepStrictEqual(t.lagerData, a.lagerData);
    });

    await pruefe("Neu laden: Testversion zeigt wieder den echten Stand (lokale Testeingaben weg)", async () => {
      await T.reload();
      await zugang.warteAufApp(T, "emulator", true);
      await T.waitForFunction(() => data.kuehe.anz === 55);
      const a = JSON.parse(await stand(A)), t = JSON.parse(await stand(T));
      assert.deepStrictEqual(t.lieferungen, a.lieferungen);
      assert(!t.historyData.some(e => e.test));
    });

    await pruefe("Gerätespeicher der Testversion hat eigene Namen (fmtest:…), die Einträge der normalen App sind unverändert", async () => {
      const keys = await T.evaluate(() => Object.keys(localStorage));
      assert(keys.includes("fmtest:futter") && keys.includes("fmtest:betriebId"), keys.join(","));
      const werte = await T.evaluate(k => k.map(n => Object.getOwnPropertyDescriptor(localStorage, n) ? localStorage[n] : null), Object.keys(ECHT));
      assert.deepStrictEqual(werte, Object.values(ECHT));
    });

    let uidTest;
    await pruefe("Normale Seite (ohne Testversion) im selben Browser: eigene Einträge, eigene Geräte-Anmeldung, keine Hinweisleiste", async () => {
      uidTest = await T.evaluate(() => geraeteUid);
      await T.goto(`http://localhost:${PORT}/agb.html`);
      assert.deepStrictEqual(await T.evaluate(k => k.map(n => localStorage.getItem(n)), Object.keys(ECHT)), Object.values(ECHT));
      await T.goto(`http://localhost:${PORT}/?emulator=1`);
      await T.waitForFunction(() => typeof geraeteUid !== "undefined" && geraeteUid, null, { timeout: 30000 });
      assert.strictEqual(await T.evaluate(() => istTestversion), false);
      assert.strictEqual(await T.locator("#testversion-hinweis").count(), 0);
      assert.notStrictEqual(await T.evaluate(() => geraeteUid), uidTest, "normale App benutzt die Anmeldung der Testversion");
      assert.strictEqual(await T.evaluate(() => firebase.app().name), "[DEFAULT]");
    });

    await pruefe("„Alles löschen“ in der Testversion (clear) löscht nur die eigenen Einträge", async () => {
      await T.goto(`http://localhost:${PORT}/agb.html`);
      await T.evaluate(e => Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v)), ECHT);
      await T.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await zugang.warteAufApp(T, "emulator", true);
      assert.strictEqual(await T.evaluate(() => geraeteUid), uidTest, "Testversion hat ihre Anmeldung verloren");
      // im selben Schritt nachsehen (danach darf die laufende App ihre Einträge wieder anlegen)
      const keys = await T.evaluate(() => { localStorage.clear(); return Object.keys(localStorage); });
      assert(Object.keys(ECHT).every(k => keys.includes(k)), "Einträge der normalen App gelöscht: " + keys.join(","));
      assert(!keys.some(k => k.startsWith("fmtest:")), "Testeinträge nicht gelöscht: " + keys.join(","));
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual([...A.meldungen, ...T.meldungen].filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nTESTVERSION-TEST ROT (${fehler} Fehler)` : "\nTESTVERSION-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
