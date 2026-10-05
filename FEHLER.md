# Gefundene Fehler im Ist-Code

Diese Fehler werden **nicht** nebenbei behoben. Fritz gibt jeden einzeln frei.
Jeder freigegebene Fehler wird auf einem eigenen Branch `fix/<nummer>-…` behoben, mit Vergleichstest.

Status: ⏳ offen · ✅ freigegeben und behoben · ❌ bleibt so

| Nr. | Kurz | Status |
|---|---|---|
| F1 | Restmischung speichern: Lagerbestand wird nicht gesichert | ⏳ |
| F2 | Restmischung kann mehrmals am Tag gespeichert werden | ⏳ |
| F3 | Restmischung-Eingaben sind nach Neuladen weg | ⏳ |
| F4 | „Backup laden“ überschreibt alles ohne Rückfrage | ⏳ |
| F5 | `handleApproval()` steht doppelt im Code | ⏳ (erledigt sich mit Phase 2) |
| F6 | Freigabe-Link kann vom Anfragenden selbst benutzt werden | ✅ wird in Phase 2 geschlossen (vom Auftrag verlangt) |
| F7 | Zugriffsprüfung nur im Browser | ✅ wird in Phase 1 durch Security Rules ersetzt (vom Auftrag verlangt) |
| F8 | Taschenrechner rechnet mit `eval` | ⏳ |
| F9 | Durchschnitt zählt nur Tage mit Verbrauch | ⏳ (nur Hinweis) |
| F10 | Bestelldatum: Lieferzeit 0 und „heute“-Zeitpunkt | ⏳ (nur Hinweis) |
| F11 | **Echte Datenbank: jeder kann alle Anfragen (Namen, E-Mails) lesen und sich selbst freischalten** | ✅ wird mit dem Livegang (neue Regeln) geschlossen |

---

## F1 – Restmischung speichern: Lagerbestand wird nicht gesichert
**Wo:** `saveRestBullenHistory()`
**Was passiert:** Beim Speichern der Restmischung wird AGF/MLF vom Lagerbestand abgezogen, aber der Bestand wird nicht
gespeichert (`saveLagerStorage()` fehlt). Der Abzug geht beim nächsten Neuladen verloren – außer, man speichert in derselben
Sitzung noch etwas anderes, das das Lager sichert (dann wird er doch mitgesichert).
**Was sich nach dem Beheben ändert:** Der Lagerbestand sinkt nach dem Speichern der Restmischung dauerhaft. Resttage und
„Bestellen bis“ werden dadurch etwas früher angezeigt – so, wie es eigentlich gemeint ist.
**Achtung:** Bisher „verlorene“ Abzüge werden nicht nachträglich abgezogen.

## F2 – Restmischung kann mehrmals am Tag gespeichert werden
**Wo:** `saveRestBullenHistory()`
**Was passiert:** `saveHistory()` hat eine Sperre „Heute bereits gespeichert“. Bei der Restmischung fehlt sie in der Funktion
selbst. Der Knopf wird zwar grau, aber nur, wenn die Seite neu gezeichnet wird – ein schneller Doppel-Tipp kann zwei Einträge
erzeugen. Dann wird doppelt vom Lager abgezogen und die History-Summen sind zu hoch.
**Was sich nach dem Beheben ändert:** Pro Tag höchstens ein Restmischung-Eintrag, wie bei den anderen Gruppen.

## F3 – Restmischung-Eingaben sind nach Neuladen weg
**Wo:** Start der Seite (`data.restbullen` wird immer auf 0 gesetzt)
**Was passiert:** „Restmischung vorhanden“, „Zielgewicht“ und „Bullen (Anzahl)“ werden nach dem Neuladen auf 0 zurückgesetzt.
**Was sich nach dem Beheben ändert:** Die zuletzt eingegebenen Werte stehen nach dem Neuladen wieder da.
**Frage an dich:** Ist das Zurücksetzen vielleicht gewollt (jeden Tag neu eingeben)? Dann bleibt es so.

## F4 – „Backup laden“ überschreibt alles ohne Rückfrage
**Wo:** `importBackup()`
**Was passiert:** Nach Auswahl der Datei werden sofort alle Daten ersetzt. Ab Phase 1 gilt das für **alle Geräte des Betriebs**,
weil die Daten dann in der Cloud liegen.
**Was sich nach dem Beheben ändert:** Vorher kommt eine Frage „Alle Daten durch das Backup ersetzen? (Ja/Nein)“. Rechnen ändert sich nicht.

## F5 – `handleApproval()` steht doppelt im Code
**Was passiert:** Die Funktion ist zweimal da, die zweite gilt. Kein Unterschied für dich.
**Was sich ändert:** Nichts. Wird in Phase 2 ohnehin durch die neue Freigabe ersetzt.

## F6 – Freigabe-Link kann jeder benutzen
**Was passiert:** Wer die Anfrage-Nummer kennt, kann sich über `…/?approve=<Nummer>` selbst freischalten.
**Behebung:** Phase 2 (vom Auftrag verlangt) – freigeben kann nur noch dein Gerät, abgesichert durch die Security Rules.

## F7 – Zugriffsprüfung nur im Browser
**Behebung:** Phase 1 (vom Auftrag verlangt) – die Security Rules in Firestore prüfen jeden Zugriff.

## F11 – Echte Datenbank ist offen (am 05.10.2026 nur gelesen, nichts geändert)
**Wo:** Firestore-Regeln im echten Projekt `futterrechner` (Stand 28.03.2026):
`anfragen` und `zugriffe` erlauben jedem `create`, `read`, `update`.
**Was passiert:** Jeder, der die Seite kennt, kann (mit etwas Technikwissen) **alle 17 Anfragen mit Vor-/Nachname und E-Mail
lesen** und sich direkt in `zugriffe` selbst freischalten – sogar ohne den Freigabe-Link. Das ist auch ein Datenschutz-Thema (DSGVO).
**Behebung:** Mit dem Livegang werden die neuen Regeln (`firestore.rules`) veröffentlicht – dann ist beides gesperrt.
Bis dahin bleibt es offen, weil Änderungen an der echten Datenbank deine Freigabe brauchen.
**Wenn du nicht bis zum Livegang warten willst:** Ich kann eine Zwischen-Regel vorbereiten, die das Lesen fremder Anfragen
sperrt, die alte App aber weiter funktionieren lässt. Sag Bescheid.

## F8 – Taschenrechner rechnet mit `eval`
**Wo:** `press("=")`
**Was passiert:** Die Eingabe wird als JavaScript ausgeführt. Da man nur über die Knöpfe tippen kann, ist das im Alltag harmlos.
Es gibt aber Eigenheiten: z. B. `08+1` ergibt einen Fehler bzw. wird anders gelesen, `0.1+0.2` zeigt `0.30000000000000004`.
**Was sich nach dem Beheben ändern würde:** Eigene kleine Rechenlogik statt `eval`; Ergebnisse auf sinnvolle Stellen gerundet.
**Empfehlung:** niedrig – nur wenn es dich stört.

## F9 – Durchschnittsverbrauch zählt nur Tage mit Verbrauch (nur Hinweis)
**Wo:** `calcAverage()`
**Was passiert:** Es werden die letzten 14 **Tage mit Eintrag** gemittelt, nicht die letzten 14 Kalendertage. Tage ohne
Speichern zählen nicht als „0 kg“. Wurde an einem Tag z. B. nur die Restmischung gespeichert, zählt dieser Tag mit dem kleinen
Wert voll mit und drückt den Durchschnitt.
**Was sich ändern würde:** Je nach gewünschter Regel andere Resttage / Bestelldaten. Vermutlich ist das heutige Verhalten gewollt –
nur zur Info.

## F10 – Bestelldatum (nur Hinweis)
**Wo:** `getLeerDatum()` / `getBestellDatum()`
**Was passiert:** Das Leer-Datum wird ab „jetzt“ (mit Uhrzeit) gerechnet und die Resttage abgerundet. Fällt das Bestelldatum
in die Vergangenheit, wird trotzdem das vergangene Datum angezeigt (kein Hinweis „sofort bestellen“).
**Was sich ändern würde:** Optional Anzeige „sofort bestellen“, wenn das Datum vorbei ist. Rechnung bliebe gleich.
