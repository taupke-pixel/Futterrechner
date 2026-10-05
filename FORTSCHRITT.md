# Fortschritt Futterrechner-Umbau

Kurz und einfach: Was ist fertig, was kommt als Nächstes, was du testen kannst.
**Die echte Seite und die echte Datenbank sind bisher unverändert.** Alles läuft im Testprojekt.

## Wo was liegt
- Code auf GitHub, Branches `umbau/00-…`, `umbau/01-…`, `umbau/02-…` usw. (jeder baut auf dem vorigen auf). `main` ist unverändert.
- **Test-Webseite fürs Handy:** https://futterrechner-test-stall.web.app
  (benutzt nur die Test-Datenbank „Futterrechner TEST“, hat mit deinen echten Daten nichts zu tun)

## ✅ Fertig

### Einrichtung
- Git-Repository aus dem Bundle, mit GitHub verbunden.
- Firebase-Kommandozeile installiert. Echte Datenbank nur **gelesen**: 17 Anfragen (13 erlaubt, 4 offen),
  16 freigegebene Geräte. Die echten Regeln lassen jeden alles lesen/schreiben → siehe FEHLER.md F11.
- Testprojekt `futterrechner-test-stall` angelegt (Datenbank in Europa, Test-Webseite).

### Phase 0 – Vergleichstest
- Ein Test bedient die App automatisch mit festen Beispieldaten (3 Fälle, u. a. Feiertage in Bayern) und vergleicht
  **jede angezeigte Zahl** mit der Original-Fassung. Läuft nach jedem Schritt: bisher immer **identisch**.

### Phase 1 – Mehrere Betriebe, Daten in der Cloud
- Futterdaten liegen jetzt im Betrieb in der Cloud (vorher nur im Browser). Jeder Betrieb ist streng getrennt.
- Ohne Netz geht alles weiter, gespeichert wird, sobald wieder Netz da ist (oben im Kopf steht ☁️ / ⏳ / 📴).
- Zwei Geräte gleichzeitig: Lagerbestand wird „abgezogen/hinzugefügt“, nichts geht verloren (getestet).
- Alte Daten eines Geräts: Knopf „In den Betrieb übernehmen“ (Einstellungen → ganz unten) oder wie gewohnt „Backup laden“.
- Wird ein Gerät entfernt, verliert es sofort den Zugriff, und die Betriebsdaten werden vom Gerät gelöscht.

### Phase 2 – Zugangsanfrage, Freigabe nur durch dich
- Formular: Vorname, Nachname, Betrieb, E-Mail + **zwei Pflicht-Häkchen** (AGB, Datenschutz). Gespeichert wird,
  welches Gerät wann (Serverzeit) welche Fassung bestätigt hat.
- Du bekommst wie bisher die E-Mail mit Freigabe-/Ablehnen-Link. **Nur deine Geräte** können freigeben.
  Die alte Lücke (Anfragender schaltet sich über den Link selbst frei) ist **zu** – auch direkt über die Datenbank.
- Beim Freigeben: neuer Betrieb **oder** „zu bestehendem Betrieb hinzufügen“ (z. B. wenn jemand sein einziges Handy verloren hat).
- Platzhalterseiten `agb.html` und `datenschutz.html` – die Texte lieferst du.

## 📱 Was du auf dem Handy testen kannst (Test-Webseite)

**Vorher nötig (einmalig):**
1. Anonyme Anmeldung im Testprojekt einschalten (Anleitung: siehe unten „Was ich von dir brauche“ Nr. 1).
2. Dann auf dem Handy https://futterrechner-test-stall.web.app öffnen → Formular ausfüllen → beide Häkchen → „Anfrage senden“.
3. Mir Bescheid sagen. Ich trage dich dann **im Testprojekt** als Betreiber ein (das ist die allererste Freigabe,
   für die es noch keinen Betreiber gibt). Die App startet danach auf dem Handy von selbst.

**Dann testen:**
- [ ] Rechner: Tierzahl ändern, Speichern – alles wie gewohnt?
- [ ] Oben im Kopf steht „☁️ gespeichert“. Flugmodus an → etwas speichern → „📴 offline“ → Flugmodus aus → „☁️ gespeichert“.
- [ ] Seite schließen und wieder öffnen: alles noch da.
- [ ] Am PC dieselbe Test-Webseite öffnen, dort eine **zweite Anfrage** schicken (anderer Betriebsname). Du bekommst eine
      E-Mail → Freigabe-Link **auf dem Handy** öffnen → „Freigeben“. Der PC startet von selbst.
- [ ] Den Freigabe-Link aus der E-Mail **am PC** (also nicht auf deinem Handy) öffnen → muss „Keine Berechtigung“ zeigen.
- [ ] Optional: Backup deiner echten Daten (Knopf „Backup erstellen“ auf der echten Seite) in der Test-Webseite über
      „Backup laden“ einspielen → stimmen History-Summen und Lagerbestand?

## ⏭️ Als Nächstes
- **Phase 3:** Geräte per PIN und QR-Code hinzufügen/entfernen (läuft gerade).
- **Phase 4:** Android-App (APK).
- Danach: **Livegang** – nur mit deiner ausdrücklichen Freigabe (echte Regeln, `main`, dich als Betreiber eintragen).

## 🧑‍🌾 Was ich von dir brauche
1. **Anonyme Anmeldung im Testprojekt einschalten** (eilt nicht, nur für Handy-Tests):
   https://console.firebase.google.com/project/futterrechner-test-stall/authentication → „Jetzt starten“ →
   Reiter „Anmeldemethode“ → „Anonym“ → „Aktivieren“ → „Speichern“. Geklappt, wenn dort „Aktiviert“ steht.
2. **Optional, EmailJS:** Damit in der Freigabe-E-Mail auch Betrieb und bestätigte Fassungen stehen, in der EmailJS-Vorlage
   `template_e598pub` die Platzhalter `{{betrieb}}`, `{{agb_fassung}}`, `{{datenschutz_fassung}}` einfügen. Ohne das geht
   alles trotzdem – die Angaben stehen dann nur auf der Freigabe-Seite.
3. Texte für AGB und Datenschutzerklärung (wann es passt).
4. Fehler in FEHLER.md einzeln freigeben (oder „bleibt so“).
