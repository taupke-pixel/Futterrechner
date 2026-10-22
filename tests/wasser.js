// Test des dritten Futters (Start-Name „Wasser“, umbenennbar) – muss überall funktionieren wie AGF/MLF.
// Start: powershell -File tests\emulator.ps1 "node tests/wasser.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5066;
const S1 = szenarien[0];
const fmt = sec => { sec = Math.round(sec); return Math.floor(sec / 60) + " min " + (sec % 60) + " s"; };

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n").slice(0, 3).join("\n   ")); }
  };
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  page.on("console", m => { if (/error|Uncaught|TypeError|ReferenceError/i.test(m.text())) meldungen.push("KONSOLE: " + m.text().slice(0, 300)); });
  await page.clock.setFixedTime(new Date(S1.heute));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(`http://localhost:${PORT}/?emulator=1`);
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(S1.backup)) });
  await page.waitForFunction(() => historyData.length > 10);
  const zeileImRechner = (cat, name) => page.evaluate(([cat, name]) => {
    const tr = [...document.querySelectorAll(`.cat-${cat} + .cat-body table tr`)].find(t => t.querySelector("td") && t.querySelector("td").textContent.trim() === name);
    return tr ? [...tr.querySelectorAll("td")].map(td => td.textContent.trim()) : null;
  }, [cat, name]);

  try {
    await pruefe("Vorhandene Rationen haben eine Zeile „Wasser“ mit 0 kg (Daten bleiben erhalten)", async () => {
      const r = await page.evaluate(() => ["kuehe", "faersen", "bullen", "trocken", "kaelber"].map(c => {
        const w = data[c].items.filter(i => i.type === "wasser"); return w.length === 1 && w[0].kg === 0;
      }));
      assert.deepStrictEqual(r, [true, true, true, true, true]);
      assert.strictEqual(await page.evaluate(() => data.kuehe.items.length), 11);
      assert.strictEqual(await zeileImRechner("kuehe", "Wasser"), null, "0 kg darf nicht angezeigt werden");
    });

    await pruefe("Wasser in der Kuh-Ration (5 kg/Tier): Menge und Zeit wie bei AGF/MLF", async () => {
      await page.evaluate(() => showTab("settings"));
      const i = await page.evaluate(() => data.kuehe.items.findIndex(x => x.type === "wasser"));
      await page.fill(`#settings input[oninput*="data['kuehe'].items[${i}].kg"]`, "5");
      await page.evaluate(() => showTab("calc"));
      await page.waitForFunction(() => [...document.querySelectorAll(".cat-kuehe + .cat-body td")].some(td => td.textContent.trim() === "Wasser"), null, { timeout: 15000 });
      const z = await zeileImRechner("kuehe", "Wasser");
      assert(z, "Zeile fehlt");
      assert.strictEqual(z[1], (5 * 120).toFixed(1));
      assert.strictEqual(z[3], fmt(600 / 0.5));
    });

    await pruefe("Name und kg/s in den Einstellungen ändern → überall übernommen", async () => {
      await page.evaluate(() => showTab("settings"));
      const n = page.locator('#settings input[oninput^="globalCfg.wasserName"]').first(); await n.fill("Zusatzwasser"); await n.blur();
      const k = page.locator('#settings input[oninput*="globalCfg.wasserKg"]'); await k.fill("0.8"); await k.blur();
      await page.evaluate(() => showTab("calc"));
      const z = await zeileImRechner("kuehe", "Zusatzwasser");
      assert(z, "umbenannte Zeile fehlt");
      assert.strictEqual(z[3], fmt(600 / 0.8));
      await page.evaluate(() => buildHistory());
      const h = await page.textContent("#history");
      assert(h.includes("Zusatzwasser"), "Name fehlt im Lager/History");
      assert(await page.$('#liefer-produkt option[value="wasser"]'), "Lieferung-Auswahl fehlt");
    });

    await pruefe("Lieferung 5000 kg → Lagerbestand", async () => {
      await page.evaluate(() => showTab("history"));
      await page.selectOption("#liefer-produkt", "wasser");
      await page.fill("#liefer-menge", "5000");
      await page.click('button[onclick="addLieferung()"]');
      assert.strictEqual(await page.evaluate(() => lagerData.wasser.bestand), 5000);
      assert((await page.textContent("#history")).includes("5000.0 kg"));
    });

    await pruefe("Kühe speichern → Wasser im History-Eintrag, Lagerabzug, Ø Verbrauch, Reicht noch", async () => {
      await page.evaluate(() => showTab("calc"));
      await page.click(`button[onclick="saveHistory('kuehe')"]`);
      const e = await page.evaluate(() => historyData.find(h => h.kategorie === "kuehe" && h.datum === getToday()));
      assert.strictEqual(e.wasser, 600);
      assert(e.futter.some(f => f.name === "Zusatzwasser" && f.kg === 600));
      assert.strictEqual(await page.evaluate(() => lagerData.wasser.bestand), 4400);
      assert.strictEqual(await page.evaluate(() => calcAverage("wasser")), 600);
      const h = await page.evaluate(() => { buildHistory(); return document.getElementById("history").textContent.replace(/\s+/g, " "); });
      assert(h.includes("Zusatzwasser Bestand: 4400.0 kg Ø Verbrauch: 600.0 kg/Tag"), h.slice(h.indexOf("Zusatzwasser"), h.indexOf("Zusatzwasser") + 120));
      assert(h.includes("Reicht noch ca. 7.3 Tage"));
    });

    await pruefe("Warnstufe Rot 10 Tage → roter Warnhinweis und roter History-Reiter", async () => {
      await page.evaluate(() => { lagerData.wasser.rot = 10; saveLagerStorage(); buildCalc(); updateHistoryTabColor(); });
      const t = (await page.textContent("#calc")).replace(/\s+/g, " ");
      assert(t.includes("Zusatzwasser reicht nur noch ca. 7.3 Tage"), "kein Warnhinweis: " + JSON.stringify(await page.evaluate(() => ({ rest: calcResttage("wasser"), klasse: getWarnClass("wasser"), lager: lagerData.wasser, versteckt: hiddenWarnings }))) + " | " + t.slice(0, 160) + " | " + meldungen.filter(m => m.startsWith("KONSOLE")).join(" || "));
      assert(await page.evaluate(() => document.getElementById("history-tab").classList.contains("tab-red")));
      await page.evaluate(() => { lagerData.wasser.rot = 2; saveLagerStorage(); buildCalc(); updateHistoryTabColor(); });
    });

    await pruefe("History-Eintrag löschen → Wasser zurück ins Lager", async () => {
      await page.evaluate(() => deleteHistory(historyData.find(h => h.kategorie === "kuehe" && h.datum === getToday()).id));
      assert.strictEqual(await page.evaluate(() => lagerData.wasser.bestand), 5000);
    });

    await pruefe("Restmischung Bullen berücksichtigt Wasser (Bullen 2 kg/Tier)", async () => {
      await page.evaluate(() => { const w = data.bullen.items.find(i => i.type === "wasser"); w.kg = 2; save(); buildCalc(); });
      const rm = i => page.locator(".cat-restbullen + .cat-body input").nth(i);
      await rm(0).fill("100"); await rm(0).blur();
      await rm(2).fill("10"); await rm(2).blur();
      const z = await page.evaluate(() => [...document.querySelectorAll(".cat-restbullen + .cat-body table tr")]
        .map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent.trim())).find(r => r[0] === "Zusatzwasser"));
      assert(z, "Wasser-Zeile in der Restmischung fehlt");
      const total = S1.backup.data.kuehe.items.reduce((s, i) => s + i.kg, 0) + 5;
      const ist = 5 / total * 100, soll = 2 * 10;
      assert.deepStrictEqual([z[1], z[2], z[3]], [ist.toFixed(1), soll.toFixed(1), fmt(Math.abs(soll - ist) / 0.8)]);
    });

    await pruefe("Nach Neuladen (aus der Cloud): Name, kg/s, Ration und Lager bleiben", async () => {
      await page.evaluate(async () => { await cloudSyncFertig(); ["futter", "gCfg", "history", "lager", "lieferungen"].forEach(k => localStorage.removeItem(k)); });
      await page.reload();
      await zugang.warteAufApp(page, "emulator", true);
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => [globalCfg.wasserName, globalCfg.wasserKg, data.kuehe.items.find(i => i.type === "wasser").kg, lagerData.wasser.bestand]);
      assert.deepStrictEqual(r, ["Zusatzwasser", 0.8, 5, 5000]);
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual(meldungen.filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nWASSER-TEST ROT (${fehler} Fehler)` : "\nWASSER-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
