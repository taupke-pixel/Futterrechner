// Bildschirmfotos: Timer auf dem Rechner und im Taschenrechner (Handy-Format) → tests/.tmp/timer-*.png
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
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto("http://localhost:5064/?emulator=1");
  await zugang.warteAufApp(page, "emulator");
  await page.setInputFiles("#backupFile", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(szenarien[0].backup)) });
  await page.waitForFunction(() => historyData.length > 10);
  const ziel = d => path.join(__dirname, ".tmp", d);
  // 1) Rechner: alle Gruppen zugeklappt, Timer unten, Countdown 8 Minuten eingestellt
  await page.evaluate(() => { showTab("calc"); ["kuehe","faersen","bullen","restbullen","trocken","kaelber"].forEach(c => data[c].collapsed = true); buildCalc(); });
  await page.locator("#timer-kasten").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ziel("timer-rechner.png") });
  // laufend
  await page.click("#timer-box .start");
  await page.waitForTimeout(2300);
  await page.locator("#timer-kasten").screenshot({ path: ziel("timer-rechner-laeuft.png") });
  await page.click("#timer-box .pause");
  await page.click("#timer-box button:has-text('Zurücksetzen')");
  // 2) Taschenrechner
  await page.evaluate(() => { TIMER_ORT = "calc2"; buildCalc(); buildCalc2(); showTab("calc2"); window.scrollTo(0, 0); });
  await page.screenshot({ path: ziel("timer-taschenrechner.png"), fullPage: true });
  // Alarm-Ansicht
  await page.evaluate(() => { timer.dauer = 2; timer.rest = 2; timerNeuZeichnen(); });
  await page.click("#timer-box .start");
  await page.waitForTimeout(3000);
  await page.locator("#timer-kasten").screenshot({ path: ziel("timer-alarm.png") });
  await browser.close(); server.close();
  console.log("Bilder gespeichert; Seitenfehler:", JSON.stringify(fehler));
})();
