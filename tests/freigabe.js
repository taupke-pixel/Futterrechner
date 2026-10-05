// Ende-zu-Ende-Test Phase 2: Zugangsanfrage → Freigabe nur durch den Betreiber. Nur gegen den Emulator.
// Start: powershell -File tests\emulator.ps1 "node tests/freigabe.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5052;
const BASIS = `http://localhost:${PORT}/`;
const URL = BASIS + "?emulator=1";

async function neuesGeraet(browser, url = URL) {
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(url);
  return { context, page, meldungen };
}

const uidVon = page => page.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
const sichtbar = (page, id) => page.waitForFunction(i => { const e = document.getElementById(i); return e && getComputedStyle(e).display !== "none" && e.offsetParent !== null; }, id, { timeout: 20000 });

async function anfrageAusfuellen(page, betrieb, haken = true) {
  await sichtbar(page, "zugang-formular");
  await page.fill("#vorname", "Rita");
  await page.fill("#nachname", "Muster");
  await page.fill("#betriebsname", betrieb);
  await page.fill("#email", "rita@example.org");
  if (haken) { await page.check("#zustimmung-agb"); await page.check("#zustimmung-datenschutz"); }
  await page.click("#anfrage-knopf");
}

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n")[0]); }
  };
  try {
    // Fritz: Gerät im Betreiber-Betrieb
    const F = await neuesGeraet(browser);
    const uidF = await uidVon(F.page);
    await zugang.adminSchreiben("betriebe/FRITZ", { name: "Hof Fritz" });
    await zugang.geraetEintragenOeffentlich("FRITZ", uidF, "Fritz Handy");
    await zugang.adminSchreiben("system/betreiber", { betriebId: "FRITZ" });
    await F.page.reload();
    await zugang.warteAufApp(F.page, "emulator", true);

    const R = await neuesGeraet(browser);
    let link;

    await pruefe("Ohne Häkchen keine Anfrage", async () => {
      await anfrageAusfuellen(R.page, "Hof Rita", false);
      assert(R.meldungen.some(m => m.includes("AGB")), "kein Hinweis auf AGB");
      await R.page.check("#zustimmung-agb");
      await R.page.click("#anfrage-knopf");
      assert(R.meldungen.some(m => m.includes("Datenschutz")), "kein Hinweis auf Datenschutz");
      assert.strictEqual(await R.page.evaluate(() => window.__mails.length), 0);
    });

    await pruefe("Anfrage mit beiden Häkchen: gespeichert mit Fassungen + Serverzeit, E-Mail an Fritz", async () => {
      await R.page.check("#zustimmung-datenschutz");
      await R.page.click("#anfrage-knopf");
      await sichtbar(R.page, "zugang-warten");
      await R.page.waitForFunction(() => window.__mails.length > 0, null, { timeout: 15000 });
      const mail = await R.page.evaluate(() => window.__mails[0]);
      assert.strictEqual(mail.betrieb, "Hof Rita");
      assert(mail.agb_fassung && mail.datenschutz_fassung, "Fassungen fehlen in der E-Mail");
      link = mail.approve_link;
      assert(link.includes("?approve="), link);
      const id = new globalThis.URL(link).searchParams.get("approve");
      const roh = await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-futterrechner/databases/(default)/documents/anfragen/${id}`, { headers: { Authorization: "Bearer owner" } })).json();
      const a = { uid: roh.fields.uid.stringValue, agbFassung: roh.fields.agbFassung.stringValue, datenschutzFassung: roh.fields.datenschutzFassung.stringValue,
        zeitpunkt: roh.fields.zeitpunkt && roh.fields.zeitpunkt.timestampValue ? Date.parse(roh.fields.zeitpunkt.timestampValue) : 0, roh: JSON.stringify(roh.fields.zeitpunkt) };
      assert.strictEqual(a.agbFassung, await R.page.evaluate(() => AGB_FASSUNG));
      assert.strictEqual(a.datenschutzFassung, await R.page.evaluate(() => DATENSCHUTZ_FASSUNG));
      assert(a.zeitpunkt > 0, "Zeitpunkt fehlt: " + a.roh);
      assert.strictEqual(a.uid, await uidVon(R.page));
    });

    await pruefe("LÜCKE: Anfragender öffnet den Freigabe-Link selbst → keine Berechtigung", async () => {
      const R2 = await R.context.newPage();
      R2.on("dialog", d => d.accept());
      await R2.goto(link);
      try { await R2.waitForFunction(() => document.getElementById("freigabe-inhalt").textContent.includes("Keine Berechtigung"), null, { timeout: 20000 }); }
      catch (e) { throw new Error("Anzeige: " + JSON.stringify(await R2.evaluate(() => [document.getElementById("freigabe-inhalt").textContent, document.getElementById("freigabeBlock").style.display, location.href, document.getElementById("accessBlock").style.display]))); }
      // Auch direkt über die Datenbank geht es nicht
      const ergebnis = await R2.evaluate(async () => {
        const id = new URLSearchParams(location.search).get("approve");
        try { await db.collection("anfragen").doc(id).update({ status: "erlaubt" }); return "geschafft"; }
        catch (e) { return e.code; }
      });
      assert.strictEqual(ergebnis, "permission-denied");
      await R2.close();
    });

    await pruefe("Fritz gibt frei → App beim Anfragenden startet von selbst", async () => {
      const FP = await F.context.newPage();
      FP.on("dialog", d => d.accept());
      await FP.goto(link);
      await FP.waitForFunction(() => document.getElementById("freigabe-inhalt").textContent.includes("Hof Rita"), null, { timeout: 20000 });
      await FP.click("text=Freigeben – neuer Betrieb");
      await FP.waitForFunction(() => document.getElementById("freigabe-inhalt").textContent.includes("Freigegeben"), null, { timeout: 20000 });
      await FP.close();
      await zugang.warteAufApp(R.page, "emulator", true);
      await R.page.evaluate(() => showTab("settings"));
      await R.page.waitForFunction(() => document.getElementById("betrieb-name").textContent.includes("Hof Rita"), null, { timeout: 10000 });
    });

    await pruefe("Freigabe-Link ein zweites Mal: bereits entschieden", async () => {
      const FP = await F.context.newPage();
      await FP.goto(link);
      await FP.waitForFunction(() => document.getElementById("freigabe-inhalt").textContent.includes("bereits entschieden"), null, { timeout: 20000 });
      await FP.close();
    });

    await pruefe("Ablehnen über den Ablehnen-Link", async () => {
      const X = await neuesGeraet(browser);
      await anfrageAusfuellen(X.page, "Hof X");
      await sichtbar(X.page, "zugang-warten");
      await X.page.waitForFunction(() => window.__mails.length > 0, null, { timeout: 15000 });
      const deny = await X.page.evaluate(() => window.__mails[0].deny_link);
      const FP = await F.context.newPage();
      FP.on("dialog", d => d.accept());
      await FP.goto(deny);
      await FP.waitForFunction(() => document.querySelector("#freigabe-inhalt button"), null, { timeout: 20000 });
      await FP.click("text=Ablehnen");
      await FP.waitForFunction(() => document.getElementById("freigabe-inhalt").textContent.includes("abgelehnt"), null, { timeout: 20000 });
      await sichtbar(X.page, "zugang-abgelehnt");
      await X.context.close();
    });

    await pruefe("Fritz-Gerät: Futterdaten anderer Betriebe nicht lesbar", async () => {
      const bid = await R.page.evaluate(() => betriebId);
      const ergebnis = await F.page.evaluate(async bid => {
        try { await db.collection("betriebe").doc(bid).collection("daten").doc("futter").get({ source: "server" }); return "gelesen"; }
        catch (e) { return e.code; }
      }, bid);
      assert.strictEqual(ergebnis, "permission-denied");
    });

    await pruefe("Keine Seitenfehler", async () => {
      assert.deepStrictEqual([...F.meldungen, ...R.meldungen].filter(m => m.startsWith("SEITENFEHLER")), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nFREIGABE-TEST ROT (${fehler} Fehler)` : "\nFREIGABE-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
