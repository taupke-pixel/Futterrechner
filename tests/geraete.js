// Ende-zu-Ende-Test Phase 3: Geräte per PIN / QR-Code hinzufügen und entfernen. Nur gegen den Emulator.
// Start: powershell -File tests\emulator.ps1 "node tests/geraete.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5053;
const BASIS = `http://localhost:${PORT}/`;
const URL_EMU = BASIS + "?emulator=1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

async function neuesGeraet(browser, url = URL_EMU, ua) {
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE", ...(ua ? { userAgent: ua } : {}) });
  const page = await context.newPage();
  const meldungen = [];
  const geraet = { context, page, meldungen, antwort: undefined };
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(geraet.antwort); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(url);
  return geraet;
}
const uidVon = page => page.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
const appDa = page => zugang.warteAufApp(page, "emulator", true);

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n")[0]); }
  };
  try {
    const A = await neuesGeraet(browser);
    const uidA = await uidVon(A.page);
    await zugang.adminSchreiben("betriebe/HOF", { name: "Hof Sonnenschein" });
    await zugang.geraetEintragenOeffentlich("HOF", uidA, "Handy Fritz");
    await A.page.reload();
    await appDa(A.page);
    await A.page.evaluate(() => showTab("settings"));
    await A.page.waitForFunction(() => document.querySelectorAll("#geraete-liste .history-item").length === 1, null, { timeout: 15000 });

    let pin;
    const N = await neuesGeraet(browser);

    await pruefe("Neues Handy per PIN hinzufügen – in unter einer Minute", async () => {
      const start = Date.now();
      await A.page.click("#einladen-knopf");
      await A.page.waitForSelector("#einladung-pin", { timeout: 15000 });
      pin = (await A.page.textContent("#einladung-pin")).replace(/\D/g, "");
      assert.strictEqual(pin.length, 8);
      assert(await A.page.$("#einladung-qr svg"), "QR-Code fehlt");
      await N.page.click("text=Ich habe eine PIN");
      await N.page.fill("#pin-eingabe", pin.slice(0, 4) + " " + pin.slice(4));
      await N.page.fill("#pin-geraetename", "Handy Stall");
      await N.page.click("#zugang-pin >> text=Beitreten");
      await appDa(N.page);
      const sekunden = (Date.now() - start) / 1000;
      assert(sekunden < 60, `dauerte ${sekunden} s`);
      await A.page.waitForFunction(() => document.getElementById("geraete-liste").textContent.includes("Handy Stall"), null, { timeout: 15000 });
      console.log(`   (Dauer im Test: ${sekunden.toFixed(1)} s)`);
    });

    await pruefe("Dieselbe PIN ein zweites Mal → abgelehnt", async () => {
      const M = await neuesGeraet(browser);
      await M.page.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 20000 });
      await M.page.click("text=Ich habe eine PIN");
      await M.page.fill("#pin-eingabe", pin);
      await M.page.click("#zugang-pin >> text=Beitreten");
      await M.page.waitForFunction(() => true);
      await new Promise(r => setTimeout(r, 2500));
      assert(M.meldungen.some(m => m.includes("ungültig")), "keine Fehlermeldung: " + M.meldungen.join(" | "));
      const hatZugang = await M.page.evaluate(async () => (await db.collection("geraetezuordnung").doc(geraeteUid).get()).exists);
      assert.strictEqual(hatZugang, false);
      await M.context.close();
    });

    await pruefe("QR-Code (Link) am PC öffnen → beitreten", async () => {
      await A.page.click("#einladen-knopf");
      await A.page.waitForSelector("#einladung-qr svg", { timeout: 15000 });
      const code = await A.page.evaluate(() => aktiveEinladung.qr);
      const Q = await neuesGeraet(browser, `${BASIS}?einladung=${code}&emulator=1`);
      await Q.page.waitForFunction(() => document.getElementById("einladung-inhalt").textContent.includes("Hof Sonnenschein"), null, { timeout: 20000 });
      await Q.page.fill("#einladung-geraetename", "Büro-PC");
      await Q.page.click("#einladung-knopf");
      await appDa(Q.page);
      assert(!Q.page.url().includes("einladung="), "Einladung steht noch in der Adresse");
      await A.page.waitForFunction(() => document.getElementById("geraete-liste").textContent.includes("Büro-PC"), null, { timeout: 15000 });
      await Q.context.close();
    });

    await pruefe("QR-Code auf Android-Browser: 'In der App öffnen' mit Download-Seite als Ausweichziel", async () => {
      await A.page.click("#einladen-knopf");
      await A.page.waitForSelector("#einladung-qr svg", { timeout: 15000 });
      const code = await A.page.evaluate(() => aktiveEinladung.qr);
      const H = await neuesGeraet(browser, `${BASIS}?einladung=${code}&emulator=1`, ANDROID_UA);
      await H.page.waitForSelector("text=In der App öffnen", { timeout: 20000 });
      const href = await H.page.getAttribute("text=In der App öffnen", "href");
      assert(href.startsWith("intent://einladung?code=" + code), href);
      assert(href.includes("package=de.stallultra.futterrechner"), href);
      assert(href.includes(encodeURIComponent("download.html?einladung=" + code)), href);
      await H.context.close();
    });

    await pruefe("Abgelaufener QR-Code (11 Minuten) → abgelehnt", async () => {
      const alt = "AltAltAltAltAltAltAltAltAltAltAltAlt1234";
      await zugang.adminSchreiben(`einladungen/${alt}`, { betriebId: "HOF", betriebName: "Hof Sonnenschein", von: uidA, art: "qr" });
      // erstellt 11 Minuten in der Vergangenheit
      await fetch(`http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents/einladungen/${alt}?updateMask.fieldPaths=erstellt`, {
        method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { erstellt: { timestampValue: new Date(Date.now() - 11 * 60000).toISOString() } } })
      });
      const X = await neuesGeraet(browser, `${BASIS}?einladung=${alt}&emulator=1`);
      await X.page.waitForSelector("#einladung-knopf", { timeout: 20000 });
      await X.page.click("#einladung-knopf");
      await new Promise(r => setTimeout(r, 2500));
      assert(X.meldungen.some(m => m.includes("abgelaufen")), "keine Meldung: " + X.meldungen.join(" | "));
      await X.context.close();
    });

    await pruefe("Download-Seite allein gibt keinen Zugriff", async () => {
      const D = await neuesGeraet(browser, BASIS + "download.html");
      assert(await D.page.$("a[download][href$='.apk']"), "Download-Link fehlt");
      await D.page.goto(URL_EMU);
      await D.page.waitForFunction(() => document.getElementById("accessBlock").style.display === "flex", null, { timeout: 20000 });
      const hatDaten = await D.page.evaluate(() => !!document.querySelector("#calc .category"));
      assert.strictEqual(hatDaten, false);
      await D.context.close();
    });

    await pruefe("Gerät in der Liste entfernen → verliert sofort den Zugriff", async () => {
      const uidN = await uidVon(N.page);
      await A.page.click(`button[onclick="geraetEntfernen('${uidN}')"]`);
      await N.page.waitForFunction(() => { const b = document.getElementById("accessBlock"); return b && b.style.display === "flex"; }, null, { timeout: 20000 });
      assert(N.meldungen.some(m => m.includes("entfernt")));
      await A.page.waitForFunction(() => !document.getElementById("geraete-liste").textContent.includes("Handy Stall"), null, { timeout: 15000 });
    });

    await pruefe("Gerät umbenennen", async () => {
      A.antwort = "Handy Fritz neu";
      await A.page.click(`button[onclick="geraetUmbenennen('${uidA}')"]`);
      await A.page.waitForFunction(() => document.getElementById("geraete-liste").textContent.includes("Handy Fritz neu"), null, { timeout: 15000 });
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual([...A.meldungen, ...N.meldungen].filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nGERÄTE-TEST ROT (${fehler} Fehler)` : "\nGERÄTE-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
