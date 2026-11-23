# Photo frame and screensaver for vis-2

Two widgets for family photos on the wall tablet:

| Widget          | What for                                                                                |
| --------------- | --------------------------------------------------------------------------------------- |
| **Photo frame** | A slideshow as a tile in the grid, as a whole page or anywhere on a view                 |
| **Screensaver** | After some minutes without input, the photos with clock and weather lie over every view |

Both show the same slideshow and are set up with the same fields: source, display, caption, clock and weather.
Both also come as [web components](#as-web-components-devices-aura) for devices, Aura and other hosts.

## Requirements

- **An instance of the adapter** (`screensaver.0`). It keeps the albums, filters by date and reduces the pictures.
  Folders of the file storage, lists and states are shown by the widgets without a running instance too.
- **vis-2 2.20.1 or newer** (React 19). The widget set is built with React 19 and cannot be shown by an older vis-2.
- **vis-2 2.20.2 or newer** for the screensaver to lie over **every** view. It runs there as a background service of
  the widget set. An older vis-2 has no background services; the screensaver then only starts while the view with
  its widget is open.

## Where the pictures come from

### Folder in the ioBroker file storage

The simplest way: create a folder, e.g. `0_userdata.0/fotos`, and put the pictures into it — with the folder button
of the *Folder* field (where folders can be created and pictures uploaded as well) or with the file manager of Admin.

- `0_userdata.0/fotos` — a folder of the user files
- `_PRJ_NAME/fotos` — a folder in the vis-2 project
- **With subfolders** reads up to four levels deep. Hidden folders (`.thumbs`, `@eaDir` of a Synology) are left out.

New pictures appear **without a restart**: the widget subscribes to the folder and reads it again two seconds after
the last upload. As a safety net it reads it every 15 minutes and after every round of the slideshow as well.

With the **album state** a script switches the folder, e.g. to `0_userdata.0/fotos/christmas` in December. When the
state is empty, the folder of the settings applies again.

### Album of the adapter (server folders, Immich, by date)

The adapter has a backend of its own. In the **settings of the instance** (`screensaver.0`) you set up albums; in the
widget you choose "Album of the adapter" as *Source*, then the instance and the album:

| Source of the album      | Folder or album                                | Note                                                          |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------- |
| **ioBroker files**       | `0_userdata.0/photos`                          | The file storage reports new pictures at once                 |
| **Folder of the server** | `/mnt/nas/photos`                              | e.g. a mounted share of the NAS; `@eaDir` and hidden files are skipped |
| **Immich**               | name of the album, empty for the whole library | URL and API key in the *Immich* tab, or Immich in Docker (see below); the key is stored encrypted and never leaves ioBroker |
| **Google Photos**        | name of a source chosen in the app, empty for the selection of Google | connect once in the *Google Photos* tab, see below |

What the backend does:

- **Date filter** in the widget under *Which pictures*: all, **the last days** (1 = today, 7 = the last week),
  **a period** (`2024-07-01` to `2024-07-31`) or **this day years ago** (1 = today a year ago, 0 = this day in every
  year before, plus *Days around*). The selection changes by itself at midnight. If no picture matches, the frame shows
  the whole album (switch off with *All when none match*).
- The **date taken** comes from EXIF, otherwise from the file name as phones and messengers write it
  (`IMG_20241120_140312.jpg`, `IMG-20241120-WA0001.jpg`). A picture without a date is left out by every date filter.
- **Reduced copies:** every picture is brought to the size of the frame (steps from 960 to 3840 px, the limit in the
  settings) and stored as JPEG in the files of the instance (`screensaver.0/cache/…`). The tablet loads 200–400 KB
  instead of a 6 MB photo. Date and place stay in the copy. The cache has a fixed size (500 MB by default); the copies
  used longest ago are dropped first.
- A large album gives a widget at most 3000 pictures, a selection of the day.
- A folder is read completely only the first time; afterwards the backend opens only new or changed files. The index
  lies in the data folder of the instance.

The **album state** replaces the album of the settings here too, with the ID of an album as its value.

#### Immich in Docker

[Immich](https://immich.app) is a photo server of your own: the Immich app (Android, iOS) uploads new photos of the
phone by itself. Where Docker runs on the ioBroker host, ioBroker can start Immich itself, like the adapters
`frigate` and `sql` start Frigate or MySQL.

1. Settings of the instance, tab **Immich**: check **Run Immich in Docker on this host**.
2. Choose the **folder for the photos**, on a disk with enough space (like `/mnt/photos`). It holds the photos, their
   thumbnails and a nightly backup of the database (`backups/`).
3. Enter the **e-mail** and the **password** of the Immich account and save. On a new Immich ioBroker creates this
   account as administrator; log in with it in the app and in the browser.
4. Wait until the status says "Connected as …". On the first start Docker downloads about 2 GB.
5. In the Immich app enter the **server address** shown (like `http://192.168.1.10:2283`), log in and switch on the
   backup in the background.
6. In the *Albums* tab add an album with the source *Immich*.

Good to know:

- It needs about 2 GB of memory, with **faces and smart search** (machine learning, one more container) 1–2 GB
  more. The photo frame does not need it.
- ioBroker signs in only once, to create an API key of its own that may only read. The key is stored encrypted in the
  object `screensaver.0.immich`; the password is not needed after that.
- If Immich has an account already, ioBroker creates none: enter the e-mail and the password of that account.
  ioBroker shows the photos of this account and the albums shared with it.
- The database lives in a Docker volume on the host (`iob_screensaver_0_database`): Immich does not support it on a
  network share. For a backup the folder of the photos with its `backups/` is enough.
- The containers keep running when the instance stops, so the phones keep uploading (can be switched off). With
  *Update Immich automatically* Docker pulls newer versions of Immich 3 when the instance starts.
- Unchecking Docker stops the containers but deletes nothing: photos and database stay.
- Another folder for the photos moves nothing: move the content yourself first.
- Linux hosts only: the folder must be a full path (`/…`).
- Uploading while away: through a VPN like Tailscale or WireGuard; the status shows the address in the VPN too. In
  the Immich app *Settings → Networking → Automatic URL switching* changes between the local address and the one in
  the VPN depending on the Wi-Fi. Do not open the port to the internet: Immich speaks plain HTTP here.
- The **quick access** (Intro) of admin gets a card "Immich" that opens Immich in the browser — for Immich in Docker
  as for a server of its own. Without Immich it goes away again. When it comes or goes, the instance restarts once.

#### Google Photos

ioBroker becomes a device in Google Photos, like a digital photo frame. What it shows is chosen in the Google Photos
app: albums, people, pets.

1. Settings of the instance, tab **Google Photos**. *Name in Google Photos* takes a name of your own for the device
   (empty: "ioBroker &lt;host&gt;"). **Connect with Google Photos**: a code and a QR code appear. The text above
   says what ioBroker may see.
2. Open `google.com/device` on a phone or computer (or scan the QR code), enter the code, sign in with the Google
   account and agree.
3. Google Photos then opens at the device: choose there what is shown. Later this goes through **Choose what is
   shown** or the QR code next to the status. The tab shows the connected account with its name and profile
   picture.
4. In the *Albums* tab add an album with the source *Google Photos*: *Folder or album* empty for the selection of
   Google, or the name of a chosen source (like `Family`).

Good to know:

- Google leaves out screenshots, documents, receipts, blurry and very personal pictures by itself.
- Without a source Google gives a selection of its own, not by date. The date filters work anyway: the date is when
  the picture was taken.
- An album takes up to 500 pictures and is read again at most every 3 hours: Google allows a device 240 reads of
  the list a day. Videos are skipped. Google gives no place.
- ioBroker sees only the name and profile picture of the account and the photos chosen for the device in the app;
  it changes and deletes nothing in Google Photos.
- Reduced copies of Google pictures stay in the cache for at most 60 minutes, then they are fetched again (as Google
  requires).
- **Disconnect** removes the device in Google Photos, withdraws the consent (even if removing fails) and deletes the
  copies, the list of the pictures (ID, date taken, size) and the stored account. If ioBroker was removed in the app
  or the consent was withdrawn in the Google account, the tab says so and all of it is deleted too (after a removal
  in the app the consent is withdrawn as well): just connect again.
- The sign-in goes through the OAuth service of ioBroker (`oauth2.iobroker.in`), which keeps the client secret. The
  refresh token is stored encrypted in the instance. The pictures go directly from Google to the ioBroker host.
- What is stored where and for how long: [privacy policy for Google Photos](https://www.iobroker.com/policy/google-photos).

### List of URLs

One URL per line, optionally followed by `|` and a caption. Lines starting with `#` are skipped:

```text
# Holidays 2025
https://example.com/pictures/beach.jpg | On the beach of Split
0_userdata.0/fotos/grandma.jpg | Grandma's 80th birthday
_PRJ_NAME/fotos/garden.jpg
```

### State

For scripts and adapters that fetch pictures from a photo service (Immich, Synology Photos, Nextcloud, …). The state
holds a single URL, several URLs (one per line) or a JSON list:

```json
[
    { "url": "https://photos.example.com/api/assets/123/thumbnail?size=preview", "date": "2025-07-14T18:22:05Z", "place": "Split", "caption": "On the beach" },
    { "url": "0_userdata.0/fotos/grandma.jpg", "caption": "Grandma's 80th birthday" }
]
```

The field names are read generously: `url`/`src`/`image`/`path`, `caption`/`title`/`description`,
`date`/`taken`/`takenAt`/`timestamp` (ISO text, EXIF text, milliseconds or seconds), `place`/`location`/`city`. An
object with the list under `images`, `photos`, `items` or `list` works as well.

When the same content is written again, the slideshow does not notice. A changed list is taken over without starting
from the beginning: the picture on the screen stays.

> **No credentials in the widget.** The settings of a widget are stored in the project and can be read in the
> browser. A password or an API key of a photo service belongs into the instance of the adapter (Immich) or into a
> script that writes the list into the state.

## Display

| Field                         | Meaning                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Change after (seconds)        | How long a picture stays. The time starts when the transition is over.                            |
| Order                         | In order (by file name, `IMG_2` before `IMG_10`) or random. In random order every picture comes once per round; new pictures come next. |
| Transition                    | None, cross-fade or slide                                                                         |
| Transition duration           | In seconds                                                                                        |
| Slow zoom                     | Ken Burns effect: a slow zoom with a slight pan, four variants in turn                            |
| Fit                           | **Fill** cuts off the edge. **Show whole** shows the whole picture; instead of black bars, a blurred and darkened copy of the same picture fills the rest. |
| Two portraits side by side    | If the frame is landscape, two portrait pictures in a row are shown next to each other, each with its own caption |
| Position dots                 | Dots at the bottom center; from 13 pictures on a counter "5 / 120"                                |
| Without card (photo frame)    | No corners, frame and shadow — for a whole page as a picture frame                                |

A portrait picture that fills a landscape frame keeps its upper part: that is where the faces are.

### Card

The photo frame looks like the standard tiles of vis-2: background and divider from the theme, 12 px corners and, in
the light theme, a slight shadow. Whatever is set in the CSS settings of the widget for background, border, radius,
shadow and padding applies to the card and wins over the theme.

In the grid the photo frame starts with a whole column of the section and five rows (about 16:10), and its size
follows the rows and columns it is given.

## Caption

| Field                   | Meaning                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Caption                 | Bottom left, bottom right or off. If the clock is in the same corner, it moves to the other one. |
| Date                    | When it was taken: from the list or from the EXIF data                                     |
| Place                   | From the list or from the place names in the file (XMP/IPTC, as Lightroom, digiKam or Photos write them) |
| Caption of the picture  | From the list or from the description in the file (XMP/IPTC)                              |
| Own text                | For every picture without a caption of its own, e.g. "Family Smith"                        |

**Place from GPS:** phone photos usually carry only coordinates. With *Also look up GPS at OpenStreetMap* they become a
place name. The coordinates are then sent to `nominatim.openstreetmap.org`, which is why it is not the default. The
answers are cached in the browser, and at most one request per second goes out.

## Clock and weather

The clock (the time large, the date below) is meant for a whole page and the screensaver; for the screensaver it is
on by default. Its size follows the frame.

The **weather card** below the clock appears as soon as the temperature, the weather text or the weather icon is
known. Wind, humidity and precipitation join when the frame is wide enough. The units come from the objects of the
states.

The simplest is to choose a **weather source**: the list shows the current weather of all weather adapters (like
`open-meteo-weather.0 · Boat` or `openweathermap.0`). The six values are found there by their roles; below the field
it says which ones there are. A state in the fields below replaces only its own value — e.g. the temperature measured
outside instead of the one of the weather service. Without a weather source all values come from these fields.

The **weather icon** may be a WMO weather code (as open-meteo and DWD deliver it), a text ("Snowfall", "light rain",
"Schneefall" — recognized in the languages of ioBroker) or the URL of a picture. Without an icon state the symbol is
chosen from the weather text.

## Operation (photo frame)

- **Swipe** left or right: next or previous picture
- **Tap** the left or right quarter: previous or next picture
- **Tap the middle**: pause and continue; a short symbol shows what happened

If a **pause state** is set, it pauses the slideshow (`true`), and a tap in the middle writes it — so several tablets
pause together. The states **Next picture** and **Previous picture** change the picture on every write, whatever the
value (except `false` and `0`); a button that always writes `true` is enough.

## Screensaver

Put the widget on any view of the project. In the editor it shows a preview tile; in the runtime it takes no place.
**Show screensaver now** tries it out in the editor.

| Field                     | Meaning                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Start after (minutes)     | Minutes without input. `0` = never                                                       |
| Applies to                | **Whole project** or **Only this view**. The screensaver of a view wins.                 |
| Afterwards show view      | Opened while the screensaver runs; empty = back to the last view                         |
| Mouse movement ends it    | On a PC moving the mouse is enough, not only a click                                     |
| On/off state              | `false` switches it off, e.g. at night; if it is running, it goes                        |
| Dim state                 | `true` dims to the brightness set; a number is the brightness in percent                 |

**A touch ends it without switching anything.** The screensaver takes the touch itself and stays until the finger is
up; the click the tablet sends afterwards is thrown away. The lamp under the finger stays off. A key ends it as well,
without doing anything else.

**A view without screensaver**, e.g. the camera at the front door: put a second screensaver there with *Only this
view* and *Start after* `0`.

The screensaver goes on where it stopped the last time, and loads the first picture a few seconds before it starts,
so that it does not begin with a black screen.

### Off at night, on in the morning

```js
// Script in the JavaScript adapter: a state for the screensaver
createState('0_userdata.0.screensaver.enabled', true, { type: 'boolean', role: 'switch' });
schedule('0 23 * * *', () => setState('0_userdata.0.screensaver.enabled', false));
schedule('0 6 * * *', () => setState('0_userdata.0.screensaver.enabled', true));
```

Instead of switching it off, it can be dimmed: enter the state at *Dim state* and write `true` at night — or a number
from 0 to 100, e.g. from a light sensor.

## As web components (devices, Aura)

The photo frame and the screensaver also come as web components — for every host that shows web components:
**devices** (as a tile), **Aura** and others. They are added there like any other tile and set up with the same
fields as in vis-2.

| Component        | Tag                              | In devices   |
| ---------------- | -------------------------------- | ------------ |
| Photo frame      | `<iob-screensaver-photo-frame>`  | tile 2×1     |
| Screensaver      | `<iob-screensaver>`              | tile 1×1     |

vis-2 does not list them in its palette: it has the widgets of the same names.

What differs from the vis-2 widgets:

- **No card:** the host draws the frame, the corners and the background.
- **No project folders:** `_PRJ_NAME/…` exists in vis-2 only; a folder like `0_userdata.0/fotos` works everywhere.
  Whether the page comes from web (`/0_userdata.0/…`) or from admin (`/files/0_userdata.0/…`), the component finds
  out itself.
- **Screensaver:** the tile shows when it starts; a tap on the tile starts it at once. After the waiting time it lies
  over the **whole page**, not only over the tile, and a touch ends it without switching anything under it — as in
  vis-2. There are no views here, so no *Applies to* and no *Afterwards show view*. While the page is being edited,
  it does not start.
- A **folder** as source needs a host whose connection can read folders (vis-2 and devices can). Otherwise the tile
  says "This page cannot read folders" — take a list of URLs or a state then.

The components take React from the host (`/lib/esm/react-19.js`, served by web and admin) and bring neither MUI nor
a connection of their own.

## Performance

The slideshow is meant to run smoothly on an old tablet too:

- In memory are only the picture on the screen, during a transition the one before, and the next one, which is
  loaded ahead.
- Large photos (12 MP and more) are reduced to the size of the frame after loading (at most 2880 px on the long
  side); the original is released at once.
- Transitions and zoom use only `opacity` and `transform`, and so run on the graphics chip.
- Only the head of a file is read for EXIF/XMP.

## Troubleshooting

| Shown                                   | Cause                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| "Choose where the pictures come from"   | No folder, no URL or no state set                                                          |
| "Folder not found"                      | The folder does not exist in the file storage; check the spelling (`0_userdata.0/fotos`)   |
| "No pictures found"                     | The folder holds no pictures (JPEG, PNG, WebP, GIF, AVIF, BMP, SVG). The browser cannot show HEIC of iPhones. |
| "The pictures cannot be loaded"         | None of the pictures loads; it is tried again every 30 seconds. Check the console of the browser. |
| No date, no place                       | The picture comes from another server without CORS: it is shown, but the browser may not read its EXIF data. Give date and place in the list then. |
| The screensaver never starts            | The on/off state is `false`, *Start after* is `0`, or the view has a screensaver of its own with `0`. Before vis-2 2.20.2 only on the view with the widget. |
| "Album not found"                       | The ID is not in the settings of the instance, or the album is not active |
| "… does not answer: is the instance running?" | The instance `screensaver.0` is stopped or runs on a host that cannot be reached |
| "The album cannot be read"              | The folder does not exist, Immich cannot be reached or refuses the key: check the log of the instance; *Test connection* in the Immich tab. Immich in Docker and Google Photos: the status in their tab |
| Immich in Docker stays at "Immich is starting" | Check the Docker log of the containers `iob_screensaver_0_*` (adapter `docker-manager` or `docker logs`); can the folder of the photos be written? |
| "This page cannot read folders"         | A web component on a host that passes only the basic methods of the connection: take a list of URLs or a state |
