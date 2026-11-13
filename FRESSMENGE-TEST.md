# Paket Fressmengen – Stand der Testversion

Test-Adresse: https://taupke-pixel.github.io/futterrechner-test/  (Zweig `fressmenge-test`)
Die normale App (https://taupke-pixel.github.io/Futterrechner/) ist **unverändert**.

## So arbeitet die Testversion
- **Spiegel:** zeigt live deine echten Futterrechner-Daten, kann daran aber **nichts ändern** (Sperre im Code, Test `tests/testversion.js`).
  Eingetragen wird weiter in der normalen App.
- Eigene Geräte-Anmeldung, eigener Gerätespeicher – stört die normale App nicht.
- Die neuen Einstellungen (Gruppen, Werte, gemerkte Tage) liegen vorerst **nur auf dem jeweiligen Gerät**.
  Für alle Geräte gemeinsam braucht es die Regel-Ergänzung für den Bereich `test/` (liegt fertig in `firestore.rules`,
  Tests grün, **noch nicht veröffentlicht** – wartet auf Fritz' OK).

## Fertig (in der Testversion)
| Punkt | Was |
|---|---|
| 16b | Timer: Knöpfe −1/−5/−10 Min |
| 1 | Hauptschalter „Fressmengen-Auswertung“ in den Einstellungen; bei AN eigener Reiter „Fressmenge“; Unterschalter |
| 2 | „Erweitert“: alle Grenzwerte mit Standard, Prüfung der Eingaben, „Standard wiederherstellen“ |
| 3 | Futtergruppen: Stallzahlen aus dem Herdenmanager (nur lesen, Kopplungscode), Ställe/Buchten zuordnen, „Nicht zugeordnet“, „nicht füttern“, Reiter orange bei offenem Stall |
| 9/10 (Teil) | Rechner: Tierzahl aus dem Herdenmanager an der Karte (antippen = übernehmen, Plakette „+2 seit letzter Mischung“), grüne Zeilen „▼ Stall abladen bis … kg“ |
| 11 (Teil) | Reste aus den bestehenden Feldern der Restmischung werden mit Tag gemerkt (solange die Testversion offen ist) |
| 12 (Teil) | Wetter von Open-Meteo (Höchsttemperatur, Luftfeuchte, Regen; 92 Tage + Vorhersage), Hitzetag nach THI |
| 13 | Restquote, gleitendes Mittel, Ampel/Empfehlung ±3 %, Leergefressen, Ausreißer, Regen/Hitze zählen in der Lernphase nicht, Hitze angesagt → nicht erhöhen |
| 16 | Reiter „Fressmenge“: je Kuhgruppe Zeile mit Haken/Empfehlung; antippen → Verlauf (Diagramm Reste/Temperatur/Regen, Gefressen je Tier, Liste, 7/30/90 Tage) |
| 15 (Teil) | Frage „Heute etwas anders?“ bei einem frischen Ausreißer (Später gefüttert / Problem / Alles normal) |
| 0 | Beispieldaten (30 Tage) ein-/ausblenden, „Testdaten zurücksetzen“ |

## Noch offen
- **Berater-PDF** (Punkte 4, 5, 6, 7): wartet auf das PDF von Fritz. Erst damit gibt es TS/Nährstoffe/Preise
  (Auswertung dann in kg TM statt kg FM, Milch aus Energie, Rationsvergleich, Rationswechsel).
- Standard-Fressmengen-Tabelle und Lernen für Gruppen ohne Reste (Punkte 9, 14), Zielgewicht Restmischung automatisch.
- Fragen/Meldungen (Punkt 15: Frühwarnung, MLP-Check, „Keine Reste eingetragen“) und Regen-/Hitze-Korrektur (Phase B, braucht 15+15 Tage).
- „Übernehmen“ der Empfehlung ist in der Testversion gesperrt (Spiegel) – geht erst in der normalen App.

## Für Fritz zu tun
1. Tablet: Testversion neu laden → Reiter „Fressmenge“ → „⚙ Einrichtung“ → Kopplungscode eintragen → „Verbinden“.
2. Futtergruppen anlegen und Ställe zuordnen; Rest als „nicht füttern“ abhaken.
3. Entscheiden: Regel-Ergänzung `test/` veröffentlichen? (dann gelten die Einstellungen auf allen Geräten)
4. Berater-PDF schicken.
