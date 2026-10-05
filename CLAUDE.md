# CLAUDE.md – Futterrechner „Stall Ultra“

Anweisungen für Claude bei der Arbeit an diesem Repository.
Eigentümer: Fritz (Milchviehhalter, kein Programmierer). Sprache im Umgang mit ihm: **Deutsch, einfach, ohne Fachchinesisch**.

## Projekt in Kürze

- Eine einzige Datei `index.html` (HTML + CSS + JavaScript inline), ausgeliefert über GitHub Pages:
  https://taupke-pixel.github.io/Futterrechner/
- Bibliotheken per `<script>`-Tag: Firebase JS SDK **8.10.0** (Namespaced-API, `firebase.firestore()`), EmailJS (`emailjs-com@3`).
- Die Futterdaten (Rationen, History, Lager, Lieferungen, Einstellungen) liegen heute **nur im `localStorage`** des jeweiligen Browsers.
  Firestore wird bisher nur für die Zugangsfreigabe genutzt (Sammlungen `anfragen` und `zugriffe`).
- Echtes Firebase-Projekt: `futterrechner` (**nicht anfassen ohne Freigabe**, siehe unten).

## Feste Regeln (immer einhalten)

1. **Keine Neuentwicklung, kein Technikwechsel.** Bleibt: eine HTML-Datei, Firebase SDK 8.10.0, Firestore, EmailJS, GitHub Pages.
   Kein Framework, kein Build-Schritt, kein Umstieg auf Firebase SDK v9/v10. Erlaubt ist nur, weitere Module **derselben** SDK-Version
   einzubinden, wenn ein Ziel es zwingend braucht (z. B. `firebase-auth.js` 8.10.0 für anonyme Anmeldung, die Security Rules brauchen).
2. **Bestehende Funktionen und Berechnungen bleiben exakt gleich.** Rechenfunktionen (z. B. `buildCalc`, `buildRestBullen`,
   `saveHistory`, `saveRestBullenHistory`, `calcAverage`, `calcResttage`, `getBestellDatum`, `getWarnClass`, Feiertage) werden nicht
   umgeschrieben, nicht „aufgeräumt“, nicht „verbessert“. Auch offensichtliche Fehler darin werden **nur gemeldet**, nicht still behoben –
   Fritz entscheidet einzeln.
3. **Keine Rollen- oder Benutzerverwaltung.** Ein Gerät gehört zu genau einem Betrieb, alle Geräte eines Betriebs dürfen dasselbe.
   Einzige Ausnahme: Fritz als Betreiber darf Anfragen freigeben (fest hinterlegt, kein Rollensystem).
4. **Nie direkt auf `main` arbeiten.** Jeder Schritt auf eigenem Branch (z. B. `umbau/01-testsystem`). Zusammenführen in `main`
   nur nach ausdrücklicher Freigabe von Fritz.
5. **Nichts live hochladen** (kein `git push` nach `main`, kein Veröffentlichen auf GitHub Pages) **und nichts an der echten
   Firebase-Datenbank `futterrechner` ändern** (Daten, Regeln, Einstellungen) ohne ausdrückliche Freigabe von Fritz.
   Zum Testen: **eigenes Firebase-Testprojekt** und/oder den lokalen Firebase-Emulator.
6. **Schritte in der Firebase-Webseite** (console.firebase.google.com) erklärt Claude **einfach und Schritt für Schritt**:
   welcher Knopf, welches Menü, was eintragen, woran man sieht, dass es geklappt hat.
7. Kleine Schritte: jeder Schritt einzeln testbar, mit kurzer Testanleitung für Fritz („So prüfst du es“).
8. Vor jedem Schritt, der Daten anfasst: an das **Backup** erinnern (Knopf „Backup erstellen“ im Tab History).

## Ziele (in dieser Reihenfolge)

1. **Mehrere Betriebe** – jeder Betrieb mit eigenem, strikt getrenntem Datenbereich, abgesichert über Firestore Security Rules.
   Vorhandene Daten in die neue Struktur übernehmen.
2. **Zugangsanfrage** neuer Betriebsleiter per E-Mail (EmailJS), Freigabe durch Fritz. Bei der Anfrage AGB und
   Datenschutzerklärung per Pflicht-Häkchen bestätigen; speichern, **wer wann welche Fassung** bestätigt hat.
3. **Mehrere Geräte pro Betrieb** – Geräte per PIN und per QR-Code hinzufügen und wieder entfernen. QR-Code nur ca. 10 Minuten
   gültig. QR öffnet die Download-Seite, falls die App fehlt, sonst direkt die Einladung. Ein weitergeleiteter Download-Link allein
   gibt **keinen** Zugriff auf Daten.
4. **Später:** Android-App als Hülle um die Web-Version (lädt die Seite von GitHub Pages, Updates kommen automatisch), damit der
   Gerätezugang beim Löschen des Browserverlaufs erhalten bleibt.

Der Plan dazu steht in `UMBAUPLAN.md`.

## Technische Leitplanken

- Rechen- und Anzeigecode bleibt unverändert; geändert wird nur die **Speicherschicht** (`save()`, `saveGlobal()`,
  `saveHistoryStorage()`, `saveLagerStorage()`, `saveLieferungen()` und das Laden beim Start) sowie der Zugangsteil.
- Datenmodell im Betrieb: `betriebe/{betriebId}/...`. Zugriff nur für Geräte, die in `betriebe/{betriebId}/geraete/{uid}` stehen.
- Geräte-Identität = anonyme Firebase-Anmeldung (uid). Die alte `deviceID` aus `localStorage` ist **kein** Sicherheitsmerkmal.
- Reine Bedienzustände eines Geräts (`hiddenWarnings`, `historyCollapsed`, Taschenrechner-Verlauf `calcHist`) bleiben lokal.
- Firestore-Offline-Speicher aktivieren, damit der Rechner im Stall ohne Netz weiter läuft.
- Security Rules liegen als Datei `firestore.rules` im Repo und werden mit dem Emulator getestet, bevor sie irgendwo aktiv werden.

## Testen

- Vor dem Umbau einen **Vergleichstest** anlegen: Seite mit festen Beispieldaten laden, Ergebnisse (Rechner, Restmischung,
  History-Summen, Lager/Bestelldatum) speichern. Nach jedem Schritt muss das Ergebnis **identisch** sein.
- Rules-Tests mit Firebase-Emulator (`firebase emulators:exec`), nie gegen das echte Projekt.

## Bekannte Auffälligkeiten im Ist-Code (nur melden, nicht eigenmächtig ändern)

- `handleApproval()` ist zweimal definiert; die zweite Fassung gilt.
- Freigabe-Link `?approve=<id>` kann von jedem aufgerufen werden, der die Anfrage-ID kennt – auch vom Anfragenden selbst.
- Zugriffsprüfung (`checkAccess`) läuft nur im Browser; die Daten liegen ohnehin lokal.
- `saveRestBullenHistory()` zieht AGF/MLF vom Lager ab, ruft aber `saveLagerStorage()` nicht auf; es fehlt auch die
  „heute schon gespeichert“-Sperre, die `saveHistory()` hat.
- `data.restbullen` wird beim Start immer zurückgesetzt (nicht aus `localStorage` geladen).
- `importBackup()` ersetzt Daten ohne Rückfrage.
