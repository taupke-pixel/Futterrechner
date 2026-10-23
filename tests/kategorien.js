// Test Kategorien ein/aus (Häkchen in den Einstellungen) – nur Anzeige auf dem Start, Daten und Rechnung unverändert.
// Start: powershell -ExecutionPolicy Bypass -File tests\emulator.ps1 "node tests/kategorien.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5065;
const S1 = szenarien[0];
const ALLE = ["kuehe", "faersen", "bullen", "restbullen", "trocken", "kaelber"];

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 4).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await page.clock.setFixedTime(new Date(S1.heute));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(`http://localhost:${PORT}/?emulator=1`);
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await page.waitForFunction(() => historyData.length > 10);

  const sichtbar = p => p.evaluate(alle => { showTab("calc"); return alle.filter(c => {
    const h = document.querySelector("#calc .cat-header.cat-" + c); return h && h.closest(".category").offsetParent !== null; }); }, ALLE);
  const haken = (p, name) => p.locator("#kategorien-wahl label").filter({ hasText: new RegExp("^\\s*" + name + "\\s*$") }).locator("input");
  // Daten-Stand (Schlüssel sortiert – nach dem Laden aus dem Betrieb kann nur die Reihenfolge der Felder anders sein)
  const stand = p => p.evaluate(() => { const s = o => Array.isArray(o) ? o.map(s) : (o && typeof o === "object") ? Object.fromEntries(Object.keys(o).sort().map(k => [k, s(o[k])])) : o;
    return JSON.stringify(s({ data: { ...data, restbullen: null }, lagerData, historyData, lieferungen })); });
  const startText = p => p.evaluate(() => { showTab("calc"); return [...document.querySelectorAll("#calc .category")]
    .filter(k => k.offsetParent !== null).map(k => k.innerText).join("|"); });

  try {
    let vorher, textVorher;
    await pruefe("Standard: alle 6 Kategorien angehakt und auf dem Start sichtbar", async () => {
      vorher = await stand(page);
      textVorher = await startText(page);
      await page.evaluate(() => showTab("settings"));
      assert.strictEqual(await page.locator("#kategorien-wahl input[type=checkbox]:checked").count(), 6);
      assert.deepStrictEqual(await sichtbar(page), ALLE);
    });

    await pruefe("Auf-/Zuklappen: beide Bereiche starten zugeklappt, Klick öffnet und schließt (▶/▼), Daten bleiben gleich", async () => {
      // wasserName/wasserKg ausgenommen: nach dem Laden eines alten Backups ergänzt die App sie kurz danach aus dem Betrieb (FEHLER.md F13)
      const einst = () => page.evaluate(() => JSON.stringify({ ...globalCfg, wasserName: undefined, wasserKg: undefined }));
      const einstVorher = await einst();
      await page.evaluate(() => showTab("settings"));
      for (const [id, titel] of [["kategorien-wahl", "Kategorien auf dem Start anzeigen"], ["restquellen-wahl", "Reste für die Restmischung"]]) {
        const kopf = page.locator("#" + id + " .history-header");
        const inhalt = page.locator("#" + id + " .klapp-inhalt");
        assert.strictEqual((await kopf.innerText()).trim(), "▶ " + titel);
        assert(!(await inhalt.isVisible()), id + " sollte zu sein");
        await kopf.click();
        assert.strictEqual((await page.locator("#" + id + " .history-header").innerText()).trim(), "▼ " + titel);
        assert(await page.locator("#" + id + " .klapp-inhalt").isVisible(), id + " sollte offen sein");
        await page.locator("#" + id + " .history-header").click();
        assert(!(await page.locator("#" + id + " .klapp-inhalt").isVisible()), id + " sollte wieder zu sein");
        await page.locator("#" + id + " .history-header").click();
        assert(await page.locator("#" + id + " .klapp-inhalt").isVisible());
      }
      const einstNachher = await einst();
      if (einstNachher !== einstVorher) { const v = JSON.parse(einstVorher), n = JSON.parse(einstNachher);
        throw new Error("Klappen hat Einstellungen verändert: " + JSON.stringify(Object.keys({ ...v, ...n }).filter(k => JSON.stringify(v[k]) !== JSON.stringify(n[k])).map(k => [k, v[k], n[k]]))); }
      assert.strictEqual(await stand(page), vorher, "Klappen hat Daten verändert");
      assert.deepStrictEqual(await sichtbar(page), ALLE);
    });

    await pruefe("Aufgeklappt bleibt nach dem Neuladen aufgeklappt (nur auf diesem Gerät)", async () => {
      await page.evaluate(() => cloudSyncFertig());   // erst neu laden, wenn alles im Betrieb gespeichert ist (siehe FEHLER.md F12)
      await page.reload();
      await zugang.warteAufApp(page, "emulator", true);
      await page.waitForTimeout(800);
      await page.evaluate(() => showTab("settings"));
      assert(await page.locator("#kategorien-wahl .klapp-inhalt").isVisible());
      assert(await page.locator("#restquellen-wahl .klapp-inhalt").isVisible());
    });

    await pruefe("Kälber und Restmischung abwählen → verschwinden vom Start, Rest bleibt", async () => {
      await page.evaluate(() => showTab("settings"));
      await haken(page, "Kälber").click();
      await haken(page, "Restmischung Bullen").click();
      assert.deepStrictEqual(await sichtbar(page), ["kuehe", "faersen", "bullen", "trocken"]);
    });

    await pruefe("Abwählen ändert keine Daten (Rationen, Lager, History, Lieferungen)", async () => {
      assert.strictEqual(await stand(page), vorher);
    });

    await pruefe("Umbenennen: Häkchen zeigt sofort den neuen Namen", async () => {
      await page.evaluate(() => showTab("settings"));
      await page.click("#edit-kuehe");
      await page.keyboard.press("Control+A"); await page.keyboard.type("Milchkühe");
      await page.evaluate(() => document.activeElement.blur());
      assert(await haken(page, "Milchkühe").isChecked());
      await page.click("#edit-restbullen");
      await page.keyboard.press("Control+A"); await page.keyboard.type("Reste Bullen");
      await page.evaluate(() => document.activeElement.blur());
      assert(!(await haken(page, "Reste Bullen").isChecked()));
    });

    await pruefe("Mindestens eine Kategorie bleibt an", async () => {
      await page.evaluate(() => showTab("settings"));
      for (const n of ["Milchkühe", "Färsen", "Bullen"]) await haken(page, n).click();
      await haken(page, "Trockensteher").click();
      assert(meldungen.some(m => m.includes("Mindestens eine Kategorie")));
      assert.deepStrictEqual(await sichtbar(page), ["trocken"]);
    });

    await pruefe("Auswahl bleibt nach Neuladen und gilt auf anderen Geräten", async () => {
      await page.evaluate(async () => { await cloudSyncFertig(); ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)); });
      await page.reload();
      await zugang.warteAufApp(page, "emulator", true);
      await page.waitForTimeout(800);
      assert.deepStrictEqual(await sichtbar(page), ["trocken"]);
      const bid = await page.evaluate(() => betriebId);
      const ctxB = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
      const B = await ctxB.newPage();
      B.on("dialog", d => d.accept());
      await B.clock.setFixedTime(new Date(S1.heute));
      await zugang.vorbereiten(ctxB, B, "emulator");
      await B.goto(`http://localhost:${PORT}/?emulator=1`);
      const uidB = await B.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
      await zugang.geraetEintragenOeffentlich(bid, uidB, "Gerät B");
      await B.reload();
      await zugang.warteAufApp(B, "emulator", true);
      await B.waitForTimeout(800);
      assert.deepStrictEqual(await sichtbar(B), ["trocken"]);
      await ctxB.close();
    });

    await pruefe("Alles wieder anhaken → Start sieht genau aus wie vorher (bis auf die neuen Namen)", async () => {
      await page.evaluate(() => showTab("settings"));
      for (const n of ["Milchkühe", "Färsen", "Bullen", "Reste Bullen", "Kälber"]) await haken(page, n).click();
      assert.deepStrictEqual(await sichtbar(page), ALLE);
      const nachher = (await startText(page)).replaceAll("Milchkühe", "Kühe").replaceAll("Reste Bullen", "Restmischung Bullen");
      if (nachher !== textVorher) { const i = [...nachher].findIndex((z, k) => z !== textVorher[k]); throw new Error("Unterschied: " + JSON.stringify(nachher.slice(i - 60, i + 60)) + " statt " + JSON.stringify(textVorher.slice(i - 60, i + 60))); }
      const st = await stand(page);
      if (st !== vorher) { const i = [...st].findIndex((z, k) => z !== vorher[k]); throw new Error("Daten: " + st.slice(i - 150, i + 80) + "\n   statt " + vorher.slice(i - 150, i + 80)); }
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nKATEGORIEN-TEST ROT (${fehler} Fehler)` : "\nKATEGORIEN-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
