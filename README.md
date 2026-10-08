<div align="center">

<img src="extension/icon.svg" width="112" alt="Karakeep Opener">

# Karakeep Opener

**Link auf einem Rechner in Karakeep taggen, auf dem anderen geht er in Firefox als Tab auf. Ohne Firefox-Konto, ohne zusätzlichen Dienst.**

🇩🇪 [Deutsch](#deutsch) · 🇬🇧 [English](#english)

</div>

---

## Deutsch

Karakeep Opener ist eine Firefox-Erweiterung für alle, die eine eigene [Karakeep](https://karakeep.app)-Instanz betreiben und Links zwischen zwei Rechnern hin und her schicken wollen. Typischer Fall: Auf dem Firmenrechner läuft nur Chrome, eigene Programme sind tabu, Erweiterungen aber erlaubt. Privat läuft Firefox.

1. **Rechner A (beliebiger Browser):** Link mit der offiziellen Karakeep-Erweiterung speichern und den Tag `an-firefox` setzen.
2. **Rechner B (Firefox):** Karakeep Opener fragt Karakeep ab, öffnet jedes Lesezeichen mit diesem Tag als Tab und entfernt danach den Tag. Das Lesezeichen selbst bleibt in Karakeep, nebenbei entsteht also ein Archiv.

### Funktionen

- **Viele Auslöser:** Abfrage beim Start von Firefox, regelmäßig (Standard alle 2 Minuten, abschaltbar), beim Wechsel zu Firefox, beim Öffnen eines Fensters, nach der Rückkehr an den Rechner und per Klick aufs Symbol.
- **Sparsam:** Wartet nichts, kostet eine Abfrage genau eine Anfrage an Karakeep.
- **Sicher öffnen:** Erst wird der Tag entfernt, dann der Tab geöffnet. Scheitert das Öffnen, wird der Tag wieder gesetzt und es später erneut versucht. Es gehen nur http- und https-Adressen auf.
- **PDF- und Bildlinks:** Karakeep wandelt sie in Datei-Lesezeichen um; die Erweiterung öffnet trotzdem die ursprüngliche Adresse.
- **Nur deine Tags:** Von der Karakeep-KI gesetzte Tags werden ignoriert und nie angefasst.
- **Keine Tab-Flut:** höchstens 20 Tabs pro Abfrage (einstellbar), der Rest wartet als `+N` am Symbol.
- **Verzögertes Laden:** Hintergrund-Tabs erscheinen sofort mit Titel, laden aber erst beim Anklicken.
- **Optional archivieren:** Lesezeichen nach dem Öffnen in Karakeep archivieren.
- **Robust:** Netzwerkfehler, Zeitüberschreitungen und Serverfehler werden gestaffelt wiederholt (nach 0,5, 1, 2, 5 und 10 Minuten). Gibt es gerade kein Firefox-Fenster, wartet der Link aufs nächste.
- **Status am Symbol:** `?` Einrichtung unvollständig, `…` Wiederholung geplant, `!` dauerhafter Fehler, `+N` weitere Links warten. Der Tooltip nennt Uhrzeit, Auslöser und Meldung.

### Installation

Die Erweiterung ist auf addons.mozilla.org **nicht gelistet**, sondern nur für den Eigengebrauch signiert. Es gibt drei Wege:

- **Zum Ausprobieren:** Repo klonen, in Firefox `about:debugging` → *Dieser Firefox* → *Temporäres Add-on laden* → `extension/manifest.json` wählen. Hält bis zum Neustart von Firefox.
- **Mit Node:** `npm install` und `npm run start` starten ein frisches Firefox mit geladener Erweiterung.
- **Dauerhaft:** Mit eigenem Konto bei addons.mozilla.org als „Auf eigene Faust“ signieren lassen. Dafür vorher die Erweiterungs-ID in `extension/manifest.json` ändern, die vorhandene ist fest an das Konto des Autors gebunden.

Voraussetzung ist Firefox 142 oder neuer.

### Einrichtung

In Karakeep unter *Einstellungen → API-Schlüssel* einen eigenen Schlüssel nur für diesen Firefox anlegen. Rechte: **Bookmarks Lesen und Schreiben**, alles andere aus.

Dann in Firefox unter *Add-ons → Karakeep Opener → Einstellungen*:

- **Karakeep-Adresse:** etwa `https://karakeep.example.de`. Ports und Unterpfade gehen, ein angehängtes `/api/v1` wird entfernt.
- **API-Schlüssel**
- **Tag:** Standard `an-firefox`
- Intervall, Obergrenze pro Abfrage und die Schalter für verzögertes Laden, Tab-Wechsel und Archivieren nach Bedarf.

**Speichern und prüfen** fragt Firefox nach der Berechtigung für genau diesen Server und macht gleich eine erste Abfrage.

### Datenschutz

Keine Telemetrie, kein Analytics, keine Datensammlung (`data_collection_permissions: none`). Die Erweiterung spricht ausschließlich mit deiner Karakeep-Instanz, ohne Cookies und ohne Cache. Zugriff auf den Server gibt es erst nach deiner Zustimmung. Adresse und API-Schlüssel liegen im Erweiterungsspeicher deines Firefox-Profils (`storage.local`), nicht verschlüsselt. Deshalb lohnt sich der eingeschränkte Schlüssel. Ohne https geht der Schlüssel im Klartext übers Netz, die Einstellungsseite warnt davor.

### Bekannte Grenzen

- Läuft die Erweiterung in zwei Firefox-Installationen gleichzeitig, kann ein Link in beiden aufgehen. Das Entfernen des Tags ist keine atomare Reservierung.
- Wer in deinem Karakeep taggen darf, kann Seiten in deinem Firefox öffnen lassen. Darum gehen nur http und https auf.

### Roadmap

Ideen, ohne festen Termin:

- Geöffnete Links in einer Tab-Gruppe „Karakeep“ sammeln.
- Tastenkürzel für die sofortige Abfrage.
- Vorschläge für den Tag-Namen auf der Einstellungsseite.

### Technik

Manifest V3 · reines JavaScript ohne Build-Schritt und ohne Bundler · Karakeep REST-API v1. Tests mit `node:test` gegen ein nachgebildetes Firefox und eine nachgebildete Karakeep-API, die Einstellungsseite mit jsdom.

### Entwicklung

Node 20 oder neuer.

```sh
npm install
npm test        # alle Tests
npm run lint    # web-ext lint, 0 Fehler, 0 Warnungen, 0 Hinweise
npm run build   # dist/karakeep_opener-<version>.zip
npm run start   # Firefox mit der Erweiterung als temporärem Add-on
```

Ein GitHub-Actions-Workflow führt Tests und Lint bei jedem Push und Pull Request aus.

---

## English

Karakeep Opener is a Firefox extension for anyone running their own [Karakeep](https://karakeep.app) instance who wants to send links between two computers. Typical case: the work machine only runs Chrome, installing software is off limits but extensions are allowed. At home it's Firefox.

1. **Computer A (any browser):** save the link with the official Karakeep extension and add the tag `an-firefox`.
2. **Computer B (Firefox):** Karakeep Opener polls Karakeep, opens every bookmark with that tag as a tab and then removes the tag. The bookmark itself stays in Karakeep, so you get an archive for free.

### Features

- **Many triggers:** polls when Firefox starts, periodically (every 2 minutes by default, can be turned off), when you switch to Firefox, when a window opens, when you return to the computer and when you click the toolbar icon.
- **Frugal:** if nothing is waiting, a poll costs exactly one request to Karakeep.
- **Safe opening:** the tag is removed first, then the tab is opened. If opening fails, the tag is restored and the extension retries later. Only http and https URLs are opened.
- **PDF and image links:** Karakeep turns them into asset bookmarks; the extension still opens the original URL.
- **Only your tags:** tags set by Karakeep's AI are ignored and never touched.
- **No tab flood:** at most 20 tabs per poll (configurable), the rest waits as `+N` on the icon.
- **Lazy loading:** background tabs appear immediately with their title but only load when you click them.
- **Optional archiving:** archive bookmarks in Karakeep after opening.
- **Resilient:** network errors, timeouts and server errors are retried with backoff (after 0.5, 1, 2, 5 and 10 minutes). If no Firefox window is open, the link waits for the next one.
- **Status on the icon:** `?` setup incomplete, `…` retry scheduled, `!` permanent error, `+N` more links waiting. The tooltip shows time, trigger and message.

The user interface is in German.

### Installation

The extension is **not listed** on addons.mozilla.org, it is only signed for personal use. Three ways to run it:

- **To try it out:** clone the repo, open `about:debugging` in Firefox → *This Firefox* → *Load Temporary Add-on* → pick `extension/manifest.json`. Lasts until Firefox restarts.
- **With Node:** `npm install` and `npm run start` launch a fresh Firefox with the extension loaded.
- **Permanently:** have it signed as “On your own” with your own addons.mozilla.org account. Change the extension ID in `extension/manifest.json` first, the existing one is bound to the author's account.

Requires Firefox 142 or newer.

### Setup

In Karakeep, under *Settings → API Keys*, create a dedicated key just for this Firefox. Permissions: **Bookmarks read and write**, everything else off.

Then in Firefox under *Add-ons → Karakeep Opener → Options*:

- **Karakeep address:** e.g. `https://karakeep.example.com`. Ports and subpaths work, a trailing `/api/v1` is stripped.
- **API key**
- **Tag:** `an-firefox` by default
- Interval, per-poll limit and the switches for lazy loading, switching to the new tab and archiving as you like.

**Save and check** asks Firefox for permission to access exactly this server and runs a first poll right away.

### Privacy

No telemetry, no analytics, no data collection (`data_collection_permissions: none`). The extension talks only to your Karakeep instance, without cookies and without cache. It gets access to the server only after you grant it. Address and API key are stored in the extension storage of your Firefox profile (`storage.local`), unencrypted, which is why a restricted key is worth it. Without https the key travels in plain text; the options page warns about that.

### Known limitations

- If the extension runs in two Firefox installations at once, a link may open in both. Removing the tag is not an atomic reservation.
- Anyone who can tag bookmarks in your Karakeep can make your Firefox open pages. That's why only http and https are opened.

### Roadmap

Ideas, no fixed timeline:

- Collect opened links in a “Karakeep” tab group.
- Keyboard shortcut for an immediate poll.
- Tag name suggestions on the options page.

### Tech

Manifest V3 · plain JavaScript, no build step, no bundler · Karakeep REST API v1. Tests with `node:test` against a mocked Firefox and a mocked Karakeep API, the options page with jsdom.

### Development

Node 20 or newer. See the commands in the German section above. A GitHub Actions workflow runs tests and lint on every push and pull request.

---

## Lizenz / License

MIT, siehe / see [LICENSE](LICENSE).
