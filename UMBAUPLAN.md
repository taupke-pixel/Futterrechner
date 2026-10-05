# Umbauplan Futterrechner „Stall Ultra“

Stand: 05.10.2026 · Grundlage: `index.html` auf `main` (Commit `d250375`) · Regeln: siehe `CLAUDE.md` · Kurzfassung für Fritz: `FORTSCHRITT.md`

Legende: ✅ fertig · 🧑‍🌾 = macht Fritz selbst · 🔒 = braucht Fritz' ausdrückliche Freigabe · 🧪 = Test

Branches (jeder baut auf dem vorigen auf, alle auf GitHub, **nichts in `main`**):
`umbau/00-vergleichstest` → `umbau/01-mehrere-betriebe` → `umbau/02-zugangsanfrage` → `umbau/03-mehrere-geraete` → `umbau/04-android-app`

---

## Ausgangslage (vor dem Umbau)

| Was | Wo gespeichert |
|---|---|
| Rationen, Tierzahlen, Einstellungen, History, Lager, Lieferungen | nur localStorage des Browsers |
| Zugangsanfragen (`anfragen`), freigegebene Geräte (`zugriffe`) | Firestore, echtes Projekt `futterrechner` |

Echte Datenbank (nur gelesen am 05.10.2026): 17 Anfragen (13 erlaubt, 4 offen), 16 Einträge in `zugriffe`, Region europe-west1.
Echte Regeln: `anfragen` und `zugriffe` für jeden lesbar/schreibbar → FEHLER.md F11.

---

## Phase 0 – Vorbereitung ✅
- 0.1 ✅ Vergleichstest `tests/vergleich.js` (3 Szenarien, alle Anzeigen + Backup-Inhalt, gegen Original `d250375`).
- 0.2 ✅ Testprojekt `futterrechner-test-stall` (Firestore europe-west1, Hosting https://futterrechner-test-stall.web.app).
  🧑‍🌾 offen: anonyme Anmeldung im Testprojekt einschalten (nur per Klick möglich).
- 0.3 ✅ Umschalter: `localhost` und Test-Webseite → Testprojekt, `?emulator=1` → lokaler Emulator, sonst echtes Projekt.
- 0.4 ✅ Ist-Zustand echte DB gelesen (s. o.).

## Phase 1 – Mehrere Betriebe ✅
Datenmodell:
```
betriebe/{betriebId}                       name, angelegt, anfrageId
betriebe/{betriebId}/geraete/{uid}         name, seit, anfrageId | einladung
betriebe/{betriebId}/daten/futter          { inhalt: data, geaendert, von }   (restbullen wird wie bisher beim Laden ignoriert)
betriebe/{betriebId}/daten/einstellungen   { inhalt: globalCfg, ... }
betriebe/{betriebId}/daten/lager           { inhalt: lagerData, ... }  Bestand per increment (Abziehen/Hinzufügen)
betriebe/{betriebId}/history/{JJJJ-MM}     { eintraege: [ {id, s, e} ] }  je Monat ein Dokument (Lesekosten!)
betriebe/{betriebId}/lieferungen/{JJJJ-MM} { eintraege: [ {id, s, e} ] }
geraetezuordnung/{uid}                     betriebId
```
`s` = Sortierwert (größer = weiter oben, entspricht bisherigem `unshift`), `e` = Eintrag unverändert.
- Speicherfunktionen schreiben wie bisher in localStorage und melden an `cloudSpeichern(art)` → gebündelt nach 400 ms
  bzw. beim Verlassen der Seite. Laden beim Start aus dem Betrieb (`cloudAbonnieren`), Änderungen anderer Geräte live.
- Offline-Speicher (`enablePersistence`), Sync-Anzeige im Kopf (☁️/⏳/📴).
- Übernahme alter Daten: Knopf „In den Betrieb übernehmen“ (nutzt `importBackup`) oder „Backup laden“.
- 🧪 `tests/regeln.test.js`, `tests/vergleich.js`, `tests/sync.js` grün.

## Phase 2 – Zugangsanfrage + Freigabe ✅
- Anfrage: Vorname, Nachname, Betrieb, E-Mail, 2 Pflicht-Häkchen. Gespeichert: `uid`, `agbFassung`, `datenschutzFassung`,
  `zeitpunkt` (= Serverzeit, in Rules erzwungen), `alteGeraeteId`. Anfragender kann nie ändern/löschen.
- Betreiber = alle Geräte des Betriebs in `system/betreiber.betriebId` (von Hand gesetzt, `werkzeuge/betreiber-einrichten.js`).
- Freigabe-Seite (`?approve=` / `?deny=`): nur Betreiber; neuer Betrieb oder zu bestehendem Betrieb hinzufügen.
- Fassungen: `AGB_FASSUNG` / `DATENSCHUTZ_FASSUNG` in index.html **und** in agb.html / datenschutz.html (Platzhalter).
- 🧪 `tests/freigabe.js` grün (u. a. Selbstfreigabe unmöglich).

## Phase 3 – Mehrere Geräte ✅
- `einladungen/{code}`: PIN (8 Ziffern) und QR (40 Zeichen), `erstellt` = Serverzeit, 10 Minuten gültig (Rules),
  einmalig (wird beim Einlösen im selben Paket gelöscht). QR wird im Gerät erzeugt (qrcode-generator 1.4.4, cdnjs).
- QR-Link `…/?einladung=CODE`: in der App → direkt beitreten; im Android-Browser → „In der App öffnen“
  (intent://, Ausweichziel `download.html?einladung=…`) oder im Browser beitreten.
- Geräteliste mit Umbenennen/Entfernen in Einstellungen → Betrieb (Sprung-Knopf „👥 Betrieb & Geräte“ im Kopf).
- 🧪 `tests/geraete.js` grün (PIN-Beitritt < 1 Minute, abgelaufen/benutzt abgelehnt, Download-Link ohne Zugriff).

## Phase 4 – Android-App ✅ (Gerätetest im Emulator: siehe FORTSCHRITT.md)
- `android/`: WebView-App (Java), Varianten `live` (lädt GitHub Pages, Paket `de.stallultra.futterrechner`) und
  `probe` (lädt Test-Webseite, Paket `…futterrechner.test`). Eigener Speicher, Backup über Android-Dateiauswahl,
  Einladungen per `futterrechner://einladung?code=` und App Links.
- Bauen: `android\gradlew.bat assembleLiveRelease assembleProbeRelease` (JAVA_HOME = Temurin 21, SDK in
  `%LOCALAPPDATA%\Android\Sdk`). Ergebnis nach `app/futterrechner.apk` bzw. `app/futterrechner-test.apk` kopieren.
- Signatur: `android/futterrechner.jks` + `android/keystore.properties` – **nicht im Repo, Fritz muss sie sichern**.
- Kostenlos: kein Play Store; Link auf `download.html` verschicken. APK liegt auf GitHub Pages (Firebase Spark verbietet APKs
  auf Hosting → Test-APK kommt per raw.githubusercontent.com aus dem Branch).
- App Links für die echte Seite brauchen `https://taupke-pixel.github.io/.well-known/assetlinks.json` → eigenes Repository
  `taupke-pixel.github.io` 🔒 (optional; ohne geht es mit einem Tipp auf „In der App öffnen“).

---

## Livegang 🔒 (alles nur nach ausdrücklicher Freigabe von Fritz)
1. 🧑‍🌾 Termin ohne Fütterung, auf jedem Gerät mit Daten **„Backup erstellen“**.
2. 🧑‍🌾 Echtes Projekt: Authentication → „Jetzt starten“ → Anmeldemethode „Anonym“ aktivieren.
3. 🔒 Regeln ins echte Projekt: `firebase deploy --only firestore:rules --project futterrechner`
   (gleichzeitig mit Schritt 4, weil die alte Seite mit den neuen Regeln nicht mehr funktioniert).
4. 🔒 `umbau/04-android-app` nach `main` zusammenführen und pushen → GitHub Pages aktualisiert sich.
5. 🧑‍🌾 Fritz öffnet die Seite **im selben Browser wie bisher**, stellt eine Anfrage.
   🔒 `node werkzeuge/betreiber-einrichten.js --projekt futterrechner --echt-freigegeben --anfrage <ID>`
6. 🧑‍🌾 Einstellungen → Betrieb → „In den Betrieb übernehmen“ (alte Daten des Browsers). Prüfen: History-Summen, Lager.
7. 🧑‍🌾 App installieren (download.html) und per QR/PIN hinzufügen.
8. Die übrigen Nutzer: neu anfragen → Fritz gibt frei → im **bisherigen Browser** „In den Betrieb übernehmen“.
9. Optional 🔒: Repository `taupke-pixel.github.io` mit assetlinks.json (QR öffnet App ohne Zwischentipp);
   EmailJS-Vorlage um `{{betrieb}}`, `{{agb_fassung}}`, `{{datenschutz_fassung}}` ergänzen.
10. Alte Sammlungen `anfragen` (alte Einträge) und `zugriffe` bleiben liegen (nur Betreiber lesbar), später ggf. löschen 🔒.

## Offene Punkte
- Texte AGB/Datenschutz (Fritz), danach Fassungs-Kennungen anpassen.
- Fehler aus FEHLER.md einzeln freigeben.
- Kosten: kostenloser Tarif reicht für ca. 15 Betriebe deutlich (Lesen ~40 Dokumente pro App-Start).
