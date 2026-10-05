# Umbauplan Futterrechner „Stall Ultra“

Stand: 05.10.2026 · Grundlage: `index.html` auf `main` (Commit `d250375`) · Regeln: siehe `CLAUDE.md`

Jeder Schritt bekommt einen **eigenen Branch**, ist **einzeln testbar** und geht erst nach deiner Freigabe weiter.
Legende: 🧑‍🌾 = das machst du selbst (Anleitung kommt im jeweiligen Schritt) · 🔒 = braucht deine ausdrückliche Freigabe · 🧪 = Test

---

## Ausgangslage (Ist-Zustand)

| Was | Wo heute gespeichert |
|---|---|
| Rationen, Tierzahlen (`futter`) | localStorage des Browsers |
| Einstellungen, Namen, Bundesland (`gCfg`) | localStorage |
| Tageslog/History (`history`) | localStorage |
| Lager AGF/MLF + Warnstufen (`lager`) | localStorage |
| Lieferungen (`lieferungen`) | localStorage |
| Ausgeblendete Warnungen, aufgeklappte History, Taschenrechner | localStorage |
| Zugangsanfragen (`anfragen`), freigegebene Geräte (`zugriffe`) | Firestore (echtes Projekt) |

**Wichtig:** Die Betriebsdaten liegen also heute auf deinem Handy/PC im Browser, nicht in der Cloud. „Vorhandene Daten übernehmen“
heißt deshalb: die Daten **von deinem Gerät** (bzw. von den Geräten der schon freigegebenen Nutzer) einmalig in die Cloud hochladen.

**Sicherheitslücke heute:** Den Freigabe-Link `…/?approve=<Nummer>` kann jeder aufrufen, der die Nummer kennt – der Anfragende
selbst bekommt sie beim Absenden. Außerdem kann man ohne Anmeldung nicht sauber per Regeln trennen. Beides wird in Ziel 1/2 behoben.

---

## Phase 0 – Vorbereitung (an der App ändert sich nichts)

### 0.1 Vergleichstest für die Berechnungen 🧪
- Ein Testskript lädt die `index.html` mit festen Beispieldaten (Kühe, Färsen, Bullen, Restmischung, History, Lager, Lieferungen)
  und speichert alle angezeigten Ergebnisse (kg, Summen, Zeiten, Resttage, Bestelldatum).
- Nach **jedem** späteren Schritt läuft der Test erneut: Ergebnisse müssen **Zeichen für Zeichen gleich** sein.
- Liegt in `tests/`, berührt `index.html` nicht.

### 0.2 Firebase-Testprojekt anlegen 🧑‍🌾
- Du legst in der Firebase-Webseite ein zweites Projekt `futterrechner-test` an (kostenloser Spark-Tarif reicht),
  schaltest Firestore und „Anonyme Anmeldung“ ein und gibst mir die Konfig-Zeilen. Genaue Klick-Anleitung kommt mit dem Schritt.
- Zusätzlich nutze ich den **Firebase-Emulator** (läuft nur auf dem Rechner, keine Cloud) für Regel-Tests.

### 0.3 Umschalter Test/Live
- In `index.html` steht die echte Konfig unverändert. Dazu kommt die Test-Konfig, die **nur** genommen wird, wenn die Seite
  lokal (localhost) oder mit Emulator läuft. Auf GitHub Pages bleibt alles wie heute.
- 🧪 Live-Seite verhält sich unverändert; lokal schreibt die App nachweislich ins Testprojekt.

### 0.4 Ist-Zustand der echten Datenbank ansehen 🧑‍🌾 (nur lesen)
- Du schaust in der Firebase-Webseite unter Firestore → „Regeln“ nach und schickst mir den Text, dazu: wie viele Einträge in
  `anfragen` und `zugriffe` stehen. Damit wissen wir, wie viele Nutzer übernommen werden müssen.

---

## Phase 1 – Ziel 1: Mehrere Betriebe, strikt getrennt

### 1.1 Anonyme Geräte-Anmeldung
- Einbinden von `firebase-auth.js` **8.10.0** (gleiche Version, kein Technikwechsel). Jedes Gerät meldet sich beim Start
  unsichtbar anonym an und bekommt eine feste Geräte-Kennung (uid). Ohne diese Anmeldung können Security Rules nicht unterscheiden,
  wer fragt.
- Sonst ändert sich nichts. 🧪 Vergleichstest grün, uid erscheint (klein) in den Einstellungen.

### 1.2 Datenmodell + Security Rules (nur Dateien, App unverändert)
```
betriebe/{betriebId}                     Name, angelegt am
betriebe/{betriebId}/geraete/{uid}       Gerätename, hinzugefügt am
betriebe/{betriebId}/daten/futter        = heutiges „futter“
betriebe/{betriebId}/daten/einstellungen = heutiges „gCfg“
betriebe/{betriebId}/daten/lager         = heutiges „lager“
betriebe/{betriebId}/history/{id}        je Tageseintrag ein Dokument
betriebe/{betriebId}/lieferungen/{id}    je Lieferung ein Dokument
geraetezuordnung/{uid}                   → betriebId (damit ein Gerät seinen Betrieb findet)
```
- Regel im Kern: **Lesen/Schreiben unter `betriebe/X` nur, wenn das anfragende Gerät in `betriebe/X/geraete` steht.**
  Alles andere ist gesperrt.
- Neue Datei `firestore.rules` + automatische Tests im Emulator: Gerät aus Betrieb A kann Betrieb B weder lesen noch schreiben,
  fremdes Gerät kann gar nichts, entferntes Gerät verliert sofort den Zugriff.

### 1.3 Speicherschicht auf Firestore umstellen (Rechnen bleibt gleich)
- Nur die Speicher-/Ladefunktionen werden erweitert: `save()`, `saveGlobal()`, `saveHistoryStorage()`, `saveLagerStorage()`,
  `saveLieferungen()` schreiben zusätzlich in den Betrieb; beim Start wird aus dem Betrieb geladen.
- localStorage bleibt als Zwischenspeicher; Firestore-Offline-Modus an → im Stall ohne Netz geht alles weiter, gleicht später ab.
- Bleibt **nur lokal**: ausgeblendete Warnungen, aufgeklappte History, Taschenrechner.
- 🧪 Vergleichstest grün; zwei Browser im Testprojekt sehen dieselben Daten.

### 1.4 Gleichzeitiges Arbeiten mehrerer Geräte absichern
- Problem: Speichern zwei Geräte fast gleichzeitig, könnte eines den Lagerbestand des anderen überschreiben.
- Vorschlag: Lagerbestand-Änderungen als „Abziehen/Hinzufügen“ an die Datenbank schicken statt den ganzen Wert zu überschreiben.
  Die Rechnung (`bestand -= kg`) bleibt dieselbe. 🔒 Du entscheidest, ob wir das so machen.
- 🧪 Zwei Geräte speichern gleichzeitig → Bestand stimmt.

### 1.5 Vorhandene Daten übernehmen
- **Zuerst Backup** (Knopf „Backup erstellen“) auf jedem Gerät mit Daten.
- Beim ersten Start nach dem Umbau: Ist das Gerät schon (alt) freigegeben, aber noch keinem Betrieb zugeordnet, bietet die App
  einmalig an: „Betrieb anlegen und Daten dieses Geräts übernehmen“. Die lokalen Daten werden 1:1 hochgeladen.
- Alternativ: Backup-Datei laden → landet direkt im Betrieb (nutzt die vorhandene Backup-Funktion).
- 🧪 Erst im Testprojekt mit einer Kopie deines Backups; danach Vergleich: gleiche History-Summen, gleicher Lagerbestand.
- Alte Sammlungen `anfragen`/`zugriffe` bleiben vorerst unangetastet.

### 1.6 Livegang Ziel 1 🔒
- Mit dir zusammen: Rules in der echten Datenbank veröffentlichen (Anleitung Schritt für Schritt), Branch nach `main`,
  GitHub Pages aktualisiert sich. Vorher: Backup, und Termin wählen, an dem nicht gefüttert wird.

---

## Phase 2 – Ziel 2: Zugangsanfrage mit AGB/Datenschutz, Freigabe durch dich

### 2.1 AGB- und Datenschutz-Texte mit Fassung 🧑‍🌾
- Du lieferst die Texte (bitte rechtlich prüfen lassen – ich bin kein Anwalt). Jede Fassung bekommt eine Kennung, z. B. `AGB 2026-10`.
- Anzeige als eigene Seite (`agb.html`, `datenschutz.html`) oder als Fenster in `index.html` – 🔒 du entscheidest.

### 2.2 Neues Anfrageformular
- Felder: Vorname, Nachname, Betriebsname, E-Mail.
- **Zwei Pflicht-Häkchen**: „Ich akzeptiere die AGB (Fassung …)“ und „Ich habe die Datenschutzerklärung (Fassung …) gelesen“,
  jeweils mit Link zum Text. Ohne beide kein Absenden.
- Gespeichert in der Anfrage: Name, E-Mail, Geräte-uid, **AGB-Fassung, Datenschutz-Fassung, Zeitpunkt (Serverzeit)**.
- Rules: Anfrage darf nur angelegt, aber vom Anfragenden nicht mehr geändert oder gelöscht werden (Nachweis bleibt sauber).

### 2.3 Freigabe nur durch dich
- Deine Geräte-uid wird einmal von Hand in der Firebase-Webseite als „Betreiber“ eingetragen (🧑‍🌾, Anleitung folgt) –
  das ist kein Rollensystem, nur ein fester Eintrag.
- Der Link in der E-Mail öffnet eine Freigabe-Seite. **Nur auf deinem Gerät** kann „Freigeben“ gedrückt werden; dabei werden
  Betrieb + erstes Gerät angelegt. Ruft jemand anderes den Link auf, passiert nichts (Rules verhindern es).
- 🧪 Im Emulator: Anfragender versucht sich selbst freizugeben → abgelehnt.

### 2.4 E-Mail (EmailJS)
- Mail an dich wie bisher (Vorlage `template_e598pub`), ergänzt um Betriebsname und bestätigte Fassungen.
- Optional: Bestätigungsmail an den Anfragenden nach Freigabe (zweite Vorlage, 🧑‍🌾 in EmailJS anlegen).

---

## Phase 3 – Ziel 3: Mehrere Geräte pro Betrieb

### 3.1 Geräteliste
- In den Einstellungen: alle Geräte des Betriebs (Name, seit wann), Knopf „Entfernen“. Entferntes Gerät verliert sofort den Zugriff.
- 🧪 Gerät entfernen → dort erscheint beim nächsten Laden „kein Zugriff“.

### 3.2 Gerät per PIN hinzufügen
- Vorhandenes Gerät erzeugt eine **8-stellige PIN**, gültig ca. **10 Minuten**, nur **einmal** nutzbar.
- Neues Gerät: „Ich habe eine PIN“ → eingeben → ist im Betrieb.
- Die Gültigkeit prüfen die Security Rules mit der Serverzeit (nicht die Uhr am Handy).

### 3.3 Gerät per QR-Code hinzufügen
- Vorhandenes Gerät zeigt einen QR-Code mit einer langen Zufalls-Einladung, gültig ca. 10 Minuten, einmalig.
- QR-Code wird **im Gerät selbst** erzeugt (kleine QR-Bibliothek, 🔒 deine Zustimmung nötig) – nicht über einen fremden Dienst,
  damit die Einladung niemand Drittes sieht.
- QR-Link: `https://taupke-pixel.github.io/Futterrechner/?einladung=…`
  - App installiert (ab Phase 4): öffnet direkt die App mit der Einladung.
  - App fehlt: Seite zeigt „App herunterladen“ **und** „im Browser fortfahren“.

### 3.4 Download-Seite
- Eigene einfache Seite mit Download-Link der App. **Der Link allein gibt keinen Zugriff** – Daten gibt es nur mit gültiger PIN
  oder gültigem QR-Code bzw. nach Freigabe durch dich.
- 🧪 Abgelaufener QR (11 Minuten) → abgelehnt; bereits benutzter QR → abgelehnt; Download-Link ohne Einladung → nur Anfrageformular.

---

## Phase 4 – Ziel 4 (später): Android-App als Hülle

- Kleine Android-App, die die Seite von GitHub Pages lädt → Updates kommen automatisch, wenn du die Webseite aktualisierst.
- Empfehlung: **eigene WebView-App** statt „Trusted Web Activity“. Grund: eine TWA nutzt den Speicher von Chrome – löscht jemand
  in Chrome die Websitedaten, wäre der Gerätezugang wieder weg. Die WebView-App hat ihren eigenen Speicher.
- Damit QR-Codes direkt die App öffnen („App Links“), muss eine Datei unter `https://taupke-pixel.github.io/.well-known/…` liegen.
  Das geht nur mit einem zusätzlichen Repository `taupke-pixel.github.io`. Wird zu Beginn von Phase 4 im Detail geplant.
- Verteilung: Play Store (einmalig 25 $ Entwicklerkonto) oder APK-Datei direkt – entscheiden wir dann.

---

## Offene Fragen an dich

1. Wie viele Betriebe/Geräte nutzen den Rechner schon (siehe 0.4)?
2. Wie lauten die aktuellen Firestore-Regeln im echten Projekt (Testmodus mit Ablaufdatum?) – siehe 0.4.
3. Gibt es AGB- und Datenschutztexte schon?
4. Einverstanden mit `firebase-auth.js` 8.10.0 (nötig für die Regeln) und einer kleinen QR-Bibliothek?
5. 1.4: Lagerbestand als „Abziehen/Hinzufügen“ speichern – ja/nein?
6. Auffälligkeiten aus `CLAUDE.md` (z. B. Restmischung-Speichern sichert den Lagerbestand nicht): beheben oder so lassen?
