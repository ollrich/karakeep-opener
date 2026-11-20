# Backlog

Offene Punkte und Ideen, die laufende Arbeitsliste.

## Erledigt

- **1.0.0:** Abfrage beim Start, alle 2 Minuten und per Klick. Tag entfernen, dann öffnen. Nur von Hand gesetzte Tags, nur http und https. Bei AMO eingereicht, signiert, läuft.
- **1.1.0:** Abfrage nach der Rückkehr an den Rechner über die idle-API, Intervall 0 möglich, verständlichere Texte. Die Rückkehr-Erkennung griff wegen des Entladens des Hintergrundskripts praktisch nie.
- **1.2.0:** Durchsicht mit sechs Fehlerbehebungen: PDF- und Bildlinks gingen verloren, Links gingen ohne offenes Fenster verloren, die Rückkehr-Erkennung griff nicht, KI-Tags blockierten eigene Links, Server mit Port ließen sich nicht einrichten, nach Deaktivieren fehlte der Wecker, beim Start wurde doppelt abgefragt. Dazu: nur eine Anfrage, wenn nichts wartet; verzögertes Laden der Tabs; Abfrage beim Wechsel zu Firefox; gestaffelte Wiederholung; `+N` am Symbol; überarbeitete Einstellungsseite mit „Speichern und prüfen“. 33 Tests, Lint sauber. Von AMO signiert, die .xpi hängt am GitHub-Release v1.2.0.
- **1.3.0:** Durchsicht der Issues #1 bis #8. Einrichtung nennt die nötigen Rechte (Lesezeichen Lesen/Schreiben, Tags Lesen), fehlende Rechte werden beim Namen gemeldet. Übergabe-Notizen in `storage.local`: Kein Link geht mehr verloren, wenn Tag-Wiederherstellung scheitert oder Firefox mitten in der Übergabe endet; gescheitertes Archivieren wird nachgeholt. Klick oder „Speichern und prüfen“ während einer automatischen Abfrage führen zu einer erzwungenen Abfrage danach. Ehrliche Meldung statt „Keine wartenden Links“, wenn über 1000 KI-Tags vor dem eigenen Link liegen. Alte Host-Berechtigung nach Serverwechsel entfernt, Speichern gegen Fehler und Doppelklick abgesichert. #6 ohne Änderung geschlossen (Firefox wählt schon das oberste normale Fenster). 52 Tests, Lint sauber. Von AMO signiert, die .xpi hängt am GitHub-Release v1.3.0.

## Offen

- **1.3.0 im echten Firefox testen:** Bisher nur gegen die Nachbildungen geprüft.
- **Ruhezustand prüfen:** Meldet Firefox nach dem Aufwachen zuverlässig erst „idle“, dann „active“? Kennt Firefox „locked“? Bis dahin die regelmäßige Abfrage (2 bis 5 Minuten) als Sicherheitsnetz eingeschaltet lassen.
- **Signieren automatisieren:** `web-ext sign --channel unlisted` mit AMO-API-Zugangsdaten als Secrets, etwa als Release-Workflow bei `v*`-Tags, der die signierte .xpi gleich ans Release hängt. Parameter vorher mit `npx web-ext sign --help` prüfen.

## Ideen

- Geöffnete Links in einer Tab-Gruppe „Karakeep“ sammeln. Vorher prüfen, ob die Tab-Gruppen-API von Firefox das hergibt.
- Tastenkürzel für die sofortige Abfrage.
- Vorschläge für den Tag-Namen auf der Einstellungsseite, geladen über `GET /tags`.
