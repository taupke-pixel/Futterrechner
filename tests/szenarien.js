// Feste Beispieldaten für den Vergleichstest.
// Jedes Szenario ist eine Backup-Datei (gleiches Format wie „Backup erstellen“) + ein fester „heute“-Zeitpunkt.
// Die Daten kommen über den Knopf „Backup laden“ in die App – das funktioniert in jeder Version gleich.

function items(namen, kg, agf, mlf) {
  const a = namen.map((n, i) => ({ name: n, kg: kg[i] }));
  a.push({ type: "agf", kg: agf });
  a.push({ type: "mlf", kg: mlf });
  return a;
}

const FUTTER = ["Maissilage", "Grassilage", "Stroh", "Rapsschrot", "Mineral", "Futter 6", "Futter 7", "Futter 8"];

function datum(tag, monat, jahr) {
  return `${String(tag).padStart(2, "0")}.${String(monat).padStart(2, "0")}.${jahr}`;
}

// History-Einträge wie saveHistory() sie anlegt
function eintrag(nr, d, kat, tiere, futterListe) {
  const e = { id: "t" + String(nr).padStart(4, "0") + "abcde", datum: d, kategorie: kat, tiere, gesamt: 0, agf: 0, mlf: 0, futter: [] };
  futterListe.forEach(([name, kg, typ]) => {
    e.futter.push({ name, kg });
    e.gesamt += kg;
    if (typ === "agf") e.agf += kg;
    if (typ === "mlf") e.mlf += kg;
  });
  return e;
}

function szenario1() {
  const history = [];
  let nr = 1;
  // 20 Tage Kühe + Färsen + Bullen rückwärts ab 17.12.2026, dazu ein paar Restmischungen
  for (let i = 1; i <= 20; i++) {
    const d = new Date(2026, 11, 18 - i);
    const ds = datum(d.getDate(), d.getMonth() + 1, d.getFullYear());
    history.push(eintrag(nr++, ds, "kuehe", 118 + (i % 3), [["Maissilage", 2360.4 + i], ["Grassilage", 1180.25], ["Kraftfutter AGF", 413 + i * 0.7, "agf"], ["Milchleistungsfutter", 236.6 - i * 0.3, "mlf"]]));
    if (i % 2 === 0) history.push(eintrag(nr++, ds, "faersen", 31, [["Grassilage", 434], ["Stroh", 62], ["Kraftfutter AGF", 31, "agf"]]));
    if (i % 3 === 0) history.push(eintrag(nr++, ds, "bullen", 12, [["Maissilage", 216], ["Kraftfutter AGF", 30.6, "agf"]]));
    if (i % 4 === 0) history.push(eintrag(nr++, ds, "restbullen", 9, [["Maissilage", 41.3], ["Kraftfutter AGF", 6.25, "agf"]]));
  }
  // ältere Einträge (anderes Jahr, anderer Monat)
  history.push(eintrag(nr++, "30.12.2025", "kuehe", 110, [["Maissilage", 2200], ["Kraftfutter AGF", 385, "agf"], ["Milchleistungsfutter", 220, "mlf"]]));
  history.push(eintrag(nr++, "15.06.2026", "kaelber", 22, [["Heu", 33], ["Milchleistungsfutter", 11, "mlf"]]));
  history.push(eintrag(nr++, "16.06.2026", "trocken", 6, [["Stroh", 60.5]]));

  return {
    name: "s1-niedersachsen-dezember",
    heute: "2026-12-18T09:15:00",
    backup: {
      data: {
        kuehe: { anz: 120, items: items(FUTTER, [20, 10, 1.5, 0, 0.25, 0, 0, 0], 3.5, 2), collapsed: false },
        faersen: { anz: 31, items: items(FUTTER, [0, 14, 2, 0.4, 0, 0, 0, 0], 1, 0), collapsed: false },
        restbullen: { rest: 0, ziel: 0, anz: 0, collapsed: false },
        bullen: { anz: 12, items: items(FUTTER, [18, 0, 0.8, 1.2, 0, 0, 0, 0], 2.55, 0), collapsed: false },
        trocken: { anz: 6, items: items(FUTTER, [0, 6, 4, 0, 0.1, 0, 0, 0], 0, 0), collapsed: false },
        kaelber: { anz: 22, items: items(FUTTER, [0, 0, 0, 0, 0, 1.5, 0, 0], 0, 0.5), collapsed: false }
      },
      globalCfg: {
        agfName: "Kraftfutter AGF", mlfName: "Milchleistungsfutter", bundesland: "Niedersachsen",
        agfKg: 0.7, mlfKg: 0.45,
        kueheName: "Kühe", faersenName: "Färsen", bullenName: "Bullen",
        restbullenName: "Restmischung Bullen", trockenName: "Trockensteher", kaelberName: "Kälber"
      },
      historyData: history,
      lagerData: {
        agf: { bestand: 4380.5, orange: 12, rot: 6, lieferzeit: 3 },
        mlf: { bestand: 410.75, orange: 5, rot: 2, lieferzeit: 2 }
      },
      lieferungen: [
        { id: "l0002xyz", produkt: "agf", datum: "10.12.2026", menge: 6000 },
        { id: "l0001xyz", produkt: "mlf", datum: "01.12.2026", menge: 2500.5 }
      ],
      hiddenWarnings: {},
      historyCollapsed: { tageslog: true, lager: false, lieferungen: false, verlauf: false, kategorien: {}, jahre: {}, monate: {}, wochen: {} }
    },
    restmischung: { rest: 850, ziel: 0, anz: 9 },
    lieferung: { produkt: "mlf", datum: "2026-12-18", menge: 1200 },
    rechner: ["1", "2", ".", "5", "*", "3", "=", "-", "7", "=", "C", "9", "/", "4", "="]
  };
}

function szenario2() {
  // Bayern, Mai 2027: Fronleichnam (27.05.2027) und Pfingstmontag (17.05.2027) liegen im Bestellzeitraum
  const history = [];
  let nr = 1;
  for (let i = 1; i <= 16; i++) {
    const d = new Date(2027, 4, 24 - i);
    const ds = datum(d.getDate(), d.getMonth() + 1, d.getFullYear());
    history.push(eintrag(nr++, ds, "kuehe", 80, [["Maissilage", 1600], ["AGF", 200 + (i % 5) * 3.3, "agf"], ["MLF", 120.4, "mlf"]]));
  }
  return {
    name: "s2-bayern-feiertage",
    heute: "2027-05-24T17:40:00",
    backup: {
      data: {
        kuehe: { anz: 80, items: items(FUTTER, [20, 0, 0, 0, 0, 0, 0, 0], 2.5, 1.5), collapsed: false },
        faersen: { anz: 0, items: items(FUTTER, [0, 0, 0, 0, 0, 0, 0, 0], 0, 0), collapsed: true },
        restbullen: { rest: 0, ziel: 0, anz: 0, collapsed: false },
        bullen: { anz: 15, items: items(FUTTER, [16, 0, 0, 0, 0, 0, 0, 0], 2, 0), collapsed: false },
        trocken: { anz: 5, items: items(FUTTER, [0, 0, 0, 0, 0, 0, 0, 0], 0, 0), collapsed: false },
        kaelber: { anz: 20, items: items(FUTTER, [0, 0, 0, 0, 0, 0, 0, 0], 0, 0), collapsed: false }
      },
      globalCfg: {
        agfName: "AGF", mlfName: "MLF", bundesland: "Bayern", agfKg: 0.5, mlfKg: 0.5,
        kueheName: "Milchkühe", faersenName: "Färsen", bullenName: "Mastbullen",
        restbullenName: "Rest Bullen", trockenName: "Trockensteher", kaelberName: "Kälber"
      },
      historyData: history,
      lagerData: {
        agf: { bestand: 1050, orange: 7, rot: 4, lieferzeit: 3 },
        mlf: { bestand: 250, orange: 5, rot: 2, lieferzeit: 0 }
      },
      lieferungen: [],
      hiddenWarnings: {},
      historyCollapsed: { tageslog: true, lager: false, lieferungen: false, verlauf: false, kategorien: {}, jahre: {}, monate: {}, wochen: {} }
    },
    restmischung: { rest: 600, ziel: 1000, anz: null },
    lieferung: { produkt: "agf", datum: "", menge: 3000 },
    rechner: ["8", "+", "0", ".", "1", "=", "⌫", "*", "2", "="]
  };
}

function szenario3() {
  // Neues Gerät ohne Daten: Standardwerte
  return { name: "s3-leer", heute: "2026-10-05T06:00:00", backup: null, restmischung: { rest: 100, ziel: 0, anz: 0 }, lieferung: null, rechner: ["2", "+", "2", "="] };
}

module.exports = [szenario1(), szenario2(), szenario3()];
