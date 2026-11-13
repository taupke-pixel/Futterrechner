// Test Testversion (Paket Fressmengen): eigener Gerätespeicher (Vorsilbe „fmtest:“), eigene Datenbank, Hinweisleiste.
// Die normale App auf derselben Adresse darf nie berührt werden. Lokal mit ?testversion=1. Nur gegen den Emulator.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/testversion.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5072;

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 5).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  // Speicher der „normalen App“ auf derselben Adresse vorbelegen (so, als wäre sie hier schon benutzt worden)
  await page.goto(`http://localhost:${PORT}/agb.html`);
  const ECHT = { futter: '{"merker":"ECHT"}', betriebId: "ECHTER-BETRIEB", deviceID: "echtes-geraet", gCfg: '{"kueheName":"Echte Kühe"}' };
  await page.evaluate(e => { localStorage.clear(); Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v)); }, ECHT);
  const roh = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem.call(localStorage, k)])));
  const rohKeys = () => page.evaluate(() => Object.keys(localStorage));

  try {
    await pruefe("Testversion startet mit Hinweisleiste „TESTVERSION“ und eigener Datenbank (nicht das echte Projekt)", async () => {
      await page.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await zugang.warteAufApp(page, "emulator");
      assert.strictEqual(await page.evaluate(() => istTestversion), true);
      assert((await page.textContent("#testversion-hinweis")).includes("TESTVERSION"));
      assert.notStrictEqual(await page.evaluate(() => firebase.app().options.projectId), "futterrechner");
    });

    await pruefe("Gerätespeicher der Testversion hat eigene Namen (fmtest:…), die Einträge der normalen App sind unverändert", async () => {
      await page.evaluate(() => { data.kuehe.anz = 77; save(); });
      const keys = await rohKeys();
      assert(keys.includes("fmtest:futter") && keys.includes("fmtest:betriebId"), keys.join(","));
      const werte = await page.evaluate(k => k.map(n => Object.getOwnPropertyDescriptor(localStorage, n) ? localStorage[n] : null), Object.keys(ECHT));
      assert.deepStrictEqual(werte, Object.values(ECHT));
      assert.notStrictEqual(await page.evaluate(() => betriebId), "ECHTER-BETRIEB");
    });

    await pruefe("Normale Seite danach (ohne Testversion): sieht nur ihre eigenen Einträge, keine Hinweisleiste", async () => {
      await page.goto(`http://localhost:${PORT}/agb.html`);
      const w = await page.evaluate(k => k.map(n => localStorage.getItem(n)), Object.keys(ECHT));
      assert.deepStrictEqual(w, Object.values(ECHT));
      await page.goto(`http://localhost:${PORT}/?emulator=1`);
      await page.waitForTimeout(1500);
      assert.strictEqual(await page.evaluate(() => istTestversion), false);
      assert.strictEqual(await page.locator("#testversion-hinweis").count(), 0);
      assert.strictEqual(await page.evaluate(() => localStorage.getItem("betriebId")), "ECHTER-BETRIEB");
    });

    await pruefe("„Alles löschen“ in der Testversion (clear) löscht nur die eigenen Einträge", async () => {
      await page.goto(`http://localhost:${PORT}/agb.html?testversion=1`);
      await page.evaluate(() => {
        // die Vorsilbe gilt auch auf Unterseiten nur, wenn das Testversions-Skript geladen ist → hier direkt nachbilden
        const P = "fmtest:"; for (let i = localStorage.length - 1; i >= 0; i--) { const n = localStorage.key(i); if (n.startsWith(P)) localStorage.removeItem(n); }
      });
      await page.goto(`http://localhost:${PORT}/?emulator=1&testversion=1`);
      await page.waitForTimeout(1500);
      await page.evaluate(() => localStorage.clear());
      const keys = await rohKeys();
      assert(Object.keys(ECHT).every(k => keys.includes(k)), "Einträge der normalen App gelöscht: " + keys.join(","));
      assert(!keys.some(k => k.startsWith("fmtest:")), "Testeinträge nicht gelöscht: " + keys.join(","));
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nTESTVERSION-TEST ROT (${fehler} Fehler)` : "\nTESTVERSION-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
