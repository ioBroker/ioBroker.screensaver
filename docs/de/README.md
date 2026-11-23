# Bilderrahmen und Bildschirmschoner für vis-2

Zwei Widgets für Familienfotos auf dem Wandtablet:

| Widget               | Wofür                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| **Bilderrahmen**     | Diashow als Kachel im Raster, als ganze Seite oder frei auf einer Ansicht                    |
| **Bildschirmschoner**| Nach einigen Minuten ohne Bedienung liegen die Fotos mit Uhr und Wetter über jeder Ansicht   |

Beide zeigen dieselbe Diashow und werden mit denselben Feldern eingerichtet: Quelle, Darstellung,
Bildunterschrift, Uhr und Wetter. Beide gibt es außerdem als [Web-Komponenten](#als-web-komponente-devices-aura)
für devices, Aura und andere Oberflächen.

## Voraussetzungen

- **Eine Instanz des Adapters** (`screensaver.0`). Sie verwaltet die Alben, filtert nach Datum und verkleinert die
  Bilder. Ordner im Dateispeicher, Listen und Datenpunkte zeigen die Widgets auch ohne laufende Instanz.
- **vis-2 ab 2.20.1** (React 19). Das Widget-Set ist mit React 19 gebaut und lässt sich von einem älteren vis-2
  nicht darstellen.
- **vis-2 ab 2.20.2**, damit der Bildschirmschoner über **jeder** Ansicht liegt. Er läuft dort als
  Hintergrunddienst des Widget-Sets. Ein älteres vis-2 kennt keine Hintergrunddienste; dann startet der
  Bildschirmschoner nur, solange die Ansicht offen ist, auf der sein Widget liegt.

## Woher die Bilder kommen

### Ordner im ioBroker-Dateispeicher

Der einfachste Weg: einen Ordner anlegen, z. B. `0_userdata.0/fotos`, und die Bilder hineinladen — über den
Ordner-Knopf im Feld *Ordner* (dort lassen sich auch Ordner anlegen und Bilder hochladen) oder über den
Dateimanager des Admins.

- `0_userdata.0/fotos` — ein Ordner der Benutzerdateien
- `_PRJ_NAME/fotos` — ein Ordner im vis-2-Projekt
- **Mit Unterordnern** liest bis zu vier Ebenen tief. Versteckte Ordner (`.thumbs`, `@eaDir` einer Synology)
  bleiben außen vor.

Neue Bilder erscheinen **ohne Neustart**: Das Widget abonniert den Ordner und liest ihn zwei Sekunden nach dem
letzten Hochladen neu. Als Netz darunter liest es ihn alle 15 Minuten und nach jeder Runde der Diashow erneut.

Mit dem **Datenpunkt Album** wechselt ein Skript den Ordner, z. B. im Dezember auf
`0_userdata.0/fotos/weihnachten`. Ist der Datenpunkt leer, gilt wieder der Ordner aus den Einstellungen.

### Album des Adapters (Ordner des Servers, Immich, nach Datum)

Der Adapter hat ein eigenes Backend. In den **Einstellungen der Instanz** (`screensaver.0`) legt man Alben an, im
Widget wählt man unter *Quelle* „Album des Adapters“, dann Instanz und Album:

| Quelle des Albums      | Ordner oder Album                                    | Hinweis                                                       |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| **ioBroker-Dateien**   | `0_userdata.0/fotos`                                 | Neue Bilder meldet der Dateispeicher sofort                   |
| **Ordner des Servers** | `/mnt/nas/fotos`                                     | Z. B. eine eingebundene Freigabe des NAS; `@eaDir` und versteckte Dateien bleiben außen vor |
| **Immich**             | Name des Albums, leer für die ganze Mediathek        | URL und API-Schlüssel im Reiter *Immich*, oder Immich in Docker (siehe unten); der Schlüssel wird verschlüsselt gespeichert und verlässt ioBroker nie |
| **Google Fotos**       | Name einer in der App gewählten Quelle, leer für die Auswahl von Google | Einmal verbinden im Reiter *Google Fotos*, siehe unten |

Was das Backend übernimmt:

- **Datumsfilter** im Widget unter *Welche Bilder*: alle, **die letzten Tage** (1 = heute, 7 = die letzte Woche),
  **ein Zeitraum** (`2024-07-01` bis `2024-07-31`) oder **dieser Tag vor Jahren** (1 = heute vor einem Jahr, 0 = dieser
  Tag in allen Jahren davor, dazu *Tage drumherum*). Um Mitternacht wechselt die Auswahl von selbst. Passt kein Bild,
  zeigt der Rahmen das ganze Album (abschaltbar mit *Alle, wenn keines passt*).
- Das **Aufnahmedatum** kommt aus EXIF, sonst aus dem Dateinamen, wie ihn Handys und Messenger schreiben
  (`IMG_20241120_140312.jpg`, `IMG-20241120-WA0001.jpg`). Ein Bild ohne Datum fällt bei jedem Datumsfilter heraus.
- **Verkleinerte Kopien:** Jedes Bild wird auf die Größe des Rahmens gebracht (Stufen 960 bis 3840 px, Obergrenze in
  den Einstellungen) und als JPEG in den Dateien der Instanz abgelegt (`screensaver.0/cache/…`). Das Tablet lädt
  dann 200–400 KB statt eines 6-MB-Fotos. Datum und Ort bleiben in der Kopie erhalten. Der Zwischenspeicher hat eine
  feste Größe (Standard 500 MB); die am längsten nicht gebrauchten Kopien werden zuerst gelöscht.
- Ein großes Album gibt einem Widget höchstens 3000 Bilder, als Auswahl des Tages.
- Gelesen wird ein Ordner nur beim ersten Mal ganz; danach öffnet das Backend nur neue oder geänderte Dateien. Der
  Index liegt im Datenordner der Instanz.

Der Datenpunkt **Album** ersetzt auch hier das Album der Einstellungen, mit der ID eines Albums als Wert.

#### Immich in Docker

[Immich](https://immich.app) ist ein eigener Fotoserver: Die Immich-App (Android, iOS) lädt neue Fotos des Handys
von selbst hoch. Läuft auf dem ioBroker-Host Docker, startet ioBroker Immich auf Wunsch selbst, wie Frigate oder
MySQL bei den Adaptern `frigate` und `sql`.

1. Einstellungen der Instanz, Reiter **Immich**: **Immich in Docker auf diesem Host betreiben** anhaken.
2. **Ordner für die Fotos** wählen, auf einem Datenträger mit genug Platz (z. B. `/mnt/fotos`). Dort liegen die
   Fotos, ihre Vorschaubilder und jede Nacht eine Sicherung der Datenbank (`backups/`).
3. **E-Mail** und **Passwort** des Immich-Kontos eintragen und speichern. Bei einem neuen Immich legt ioBroker dieses
   Konto als Administrator an; damit meldet man sich in der App und im Browser an.
4. Warten, bis der Status „Verbunden als …“ zeigt. Beim ersten Start lädt Docker etwa 2 GB herunter.
5. In der Immich-App die angezeigte **Server-Adresse** eintragen (z. B. `http://192.168.1.10:2283`), anmelden und
   die Sicherung im Hintergrund einschalten.
6. Im Reiter *Alben* ein Album mit der Quelle *Immich* anlegen.

Gut zu wissen:

- Gebraucht werden etwa 2 GB Arbeitsspeicher, mit **Gesichtern und intelligenter Suche** (Machine Learning, ein
  Container mehr) 1–2 GB mehr. Der Bilderrahmen braucht das nicht.
- ioBroker meldet sich nur einmal an, um einen eigenen API-Schlüssel anzulegen, der nur lesen darf. Der Schlüssel
  liegt verschlüsselt im Objekt `screensaver.0.immich`; das Passwort wird danach nicht mehr gebraucht.
- Gibt es in Immich schon ein Konto, legt ioBroker kein neues an: dann E-Mail und Passwort dieses Kontos eintragen.
  ioBroker zeigt die Fotos dieses Kontos und die mit ihm geteilten Alben.
- Die Datenbank liegt in einem Docker-Volume auf dem Host (`iob_screensaver_0_database`): Immich verträgt sie nicht
  auf einer Netzwerkfreigabe. Für eine Sicherung genügt der Fotoordner mit seinem `backups/`.
- Die Container laufen weiter, wenn die Instanz stoppt, damit die Handys weiter hochladen können (abschaltbar). Mit
  *Immich automatisch aktualisieren* lädt Docker beim Start der Instanz neuere Versionen von Immich 3.
- Ohne Haken bei Docker stoppt ioBroker die Container, löscht aber nichts: Fotos und Datenbank bleiben erhalten.
- Ein anderer Ordner für die Fotos verschiebt nichts: den Inhalt vorher selbst umziehen.
- Nur auf Linux-Hosts: Der Ordner muss ein vollständiger Pfad sein (`/…`).
- Von unterwegs hochladen: über ein VPN wie Tailscale oder WireGuard; die Adresse im VPN zeigt der Status mit an. In
  der Immich-App wechselt *Einstellungen → Netzwerk → Automatischer URL-Wechsel* je nach WLAN zwischen der lokalen
  Adresse und der im VPN. Den Port nicht ins Internet freigeben: Immich spricht hier nur HTTP.
- Im **Schnellzugriff** des Admins erscheint eine Kachel „Immich“, die Immich im Browser öffnet — bei Immich in Docker
  wie bei einem eigenen Immich-Server. Ohne Immich verschwindet sie wieder. Kommt sie dazu oder geht sie, startet die
  Instanz einmal neu.

#### Google Fotos

ioBroker wird in Google Fotos zu einem Gerät wie ein digitaler Bilderrahmen. Was es zeigt, wählt man in der
Google-Fotos-App: Alben, Personen, Haustiere.

1. Einstellungen der Instanz, Reiter **Google Fotos**. Unter *Name in Google Fotos* lässt sich ein eigener Name für
   das Gerät eintragen (leer: „ioBroker &lt;Host&gt;“). **Mit Google Fotos verbinden**: ein Code und ein QR-Code
   erscheinen. Der Text darüber sagt, was ioBroker sehen darf.
2. Auf dem Handy oder Computer `google.com/device` öffnen (oder den QR-Code scannen), den Code eingeben, mit dem
   Google-Konto anmelden und zustimmen.
3. Danach öffnet sich Google Fotos beim Gerät: dort auswählen, was gezeigt wird. Später geht das über **Auswählen, was
   gezeigt wird** oder den QR-Code neben dem Status. Der Reiter zeigt das verbundene Konto mit Name und Profilbild.
4. Im Reiter *Alben* ein Album mit der Quelle *Google Fotos* anlegen: *Ordner oder Album* leer für die Auswahl von
   Google, oder der Name einer gewählten Quelle (z. B. `Familie`).

Gut zu wissen:

- Google lässt Bildschirmfotos, Dokumente, Quittungen, unscharfe und sehr persönliche Bilder von selbst weg.
- Ohne Quelle liefert Google eine eigene Auswahl, nicht chronologisch. Die Datumsfilter wirken trotzdem: das Datum
  ist der Aufnahmezeitpunkt.
- Ein Album nimmt bis zu 500 Bilder und wird höchstens alle 3 Stunden neu gelesen: Google erlaubt einem Gerät
  240 Abrufe der Liste am Tag. Videos werden übersprungen. Einen Ort liefert Google nicht.
- ioBroker sieht nur Name und Profilbild des Kontos und die Fotos, die in der App für das Gerät gewählt sind; es
  ändert und löscht nichts in Google Fotos.
- Verkleinerte Kopien von Google-Bildern bleiben höchstens 60 Minuten im Cache, danach werden sie neu geholt (so
  verlangt es Google).
- **Trennen** entfernt das Gerät in Google Fotos, widerruft die Zustimmung (auch wenn das Entfernen scheitert) und
  löscht die Kopien, die Liste der Bilder (Kennung, Aufnahmedatum, Größe) und das gespeicherte Konto. Wurde ioBroker
  in der App entfernt oder die Zustimmung im Google-Konto widerrufen, zeigt der Reiter das an, und all das wird
  ebenfalls gelöscht (nach dem Entfernen in der App wird auch die Zustimmung widerrufen): einfach neu verbinden.
- Die Anmeldung läuft über den OAuth-Dienst von ioBroker (`oauth2.iobroker.in`), dort liegt das Client-Secret.
  Der Refresh-Token liegt verschlüsselt in der Instanz. Die Bilder gehen direkt von Google zum ioBroker-Host.
- Was wo und wie lange gespeichert wird: [Datenschutzerklärung für Google Fotos](https://www.iobroker.com/policy/google-photos?lang=de).

### Liste von URLs

Eine URL pro Zeile, optional mit `|` und einer Bildunterschrift dahinter. Zeilen mit `#` am Anfang werden
übersprungen:

```text
# Urlaub 2025
https://example.com/bilder/strand.jpg | Am Strand von Split
0_userdata.0/fotos/oma.jpg | Omas 80. Geburtstag
_PRJ_NAME/fotos/garten.jpg
```

### Datenpunkt

Für Skripte und Adapter, die Bilder aus einem Fotodienst holen (Immich, Synology Photos, Nextcloud, …). Der
Datenpunkt enthält eine einzelne URL, mehrere URLs (eine pro Zeile) oder eine JSON-Liste:

```json
[
    { "url": "https://photos.example.com/api/assets/123/thumbnail?size=preview", "date": "2025-07-14T18:22:05Z", "place": "Split", "caption": "Am Strand" },
    { "url": "0_userdata.0/fotos/oma.jpg", "caption": "Omas 80. Geburtstag" }
]
```

Die Feldnamen werden großzügig gelesen: `url`/`src`/`image`/`path`, `caption`/`title`/`description`,
`date`/`taken`/`takenAt`/`timestamp` (ISO-Text, EXIF-Text, Millisekunden oder Sekunden), `place`/`location`/`city`.
Ein Objekt mit der Liste unter `images`, `photos`, `items` oder `list` geht ebenfalls.

Wird derselbe Inhalt erneut geschrieben, merkt die Diashow davon nichts. Eine geänderte Liste übernimmt sie, ohne
von vorn zu beginnen: Das Bild auf dem Bildschirm bleibt stehen.

> **Keine Zugangsdaten ins Widget.** Die Einstellungen eines Widgets stehen im Projekt und sind im Browser
> lesbar. Ein Passwort oder ein API-Schlüssel eines Fotodienstes gehört in die Instanz des Adapters (Immich) oder in
> ein Skript, das die Liste in den Datenpunkt schreibt.

## Darstellung

| Feld                              | Bedeutung                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| Wechsel nach (Sekunden)           | Wie lange ein Bild steht. Die Zeit beginnt, wenn der Übergang vorbei ist.                      |
| Reihenfolge                       | Der Reihe nach (nach Dateinamen, `IMG_2` vor `IMG_10`) oder zufällig. Zufällig kommt jedes Bild einmal pro Runde dran; neue Bilder kommen als Nächstes. |
| Übergang                          | Keiner, Überblenden oder Schieben                                                              |
| Dauer des Übergangs               | In Sekunden                                                                                    |
| Leichter Zoom                     | Ken-Burns-Effekt: ein langsamer Zoom mit leichtem Schwenk, vier Varianten im Wechsel           |
| Anpassung                         | **Füllen** schneidet den Rand ab. **Ganz zeigen** zeigt das ganze Bild; statt schwarzer Balken füllt eine unscharfe, abgedunkelte Kopie desselben Bilds den Rest. |
| Zwei Hochformatbilder nebeneinander | Ist der Rahmen quer, stehen zwei aufeinanderfolgende Hochformatbilder nebeneinander, jedes mit eigener Bildunterschrift |
| Punkte für die Position           | Punkte unten in der Mitte; ab 13 Bildern ein Zähler „5 / 120“                                  |
| Ohne Karte (nur Bilderrahmen)     | Ohne Ecken, Rahmen und Schatten — für eine ganze Seite als Bilderrahmen                        |

Ein Hochformatbild, das in einen queren Rahmen gefüllt wird, behält seinen oberen Teil: Dort sind die Gesichter.

### Karte

Der Bilderrahmen sieht aus wie die Standard-Kacheln von vis-2: Hintergrund und Trennlinie aus dem Theme, 12 px
Ecken und im hellen Theme ein leichter Schatten. Was in den CSS-Einstellungen des Widgets für Hintergrund, Rahmen,
Eckenradius, Schatten und Innenabstand gesetzt ist, gilt für die Karte und überschreibt das Theme.

Im Raster nimmt der Bilderrahmen anfangs eine ganze Spalte des Abschnitts und fünf Zeilen ein (etwa 16:10), und
seine Größe folgt den Zeilen und Spalten, die man ihm gibt.

## Bildunterschrift

| Feld                        | Bedeutung                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Bildunterschrift            | Unten links, unten rechts oder aus. Steht die Uhr in derselben Ecke, wechselt sie in die andere. |
| Datum                       | Aufnahmedatum aus der Liste oder aus den EXIF-Daten                                          |
| Ort                         | Aus der Liste oder aus den Ortsangaben in der Datei (XMP/IPTC, wie Lightroom, digiKam oder Fotos sie schreiben) |
| Bildunterschrift des Bilds  | Aus der Liste oder aus der Beschreibung in der Datei (XMP/IPTC)                              |
| Eigener Text                | Für jedes Bild ohne eigene Bildunterschrift, z. B. „Familie Müller“                          |

**Ort aus GPS:** Handyfotos tragen meist nur Koordinaten. Mit *GPS zusätzlich bei OpenStreetMap nachschlagen* wird
daraus ein Ortsname. Die Koordinaten gehen dabei an `nominatim.openstreetmap.org`; deshalb ist das nicht
voreingestellt. Die Antworten werden im Browser zwischengespeichert, und es geht höchstens eine Anfrage pro
Sekunde hinaus.

## Uhr und Wetter

Die Uhr (Uhrzeit groß, darunter das Datum) ist für eine ganze Seite und den Bildschirmschoner gedacht; beim
Bildschirmschoner ist sie voreingestellt. Ihre Größe richtet sich nach dem Rahmen.

Die **Wetterkarte** unter der Uhr erscheint, sobald Temperatur, Wettertext oder Wettersymbol bekannt sind. Wind,
Luftfeuchte und Niederschlag kommen dazu, wenn der Rahmen breit genug ist. Die Einheiten stammen aus den Objekten der
Datenpunkte.

Am einfachsten wählt man eine **Wetterquelle**: Die Liste zeigt das aktuelle Wetter aller Wetteradapter
(z. B. `open-meteo-weather.0 · Boot` oder `openweathermap.0`). Die sechs Werte werden dort anhand ihrer Rollen gefunden;
unter dem Feld steht, welche es gibt. Ein Datenpunkt in den Feldern darunter ersetzt nur seinen eigenen Wert — etwa die
draußen gemessene Temperatur statt der des Wetterdienstes. Ohne Wetterquelle kommen alle Werte aus diesen Feldern.

Das **Wettersymbol** darf ein WMO-Wettercode sein (wie open-meteo und DWD ihn liefern), ein Text („Schneefall“,
„Leichter Regen“, „overcast clouds“ — in elf Sprachen erkannt) oder die URL eines Bilds. Ohne Datenpunkt für das
Symbol wird es aus dem Wettertext bestimmt.

## Bedienung (Bilderrahmen)

- **Wischen** nach links oder rechts: nächstes oder voriges Bild
- **Tippen** ins linke oder rechte Viertel: voriges oder nächstes Bild
- **Tippen in die Mitte**: Pause und weiter; ein kurzes Symbol zeigt, was passiert ist

Ist ein **Datenpunkt Pause** gesetzt, hält dieser die Diashow an (`true`), und Tippen in die Mitte schreibt ihn —
so pausieren mehrere Tablets gemeinsam. Die Datenpunkte **Nächstes Bild** und **Voriges Bild** wechseln das Bild bei
jedem Schreiben, gleich mit welchem Wert (außer `false` und `0`); ein Taster, der immer `true` schreibt, genügt.

## Bildschirmschoner

Das Widget auf eine beliebige Ansicht des Projekts legen. Im Editor zeigt es eine Vorschau-Kachel; in der Runtime
nimmt es keinen Platz ein. Mit **Bildschirmschoner jetzt zeigen** lässt er sich im Editor ausprobieren.

| Feld                         | Bedeutung                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Start nach (Minuten)         | Minuten ohne Bedienung. `0` = nie                                                              |
| Gilt für                     | **Ganzes Projekt** oder **Nur diese Ansicht**. Der Bildschirmschoner einer Ansicht hat Vorrang. |
| Danach Ansicht zeigen        | Wird geöffnet, während der Bildschirmschoner läuft; leer = zurück zur letzten Ansicht           |
| Mausbewegung beendet ihn     | Am PC genügt eine Mausbewegung, nicht erst ein Klick                                           |
| Datenpunkt an/aus            | `false` schaltet ihn ab, z. B. nachts; läuft er gerade, geht er                               |
| Datenpunkt abdunkeln         | `true` dunkelt auf die eingestellte Helligkeit ab; eine Zahl ist die Helligkeit in Prozent     |

**Eine Berührung beendet ihn, ohne etwas zu schalten.** Der Bildschirmschoner nimmt die Berührung selbst an und
bleibt liegen, bis der Finger oben ist; den Klick, den das Tablet danach noch schickt, verwirft er. Die Lampe unter
dem Finger bleibt also aus. Auch eine Taste beendet ihn, ohne weiterzuwirken.

**Eine Ansicht ohne Bildschirmschoner**, z. B. die Kamera an der Haustür: dort einen zweiten Bildschirmschoner mit
*Nur diese Ansicht* und *Start nach* `0` ablegen.

Der Bildschirmschoner macht dort weiter, wo er beim letzten Mal aufgehört hat, und lädt das erste Bild schon einige
Sekunden vor dem Start, damit er nicht mit einem schwarzen Bild beginnt.

### Nachts aus, morgens wieder an

```js
// Skript im JavaScript-Adapter: ein Datenpunkt für den Bildschirmschoner
createState('0_userdata.0.screensaver.enabled', true, { type: 'boolean', role: 'switch' });
schedule('0 23 * * *', () => setState('0_userdata.0.screensaver.enabled', false));
schedule('0 6 * * *', () => setState('0_userdata.0.screensaver.enabled', true));
```

Statt ihn abzuschalten, lässt er sich auch abdunkeln: den Datenpunkt bei *Datenpunkt abdunkeln* eintragen und
nachts `true` schreiben — oder eine Zahl von 0 bis 100, etwa aus einem Helligkeitssensor.

## Als Web-Komponente (devices, Aura)

Bilderrahmen und Bildschirmschoner gibt es auch als Web-Komponenten — für Oberflächen, die Web-Komponenten zeigen:
**devices** (als Kachel), **Aura** und andere. Sie werden dort wie jede andere Kachel hinzugefügt und mit
denselben Feldern eingerichtet wie in vis-2.

| Komponente                      | Tag                              | In devices         |
| ------------------------------- | -------------------------------- | ------------------ |
| Bilderrahmen                    | `<iob-screensaver-photo-frame>`  | Kachel 2×1         |
| Bildschirmschoner               | `<iob-screensaver>`              | Kachel 1×1         |

In vis-2 erscheinen sie nicht in der Palette: Dort gibt es die eigenen Widgets mit demselben Namen.

Unterschiede zu den vis-2-Widgets:

- **Keine Karte:** Den Rahmen, die Ecken und den Hintergrund zeichnet die Oberfläche.
- **Keine Projektordner:** `_PRJ_NAME/…` gibt es nur in vis-2; ein Ordner wie `0_userdata.0/fotos` geht überall.
  Ob die Seite von web (`/0_userdata.0/…`) oder von admin (`/files/0_userdata.0/…`) kommt, erkennt die Komponente
  selbst.
- **Bildschirmschoner:** Die Kachel zeigt, wann er startet; ein Tipp auf die Kachel startet ihn sofort. Nach der
  Wartezeit legt er sich über die **ganze Seite**, nicht nur über die Kachel, und eine Berührung beendet ihn, ohne
  etwas darunter zu schalten — wie in vis-2. Ansichten gibt es hier nicht, also auch kein *Gilt für* und keine
  *Ansicht danach*. Solange die Seite bearbeitet wird, startet er nicht.
- Ein **Ordner** als Quelle braucht eine Oberfläche, deren Verbindung Ordner lesen kann (vis-2 und devices können
  das). Sonst zeigt die Kachel „Diese Seite kann keine Ordner lesen“ — dann eine Liste von URLs oder einen
  Datenpunkt nehmen.

Die Komponenten nehmen React von der Oberfläche (`/lib/esm/react-19.js`, das web und admin ausliefern) und
bringen weder MUI noch eine eigene Verbindung mit.

## Leistung

Auch ein altes Tablet soll die Diashow ruckelfrei zeigen:

- Im Speicher sind nur das Bild auf dem Bildschirm, während des Übergangs das vorige, und das nächste, das schon
  im Voraus geladen wird.
- Große Fotos (12 MP und mehr) werden nach dem Laden auf die Größe des Rahmens verkleinert (höchstens 2880 px an
  der langen Seite); das Original wird sofort freigegeben.
- Übergänge und Zoom laufen nur über `opacity` und `transform` und damit auf der Grafikeinheit.
- Von einer Datei wird für EXIF/XMP nur der Anfang gelesen.

## Fehlersuche

| Anzeige                               | Ursache                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| „Wählen, woher die Bilder kommen“     | Kein Ordner, keine URL bzw. kein Datenpunkt eingetragen                                       |
| „Ordner nicht gefunden“               | Den Ordner gibt es im Dateispeicher nicht; Schreibweise prüfen (`0_userdata.0/fotos`)         |
| „Keine Bilder gefunden“               | Der Ordner enthält keine Bilder (JPEG, PNG, WebP, GIF, AVIF, BMP, SVG). HEIC von iPhones zeigt der Browser nicht. |
| „Die Bilder lassen sich nicht laden“  | Keines der Bilder lädt; alle 30 Sekunden wird es erneut versucht. Konsole des Browsers prüfen. |
| Kein Datum, kein Ort                  | Das Bild kommt von einem anderen Server ohne CORS: Es wird gezeigt, aber seine EXIF-Daten sind für den Browser nicht lesbar. Datum und Ort dann in der Liste mitgeben. |
| Bildschirmschoner startet nie         | Datenpunkt an/aus steht auf `false`, *Start nach* ist `0`, oder die Ansicht hat einen eigenen Bildschirmschoner mit `0`. Vor vis-2 2.20.2 nur auf der Ansicht mit dem Widget. |
| „Album nicht gefunden“                | Die ID gibt es in den Einstellungen der Instanz nicht, oder das Album ist nicht aktiv          |
| „… antwortet nicht: Läuft die Instanz?“ | Die Instanz `screensaver.0` ist gestoppt oder läuft auf einem Host, der nicht erreichbar ist |
| „Das Album kann nicht gelesen werden“ | Ordner gibt es nicht, Immich nicht erreichbar oder Schlüssel abgelehnt: Protokoll der Instanz prüfen; *Verbindung testen* im Reiter Immich. Bei Immich in Docker und Google Fotos: Status im jeweiligen Reiter |
| Immich in Docker bleibt bei „Immich startet“ | Docker-Protokoll der Container `iob_screensaver_0_*` prüfen (Adapter `docker-manager` oder `docker logs`); ist der Fotoordner beschreibbar? |
| „Diese Seite kann keine Ordner lesen“ | Web-Komponente auf einer Oberfläche, die nur die Grundfunktionen der Verbindung weitergibt: Liste von URLs oder Datenpunkt nehmen |
