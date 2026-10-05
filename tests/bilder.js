// Screenshots der neuen Seiten im Handy-Format (für die Sichtprüfung). Braucht laufenden Emulator.
// Start: powershell -File tests\emulator.ps1 "node tests/bilder.js"   → Bilder in tests/.tmp/bilder/
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5054;
const URL = `http://localhost:${PORT}/?emulator=1`;
const ZIEL = path.join(__dirname, ".tmp", "bilder");

(async () => {
  fs.mkdirSync(ZIEL, { recursive: true });
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  const neu = async () => {
    const context = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE", timezoneId: "Europe/Berlin" });
    const page = await context.newPage();
    page.on("dialog", d => d.accept());
    await zugang.vorbereiten(context, page, "emulator");
    await page.goto(URL);
    return page;
  };
  const bild = (page, name) => page.screenshot({ path: path.join(ZIEL, name + ".png"), fullPage: true });

  const A = await neu();
  const uid = await A.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
  await A.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex");
  await bild(A, "1-zugang-anfragen");
  await A.click("text=Ich habe eine PIN");
  await bild(A, "2-zugang-pin");
  await zugang.adminSchreiben("betriebe/BILD", { name: "Hof Sonnenschein" });
  await zugang.geraetEintragenOeffentlich("BILD", uid, "Handy Fritz");
  await A.reload();
  await zugang.warteAufApp(A, "emulator", true);
  await bild(A, "3-rechner");
  await A.evaluate(() => showTab("settings"));
  await A.waitForTimeout(800);
  await A.evaluate(() => document.getElementById("betrieb").scrollIntoView());
  await bild(A, "4a-vor-klick");
  await A.click("#einladen-knopf", { timeout: 5000 }).catch(async e => { console.log("Klick blockiert"); await A.evaluate(() => einladungErzeugen()); });
  await A.waitForSelector("#einladung-qr svg");
  await A.evaluate(() => document.getElementById("betrieb").scrollIntoView());
  await bild(A, "4-einstellungen-geraete");
  const code = await A.evaluate(() => aktiveEinladung.qr);
  const B = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE" });
  const bp = await B.newPage();
  await zugang.vorbereiten(B, bp, "emulator");
  await bp.goto(`http://localhost:${PORT}/?einladung=${code}&emulator=1`);
  await bp.waitForSelector("#einladung-knopf");
  await bild(bp, "5-qr-einladung-android");
  await bp.goto(`http://localhost:${PORT}/download.html?einladung=${code}`);
  await bild(bp, "6-download");
  await browser.close();
  server.close();
  console.log("Bilder in " + ZIEL);
})();
