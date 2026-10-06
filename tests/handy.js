// Prüft die Handy-Ansicht: Nichts darf breiter als der Bildschirm sein (sonst zoomt das Handy heraus und die
// Seite sieht aus wie eine PC-Seite). Macht Bilder aller Tabs nach tests/.tmp/handy/. Nur gegen den Emulator.
// Start: powershell -File tests\emulator.ps1 "node tests/handy.js"
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium, devices } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

const PORT = 5057;
const ZIEL = path.join(__dirname, ".tmp", "handy");
const GERAETE = ["Galaxy S9+", "Pixel 7", "iPhone 12"];

(async () => {
  fs.mkdirSync(ZIEL, { recursive: true });
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  for (const name of GERAETE) {
    const context = await browser.newContext({ ...devices[name], locale: "de-DE", timezoneId: "Europe/Berlin" });
    const page = await context.newPage();
    page.on("dialog", d => d.accept());
    await page.clock.setFixedTime(new Date(szenarien[0].heute));
    await zugang.vorbereiten(context, page, "emulator");
    await page.goto(`http://localhost:${PORT}/?emulator=1`);
    await zugang.warteAufApp(page, "emulator");
    await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(szenarien[0].backup)) });
    await page.waitForFunction(() => historyData.length > 10);
    await page.evaluate(() => { data.restbullen.rest = 850; data.restbullen.anz = 9; buildCalc(); });
    const breite = page.viewportSize().width;
    for (const tab of ["calc", "settings", "calc2", "history"]) {
      await page.evaluate(t => { showTab(t); window.scrollTo(0, 0); }, tab);
      await page.waitForTimeout(300);
      const zuBreit = await page.evaluate(b => {
        const r = [];
        document.querySelectorAll("body *").forEach(e => {
          const x = e.getBoundingClientRect();
          if (x.width > 0 && x.right > b + 1 && getComputedStyle(e).position !== "fixed") r.push(e.tagName + (e.id ? "#" + e.id : "") + "." + e.className + " →" + Math.round(x.right));
        });
        return { seite: document.documentElement.scrollWidth, elemente: r.slice(0, 6) };
      }, breite);
      const ok = zuBreit.seite <= breite;
      if (!ok) fehler++;
      console.log(`${ok ? "✔" : "✘"} ${name} (${breite}px) Tab ${tab}: Seitenbreite ${zuBreit.seite}px` + (ok ? "" : "  zu breit: " + zuBreit.elemente.join(", ")));
      await page.screenshot({ path: path.join(ZIEL, `${name.replace(/\W+/g, "_")}-${tab}.png`) });
    }
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(fehler ? `\nHANDY-TEST ROT (${fehler})` : "\nHANDY-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
