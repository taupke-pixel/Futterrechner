// Prüft: Kühe „Speichern“ (zieht AGF/MLF vom Lager ab), dann nach kurzer Zeit App schließen/neu laden → Abzug genau einmal.
// Aufruf: node tests/lager-speichern.js <Ordner der App (absolut)> <Wartezeit ms vor dem Neuladen>
const path = require("path");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");
const szenarien = require("./szenarien");
(async () => {
  const wurzel = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const warte = +(process.argv[3] || 500);
  const server = await starteServer(wurzel, 5067);
  const browser = await chromium.launch();
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept());
  await page.clock.setFixedTime(new Date(szenarien[0].heute));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto("http://localhost:5067/?emulator=1");
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(szenarien[0].backup)) });
  await page.waitForFunction(() => historyData.length > 10);
  await page.evaluate(() => cloudSyncFertig());
  await page.waitForTimeout(2000);
  const vorher = await page.evaluate(() => [lagerData.agf.bestand, lagerData.mlf.bestand]);
  await page.evaluate(() => { showTab("calc"); saveHistory("kuehe"); });
  const direkt = await page.evaluate(() => [lagerData.agf.bestand, lagerData.mlf.bestand]);
  await page.waitForTimeout(warte);
  await page.reload();
  await zugang.warteAufApp(page, "emulator", true);
  await page.waitForTimeout(3000);
  const nachher = await page.evaluate(() => [lagerData.agf.bestand, lagerData.mlf.bestand]);
  console.log(wurzel.includes("live") ? "LIVE-FASSUNG" : "NEUE FASSUNG", "warte", warte, "vorher", vorher, "nach Speichern", direkt, "nach Neuladen", nachher,
    JSON.stringify(direkt) === JSON.stringify(nachher) ? "RICHTIG" : "FALSCH!");
  await browser.close(); server.close();
})();
