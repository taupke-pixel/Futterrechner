// Bildschirmfotos: Reiter „Fressmenge“ mit Futtergruppen (tests/.tmp/gruppen-*.png), Handy-Format.
// Mit echten Stallzahlen: Kopplungscode als Umgebungsvariable FM_KOPPLUNG (nie ins Repository schreiben), sonst ohne Verbindung.
const path = require("path");
const { chromium, devices } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

(async () => {
  const server = await starteServer(path.join(__dirname, ".."), 5076);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE", timezoneId: "Europe/Berlin" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept(d.type() === "prompt" ? page.antwort || "" : undefined));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto("http://localhost:5076/?emulator=1&testversion=1");
  await zugang.warteAufApp(page, "emulator");
  await page.click("#fm-tab");
  const code = process.env.FM_KOPPLUNG || "";
  if (code) {
    await page.fill("#fm-kopplung", code);
    await page.click("#fressmenge >> text=Verbinden");
    await page.waitForFunction(() => /Ställe|passt nicht|Verbindung/.test(document.getElementById("fm-hm-stand").textContent), null, { timeout: 20000 });
    const id = name => page.evaluate(n => (fmPlaetze().find(p => p.name === n && p.typ === "stall") || {}).id, name);
    page.antwort = "Hochleistung"; await page.click("text=+ Neue Futtergruppe");
    for (const n of ["Stall 1", "Strohstall"]) { const i = await id(n); if (i) await page.evaluate(i => { fmCfg.gruppen[0].staelle.push(i); fmSpeichern(); }, i); }
    page.antwort = "Altmelker"; await page.click("text=+ Neue Futtergruppe");
    { const i = await id("Stall 2"); if (i) await page.evaluate(i => { fmCfg.gruppen[1].staelle.push(i); fmCfg.gruppen[1].karte = "kuehe2"; fmSpeichern(); }, i); }
    page.antwort = "Bullen Scheune"; await page.click("text=+ Neue Futtergruppe");
    { const i = await id("Scheune"); if (i) await page.evaluate(i => { const g = fmCfg.gruppen[2]; g.staelle.push(i); g.karte = "restbullen"; g.art = "ohne"; fmSpeichern(); }, i); }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "gruppen-1.png") });
  await page.evaluate(() => window.scrollBy(0, 750));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "gruppen-2.png") });
  await page.locator("#fm-nicht-zugeordnet").evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 10));
  await page.screenshot({ path: path.join(__dirname, ".tmp", "gruppen-3.png") });
  await browser.close(); server.close();
  console.log("Bilder gespeichert");
})();
