// Test: mehrere Geräte im selben Betrieb (gleichzeitig, offline, Gerät entfernen). Nur gegen den Emulator.
// Start: firebase emulators:exec --only auth,firestore --project demo-futterrechner "node tests/sync.js"
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { starteServer } = require("./server");
const zugang = require("./zugang");

const PORT = 5051;
const URL = `http://localhost:${PORT}/?emulator=1`;

async function neuesGeraet(browser) {
  const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "de-DE" });
  const page = await context.newPage();
  const meldungen = [];
  page.on("dialog", d => { meldungen.push(d.message()); d.accept(); });
  page.on("pageerror", e => meldungen.push("SEITENFEHLER: " + e.message));
  page.on("console", m => meldungen.push("KONSOLE: " + m.text()));
  await zugang.vorbereiten(context, page, "emulator");
  await page.goto(URL);
  return { context, page, meldungen };
}

async function warteBis(page, fn, arg, ms = 15000) {
  await page.waitForFunction(fn, arg, { timeout: ms });
}

const bestand = (page, p) => page.evaluate(p => lagerData[p].bestand, p);

async function main() {
  const server = await starteServer(path.join(__dirname, ".."), PORT);
  const browser = await chromium.launch();
  let fehler = 0;
  const pruefe = async (name, fn) => {
    try { await fn(); console.log("✔ " + name); }
    catch (e) { fehler++; console.log("✘ " + name + "\n   " + e.message.split("\n")[0]); if (process.env.SYNCDEBUG) console.log(global.__meldungen && global.__meldungen().slice(-15).join("\n")); }
  };
  try {
    const A = await neuesGeraet(browser);
    await zugang.warteAufApp(A.page, "emulator");
    const betrieb = await A.page.evaluate(() => betriebId);
    const B = await neuesGeraet(browser);
    global.__meldungen = () => B.meldungen;
    const uidB = await B.page.evaluate(async () => { while (!geraeteUid) await new Promise(r => setTimeout(r, 50)); return geraeteUid; });
    await zugang.geraetEintragenOeffentlich(betrieb, uidB, "Gerät B");
    await B.page.reload();
    await zugang.warteAufApp(B.page, "emulator", true);

    await pruefe("Änderung auf Gerät A erscheint auf Gerät B", async () => {
      await A.page.evaluate(() => { data.kuehe.anz = 77; save(); });
      await warteBis(B.page, () => data.kuehe.anz === 77);
      const txt = await B.page.textContent("#calc");
      assert(txt.includes("Kühe"), "Anzeige fehlt");
      assert.strictEqual(await B.page.inputValue(".cat-kuehe + .cat-body input"), "77");
    });

    await pruefe("Gleichzeitige Lieferungen auf A und B: Bestand stimmt (Abziehen/Hinzufügen)", async () => {
      const vorher = await bestand(A.page, "agf");
      await Promise.all([
        A.page.evaluate(() => { lieferungen.unshift({ id: "la1", produkt: "agf", datum: "01.01.2027", menge: 100 }); lagerData.agf.bestand += 100; saveLieferungen(); saveLagerStorage(); }),
        B.page.evaluate(() => { lieferungen.unshift({ id: "lb1", produkt: "agf", datum: "01.01.2027", menge: 250 }); lagerData.agf.bestand += 250; saveLieferungen(); saveLagerStorage(); })
      ]);
      try {
        await warteBis(A.page, v => lagerData.agf.bestand === v && lieferungen.length === 2 && lagerData.mlf.orange === 5 && lagerData.mlf.lieferzeit === 2, vorher + 350);
        await warteBis(B.page, v => lagerData.agf.bestand === v && lieferungen.length === 2 && lagerData.mlf.orange === 5 && lagerData.mlf.lieferzeit === 2, vorher + 350);
      } catch (e) {
        const st = p => p.evaluate(() => JSON.stringify({ b: lagerData.agf.bestand, l: lieferungen.map(x => x.id), stand: cloud.stand.lager, offen: cloud.offen }));
        throw new Error(`vorher ${vorher} | A ${await st(A.page)} | B ${await st(B.page)}`);
      }
    });

    await pruefe("Gerät B offline: speichert weiter, gleicht nach Netz-Rückkehr ab", async () => {
      await B.context.setOffline(true);
      await B.page.evaluate(() => { lieferungen.unshift({ id: "lb2", produkt: "mlf", datum: "02.01.2027", menge: 40 }); lagerData.mlf.bestand += 40; saveLieferungen(); saveLagerStorage(); });
      await A.page.evaluate(() => { lieferungen.unshift({ id: "la2", produkt: "mlf", datum: "02.01.2027", menge: 60 }); lagerData.mlf.bestand += 60; saveLieferungen(); saveLagerStorage(); });
      await B.page.waitForTimeout(1500);
      const offlineText = await B.page.textContent("#sync-status");
      assert(offlineText.includes("offline"), "Offline-Hinweis fehlt: " + offlineText);
      // Ohne Datenbank-Verbindung neu laden (Seite selbst kommt im Stall aus App/Browser-Speicher):
      // Daten müssen aus dem Offline-Speicher kommen, die offline gespeicherte Lieferung muss noch da sein
      await B.context.setOffline(false);
      await B.context.route(/:(8080|9099)\//, r => r.abort());
      await B.page.reload();
      try { await zugang.warteAufApp(B.page, "emulator", true); }
      catch (e) {
        throw new Error("App startet ohne Verbindung nicht: " + await B.page.evaluate(() =>
          JSON.stringify({ status: document.getElementById("sync-status").textContent, uid: geraeteUid, betriebId, aktiv: cloud.aktiv, lager: lagerData, calc: document.getElementById("calc").innerHTML.length })) + " " + B.meldungen.filter(m => m.startsWith("SEITENFEHLER")).join(" | "));
      }
      assert.strictEqual(await B.page.evaluate(() => lieferungen.some(l => l.id === "lb2")), true, "Offline-Lieferung nach Neuladen weg");
      assert.strictEqual(await B.page.evaluate(() => lagerData.mlf.bestand), 40, "Offline-Lagerbestand nach Neuladen falsch");
      await B.context.unroute(/:(8080|9099)\//);
      await warteBis(A.page, () => lagerData.mlf.bestand === 100 && lieferungen.length === 4, null, 30000);
      await warteBis(B.page, () => lagerData.mlf.bestand === 100 && lieferungen.length === 4, null, 30000);
    });

    await pruefe("History-Eintrag auf B löschen → auf A weg, Lager zurückgebucht", async () => {
      await A.page.evaluate(() => { data.kuehe.items[8].kg = 2; save(); saveHistory("kuehe"); });
      await warteBis(B.page, () => historyData.some(h => h.kategorie === "kuehe"));
      const agfB = await bestand(B.page, "agf");
      await B.page.evaluate(() => deleteHistory(historyData.find(h => h.kategorie === "kuehe").id));
      await warteBis(A.page, v => !historyData.some(h => h.kategorie === "kuehe") && Math.abs(lagerData.agf.bestand - v - 154) < 1e-6, agfB);
    });

    await pruefe("Gerät B entfernen → B verliert sofort den Zugriff", async () => {
      await A.page.evaluate(async uid => {
        const b = db.batch();
        b.delete(db.collection("betriebe").doc(betriebId).collection("geraete").doc(uid));
        b.delete(db.collection("geraetezuordnung").doc(uid));
        await b.commit();
      }, uidB);
      await warteBis(B.page, () => { const b = document.getElementById("accessBlock"); return b && b.style.display === "flex"; }, null, 20000);
      assert(B.meldungen.some(m => m.includes("entfernt")), "Hinweis fehlt");
      const reste = await B.page.evaluate(() => ["futter", "history", "lager", "lieferungen", "betriebId"].filter(k => localStorage.getItem(k)));
      assert.deepStrictEqual(reste, [], "Daten liegen noch auf dem Gerät: " + reste);
    });

    await pruefe("Keine Seitenfehler", async () => {
      const alle = [...A.meldungen, ...B.meldungen].filter(m => m.startsWith("SEITENFEHLER"));
      assert.deepStrictEqual(alle, [], alle.join(" | "));
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fehler ? `\nSYNC-TEST ROT (${fehler} Fehler)` : "\nSYNC-TEST GRÜN");
  process.exit(fehler ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
