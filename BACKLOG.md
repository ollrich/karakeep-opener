# Backlog

Offene Punkte und Ideen, die laufende Arbeitsliste.

## Erledigt

- **1.0.0:** Abfrage beim Start, alle 2 Minuten und per Klick. Tag entfernen, dann öffnen. Nur von Hand gesetzte Tags, nur http und https. Bei AMO eingereicht, signiert, läuft.
- **1.1.0:** Abfrage nach der Rückkehr an den Rechner über die idle-API, Intervall 0 möglich, verständlichere Texte. Die Rückkehr-Erkennung griff wegen des Entladens des Hintergrundskripts praktisch nie.
- **1.2.0:** Durchsicht mit sechs Fehlerbehebungen: PDF- und Bildlinks gingen verloren, Links gingen ohne offenes Fenster verloren, die Rückkehr-Erkennung griff nicht, KI-Tags blockierten eigene Links, Server mit Port ließen sich nicht einrichten, nach Deaktivieren fehlte der Wecker, beim Start wurde doppelt abgefragt. Dazu: nur eine Anfrage, wenn nichts wartet; verzögertes Laden der Tabs; Abfrage beim Wechsel zu Firefox; gestaffelte Wiederholung; `+N` am Symbol; überarbeitete Einstellungsseite mit „Speichern und prüfen“. 33 Tests, Lint sauber. Von AMO signiert, die .xpi hängt am GitHub-Release v1.2.0.

## Offen

- **1.2.0 im echten Firefox testen:** Bisher nur gegen die Nachbildungen geprüft. Erster Lauf mit `npm run start`.
- **Ruhezustand prüfen:** Meldet Firefox nach dem Aufwachen zuverlässig erst „idle“, dann „active“? Kennt Firefox „locked“? Bis dahin die regelmäßige Abfrage (2 bis 5 Minuten) als Sicherheitsnetz eingeschaltet lassen.
- **Signieren automatisieren:** `web-ext sign --channel unlisted` mit AMO-API-Zugangsdaten als Secrets, etwa als Release-Workflow bei `v*`-Tags, der die signierte .xpi gleich ans Release hängt. Parameter vorher mit `npx web-ext sign --help` prüfen.

## Ideen

- Geöffnete Links in einer Tab-Gruppe „Karakeep“ sammeln. Vorher prüfen, ob die Tab-Gruppen-API von Firefox das hergibt.
- Tastenkürzel für die sofortige Abfrage.
- Vorschläge für den Tag-Namen auf der Einstellungsseite, geladen über `GET /tags`.
