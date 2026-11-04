// Bildschirmfotos: Leistungsgruppe 2 (normal + aufwerten), Einstellung, History in Tonnen → tests/.tmp/kuehe2-*.png
const path = require("path");
const { chromium, devices } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");

(async () => {
  const server = await starteServer(path.join(__dirname, ".."), 5064);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE", timezoneId: "Europe/Berlin" });
  const page = await context.newPage();
  const fehler = [];
  page.on("pageerror", e => fehler.push(e.message));
  page.on("dialog", d => d.accept());
  await page.clock.setFixedTime(new Date(szenarien[0].heute));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto("http://localhost:5064/?emulator=1");
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(szenarien[0].backup)) });
  await page.waitForFunction(() => historyData.length > 10);
  const ziel = d => path.join(__dirname, ".tmp", d);
  const versteck = () => page.evaluate(() => { const s = document.createElement("style"); s.textContent = ".firebase-emulator-warning{display:none!important}"; document.head.appendChild(s); });
  await versteck();
  // Ration Gruppe 2: wie Kühe, aber mehr Kraftfutter
  await page.evaluate(() => {
    data.kuehe2.items = JSON.parse(JSON.stringify(data.kuehe.items));
    data.kuehe2.items.forEach(i => { if (i.type === "agf") i.kg = 6; if (i.type === "mlf") i.kg = 3.5; });
    data.kuehe2.anz = 40; data.kuehe.anz = 100; save();
    showTab("calc");
    ["kuehe", "faersen", "bullen", "restbullen", "trocken", "kaelber"].forEach(c => data[c].collapsed = true);
    data.kuehe2.collapsed = false; buildCalc(); window.scrollTo(0, 0);
  });
  await page.screenshot({ path: ziel("kuehe2-normal.png") });
  // Einstellungen
  await page.evaluate(() => { showTab("settings"); const h = document.getElementById("edit-kuehe2"); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 120); });
  await page.selectOption("#kuehe2-modus select", "aufwerten");
  await page.evaluate(() => { const h = document.getElementById("edit-kuehe2"); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 120); });
  await page.screenshot({ path: ziel("kuehe2-einstellung.png") });
  // Rechner: aufwerten
  await page.evaluate(() => { showTab("calc"); window.scrollTo(0, 0); });
  await page.evaluate(() => { data.kuehe2.rest = 1490; data.kuehe2.ziel = 40 * 43.25; data.kuehe2.collapsed = false; data.restbullen.collapsed = false; data.restbullen.rest = 300; data.restbullen.anz = 10; save(); buildCalc(); window.scrollTo(0, 0); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: ziel("kuehe2-aufwerten.png"), fullPage: true });
  // Speichern → History (Tonnen)
  await page.click("button[onclick='kuehe2Speichern()']");
  await page.waitForTimeout(2000);
  await page.evaluate(() => { historyCollapsed.tageslog = false; ["kuehe","kuehe2"].forEach(c => { historyCollapsed.kategorien[c] = true; historyCollapsed.jahre[c + "_2026"] = true; historyCollapsed.monate[c + "_2026_12"] = true; }); buildHistory(); showTab("history"); window.scrollTo(0, 0); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: ziel("kuehe2-history.png"), fullPage: true });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: ziel("kuehe2-history-unten.png") });
  await browser.close(); server.close();
  console.log("Bilder gespeichert; Seitenfehler:", JSON.stringify(fehler));
})();
