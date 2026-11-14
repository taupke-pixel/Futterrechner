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
| 15 (Teil) | Fragen (einmal, Fenster von unten): „Heute etwas anders?“ bei Ausreißer; „Normale Bullenration heute – Kühe leergefressen?“; nach 2 Tagen „Keine Reste eingetragen – leergefressen oder vergessen?“. Frühwarnung bei Fressmengen-Einbruch (mit „erledigt“). Reiter färbt sich bei offener Frage/Meldung |
| 4/5 | Berater-PDF (GS agri) einlesen: zwei Leseverfahren, Gegenprobe Summen/Kennziffern, „Mischung …“-Zeile gegen Grundration geprüft, komplette Ration für Stall 2 (Rest + Zugabe), Vorschau mit änderbaren Namen/Art, Komponenten mit TS/Nährstoffen/Preis; Test mit Fritz’ echtem PDF (privat, nicht im Repo) |
| 6 | Hinweise zur Ration (nur Auffälligkeiten: TS, RNB, Ca, P, Na, Energie/nXP für die MLP-Leistung); eigene Variante + Vergleich (Milch aus Energie, Futter je Kuh/je kg Milch, Milchgeld − Futter); „Diese nehmen“ nur normale App |
| 7 | Rationswechsel über __ Tage auf Basis TM (Tag x von y, Dauer ändern, pausieren, abschließen, abbrechen); normale App schreibt die Tagesration einmal je Tag, Testversion zeigt nur an |
| 13 (Ergänzung) | Auswertung in kg TM, Milch aus Energie mit Fett/Eiweiß aus der MLP (Herdenmanager), drei Zahlen (Milch möglich/MLP, Milchgeld − Futter, Reste Vormonat €), Milchpreis-Frage bei neuer MLP |
| 15 (Ergänzung) | MLP-Check nur bei Auffälligkeit (frische Kühe Eiweiß < 3,1 % / FEQ > 1,5 als „x von y“, Harnstoff, Energie knapp) und „Ration neu rechnen“ nach Wartezeit (Fressmenge weicht vom Ansatz ab / Energie ausgeschöpft); Grenzen in „Erweitert“ |
| 0 | Beispieldaten (30 Tage) ein-/ausblenden, „Testdaten zurücksetzen“ |

## Noch offen
- Standard-Fressmengen-Tabelle und Lernen für Gruppen ohne Reste (Punkte 9, 14), Zielgewicht Restmischung automatisch.
- Regen-/Hitze-Korrektur (Phase B, braucht 15+15 Tage).
- „Übernehmen“ der Empfehlung ist in der Testversion gesperrt (Spiegel) – geht erst in der normalen App.

## Für Fritz zu tun
1. Tablet: Testversion neu laden → Reiter „Fressmenge“ → „⚙ Einrichtung“ → Kopplungscode eintragen → „Verbinden“.
2. Futtergruppen anlegen und Ställe zuordnen; Rest als „nicht füttern“ abhaken.
3. Regel-Ergänzung `test/`: **nicht nötig** – Fritz testet nur auf dem Tablet (Entscheidung 14.11.2026). Bleibt unveröffentlicht.
4. ~~Berater-PDF schicken~~ erledigt (14.11.) – in der Testversion „📄 Neue Ration hochladen“ ausprobieren.
