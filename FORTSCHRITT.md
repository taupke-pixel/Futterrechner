# Fortschritt Futterrechner-Umbau

Kurz und einfach: Was ist fertig, was kommt als Nächstes, was du testen kannst.
**Die echte Seite und die echte Datenbank sind bisher unverändert.** Alles läuft im Testprojekt.

## Wo was liegt
- Code auf GitHub, Branches `umbau/00-…` bis `umbau/04-android-app` (jeder baut auf dem vorigen auf). `main` ist unverändert.
- **Test-Webseite fürs Handy:** https://futterrechner-test-stall.web.app
  (benutzt nur die Test-Datenbank „Futterrechner TEST“, hat mit deinen echten Daten nichts zu tun)
- **Test-App:** https://futterrechner-test-stall.web.app/download.html → „App herunterladen“ (heißt auf dem Handy „Futterrechner TEST“)

## ✅ Fertig

### Einrichtung
- Git-Repository aus dem Bundle, mit GitHub verbunden. Firebase-Kommandozeile installiert.
- Echte Datenbank nur **gelesen**: 17 Anfragen (13 erlaubt, 4 offen), 16 freigegebene Geräte.
  Die echten Regeln lassen jeden alles lesen/schreiben → siehe FEHLER.md F11 (wird mit dem Livegang geschlossen).
- Testprojekt `futterrechner-test-stall` angelegt (Datenbank in Europa, Test-Webseite).

### Phase 0 – Vergleichstest
- Ein Test bedient die App automatisch mit festen Beispieldaten (3 Fälle, u. a. Feiertage in Bayern) und vergleicht
  **jede angezeigte Zahl** mit der Original-Fassung. Nach jedem Schritt: **identisch**.

### Phase 1 – Mehrere Betriebe, Daten in der Cloud
- Futterdaten liegen im Betrieb in der Cloud (vorher nur im Browser). Jeder Betrieb ist streng getrennt.
- Ohne Netz geht alles weiter, gespeichert wird, sobald wieder Netz da ist (oben im Kopf: ☁️ gespeichert / ⏳ speichert / 📴 offline).
- Zwei Geräte gleichzeitig: Lagerbestand und Einträge werden „hinzugefügt/abgezogen“, nichts geht verloren (getestet).
- Alte Daten eines Geräts: Knopf „In den Betrieb übernehmen“ (Einstellungen → Betrieb) oder wie gewohnt „Backup laden“.
- Wird ein Gerät entfernt, verliert es sofort den Zugriff, und die Betriebsdaten werden vom Gerät gelöscht.

### Phase 2 – Zugangsanfrage, Freigabe nur durch dich
- Formular mit **zwei Pflicht-Häkchen** (AGB, Datenschutz). Gespeichert wird, welches Gerät wann (Serverzeit)
  welche Fassung bestätigt hat.
- Du bekommst wie bisher die E-Mail mit Freigabe-/Ablehnen-Link. **Nur deine Geräte** können freigeben.
  Die alte Lücke (Anfragender schaltet sich selbst frei) ist **zu**.
- Beim Freigeben: neuer Betrieb **oder** „zu bestehendem Betrieb hinzufügen“ (falls jemand sein einziges Handy verloren hat).
- Platzhalterseiten `agb.html` und `datenschutz.html` – die Texte lieferst du.

### Phase 3 – Mehrere Geräte pro Betrieb
- Oben im Kopf „👥 Betrieb & Geräte“ → Liste aller Geräte (umbenennen ✎, entfernen).
- **„+ Gerät hinzufügen“** zeigt einen QR-Code **und** eine 8-stellige PIN. Gültig 10 Minuten, nur einmal nutzbar.
  Das neue Handy: QR-Code mit der Kamera scannen – oder „Ich habe eine PIN“ → eingeben → fertig (im Test: 2 Sekunden).
- QR-Code auf einem Android-Handy: Knopf „In der App öffnen“ – ist die App nicht da, kommt die Download-Seite.
- Download-Seite/-Link allein gibt keinen Zugriff.

### Verwaltungs-PIN (dein Wunsch)
- Der Betriebsleiter legt einmal eine **Verwaltungs-PIN** fest (6–12 Ziffern).
- Geräte **hinzufügen** und **entfernen** geht von jedem Gerät des Betriebs – aber nur mit dieser PIN.
  Die Datenbank prüft die PIN, nicht nur das Handy. Sich selbst abmelden geht ohne PIN.
- PIN vergessen? Mir Bescheid sagen – ich setze sie zurück, dann legt der Betrieb eine neue fest.

### Fehler behoben (06.10.2026, von dir freigegeben)
- **F1** Restmischung speichern zieht AGF/MLF jetzt dauerhaft vom Lager ab.
- **F2** Restmischung nur einmal pro Tag speicherbar (wie die anderen Gruppen).
- **F3** Restmischung-Eingaben (vorhanden, Zielgewicht, Bullen) bleiben nach dem Neuladen erhalten.
- **F4** „Backup laden“ fragt vorher nach („Alle Daten ersetzen?“).
- **F8** Taschenrechner rechnet ohne Programmier-Trick und zeigt z. B. 0,1 + 0,2 = 0,3.
- **F10** Liegt „Bestellen bis“ schon in der Vergangenheit, steht dort „⚠ Termin ist vorbei – sofort bestellen!“.
- **F9** (Durchschnitt) bleibt bewusst so – Erklärung in FEHLER.md.
- Alle anderen Rechenergebnisse sind unverändert (Vergleichstest).

### AGB und Datenschutzerklärung
- `agb.html` (Fassung „AGB-2026-10-06“) und `datenschutz.html` (Fassung „Datenschutz-2026-10-06“) sind fertig ausgefüllt,
  mit deiner Anschrift und E-Mail. **Vor dem Livegang einmal rechtlich prüfen lassen** (z. B. Bauernverband).

### Handy-Ansicht und Teilen (06.10.2026)
- Die Seite passt sich jetzt dem Handy-Bildschirm an (vorher war sie breiter und wirkte wie eine PC-Seite).
  Geprüft auf drei Handy-Größen (320, 390, 412 Pixel breit).
- Unter dem QR-Code steht jetzt der **Einladungs-Link** mit Knöpfen **Teilen**, **WhatsApp** und **Kopieren**.
- Unter „👥 Betrieb & Geräte“ → **„App weitergeben“**: Download-Link der App teilen (gibt allein keinen Zugriff).
- Android-App Version 1.1 (Teilen über das Android-Teilen-Menü).

### Phase 4 – Android-App
- Kleine App (49 KB), die die Webseite lädt → Updates kommen automatisch mit der Webseite.
- Eigener Speicher: Browserverlauf löschen schadet nicht mehr.
- **Kostenlos, ohne Play Store:** Den Link zur Download-Seite verschicken, darüber lädt man die App.
- „Backup erstellen/laden“ funktioniert in der App über die Android-Dateiauswahl.

### Kosten
- Alles bleibt im **kostenlosen** Firebase-Tarif: History und Lieferungen werden monatsweise gespeichert, damit ein
  App-Start nur wenige Dutzend Lesevorgänge braucht (frei sind 50.000 pro Tag).

## 📱 Was du auf dem Handy testen kannst

**Vorher nötig (einmalig):**
1. Anonyme Anmeldung im Testprojekt einschalten (siehe unten „Was ich von dir brauche“ Nr. 1).
2. Auf dem Handy https://futterrechner-test-stall.web.app öffnen → Formular ausfüllen → beide Häkchen → „Anfrage senden“.
3. Mir Bescheid sagen. Ich trage dich dann **im Testprojekt** als Betreiber ein. Die App startet danach von selbst.

**Webseite:**
- [ ] Rechner: Tierzahl ändern, Speichern – alles wie gewohnt?
- [ ] Oben „☁️ gespeichert“. Flugmodus an → etwas speichern → „📴 offline“ → Flugmodus aus → „☁️ gespeichert“.
- [ ] Seite schließen und wieder öffnen: alles noch da.
- [ ] Optional: Backup deiner echten Daten (Knopf „Backup erstellen“ auf der echten Seite) hier über „Backup laden“
      einspielen → stimmen History-Summen und Lagerbestand?

**Freigabe:**
- [ ] Am PC dieselbe Test-Webseite öffnen, eine **zweite Anfrage** schicken. E-Mail kommt → Freigabe-Link **auf dem Handy**
      öffnen → „Freigeben“. Der PC startet von selbst.
- [ ] Den Freigabe-Link **am PC** öffnen → muss „Keine Berechtigung“ zeigen.

**Geräte (PIN/QR):**
- [ ] Handy: „👥 Betrieb & Geräte“ → „+ Gerät hinzufügen“. PC (neues Browserfenster im Inkognito-Modus): Test-Webseite →
      „Ich habe eine PIN“ → PIN eingeben → PC ist im Betrieb. Dieselbe PIN nochmal → muss abgelehnt werden.
- [ ] Am Handy den PC in der Geräteliste „Entfernen“ → PC zeigt sofort „aus dem Betrieb entfernt“.

**App:**
- [ ] Auf dem Handy https://futterrechner-test-stall.web.app/download.html → „App herunterladen“ → installieren
      (Android fragt nach „Aus dieser Quelle zulassen“ → einschalten). App „Futterrechner TEST“ öffnen.
- [ ] In der App: Webseite auf einem **anderen** Gerät → „+ Gerät hinzufügen“ → QR-Code mit dem Handy scannen →
      „In der App öffnen“ → App ist im Betrieb.
- [ ] In der App „Backup erstellen“ → Speicherort wählen → Datei ist da.
- [ ] Im Handy-Browser den Verlauf löschen → App öffnen → immer noch freigeschaltet.

## ⏭️ Als Nächstes
- **Livegang** – nur mit deiner ausdrücklichen Freigabe. Ablauf steht in `UMBAUPLAN.md` (Abschnitt „Livegang“):
  Backup, anonyme Anmeldung im echten Projekt einschalten, Regeln + `main` gleichzeitig, dich als Betreiber eintragen,
  alte Daten übernehmen. Die übrigen 15 Geräte/Nutzer fragen danach neu an.

## 🧑‍🌾 Was ich von dir brauche
1. **Anonyme Anmeldung im Testprojekt einschalten** (nur für Handy-Tests):
   https://console.firebase.google.com/project/futterrechner-test-stall/authentication → „Jetzt starten“ →
   Reiter „Anmeldemethode“ → „Anonym“ → „Aktivieren“ → „Speichern“. Geklappt, wenn dort „Aktiviert“ steht.
2. **Signatur-Schlüssel der App sichern** (wichtig!): Die zwei Dateien `android\futterrechner.jks` und
   `android\keystore.properties` im Projektordner auf einen USB-Stick kopieren. Ohne sie kann die App nie wieder
   aktualisiert werden (die Webseite schon). Sie liegen absichtlich nicht auf GitHub.
3. **Optional, EmailJS:** In der Vorlage `template_e598pub` die Platzhalter `{{betrieb}}`, `{{agb_fassung}}`,
   `{{datenschutz_fassung}}` einfügen, damit sie in der Freigabe-E-Mail stehen.
4. Texte für AGB und Datenschutzerklärung (wann es passt).
5. Fehler in FEHLER.md einzeln freigeben (oder „bleibt so“).
6. Freigabe für den **Livegang**, wenn die Tests auf dem Handy gut aussehen.
