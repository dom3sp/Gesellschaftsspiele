# Kartentisch

Kartenspiele online zusammen spielen – wie am echten Tisch.
Die Website kennt **keine Spielregeln**: Es gibt nur Karten, Stapel, Hände und (optional) einen freien Tisch.
Die Spieler legen selbst, ziehen selbst und drücken selbst auf „Gewonnen“.

- 2–4 Spieler (pro Deck einstellbar), jeder auf seinem eigenen Gerät
- Raum erstellen → 4-stelligen Code oder Link teilen → Mitspieler geben Code und dann ihren Namen ein
- Namen sind frei wählbar und lassen sich im Spiel ändern (Menü → „Meinen Namen ändern“)
- Jede Karte existiert genau einmal. Fremde Handkarten sind geheim.
- Kein Server, kein Konto, keine Kosten (Verbindung direkt zwischen den Browsern über WebRTC/PeerJS)

## Lokal starten

```bash
py -m http.server 8080
```

Dann <http://localhost:8080> öffnen. (Direkt per Doppelklick auf `index.html` geht es nicht – der Browser braucht einen kleinen Server.)

## Bedienung

| Was | Wie |
|---|---|
| Karte ziehen | Auf den verdeckten Stapel tippen – oder Karte auf die Hand ziehen |
| Karte legen | Karte auf einen Stapel / den Tisch ziehen – oder antippen und Ziel wählen |
| Karte weitergeben | Auf einen Mitspieler ziehen |
| Tischkarte umdrehen | Doppelklick, oder antippen → „Aufdecken“ |
| Mischen, Austeilen, Ablage neu mischen | **⋯** neben dem Stapel |
| Neue Runde | Menü → „Neue Runde“ (sammelt alles ein und mischt) |
| Hand sortieren / umsortieren | „Sortieren“ oder Karte in der Hand verschieben |
| Sieg eintragen | „🏆 Gewonnen“ |
| Fehler rückgängig machen | „↶ Zurück“ oben (oder Strg+Z) – nimmt die letzte Aktion zurück, mehrfach möglich (bis zu 30 Schritte) |

Lädt ein Mitspieler die Seite neu, kommt er automatisch auf seinen alten Platz zurück.
Schließt der Host (Raum-Ersteller) die Seite, kann er den Raum auf der Startseite **fortsetzen**.

## Würfelpasch (Würfelspiel)

Neben den Kartenspielen gibt es ein Würfelspiel mit Spielblock, das die Punkte automatisch ausrechnet
(`decks/wuerfelpasch/`, Logik in `js/dice.js`, Oberfläche in `js/dice-ui.js`). Beim Erstellen wählt man die Variante:

- **Classic** – 5 Würfel, 13 Felder, Bonus +35 ab 63 oben
- **7** – 6 Würfel (einer davon 0–9), 3 Tokens pro Spiel für zusätzliche Würfe, 22 Felder, Bonus +45 ab 73 oben

Würfel antippen = behalten. Nach dem Würfeln zeigt der Block in der eigenen Spalte, was jedes Feld bringen würde –
antippen trägt ein. „↶ Zurück“ nimmt Einträge (und „Neues Spiel“) zurück. Leertaste = würfeln.
Ist ein Spieler offline, kann der Host für ihn weiterspielen.

## Neues Spiel (Deck) hinzufügen

1. Ordner anlegen: `decks/<name>/` (z. B. `decks/phase10/`)
2. Kartenbilder hineinlegen (SVG, PNG oder JPG; alle im gleichen Seitenverhältnis) plus ein Bild für die Rückseite.
3. `decks/<name>/deck.json` anlegen:

```json
{
  "name": "Mein Spiel",
  "description": "Ein Satz, worum es geht.",
  "minPlayers": 2,
  "maxPlayers": 4,
  "aspect": 0.667,
  "back": "back.png",
  "table": true,
  "piles": [
    { "id": "ziehen", "name": "Nachziehstapel", "faceUp": false },
    { "id": "ablage", "name": "Ablagestapel", "faceUp": true }
  ],
  "startPile": "ziehen",
  "deal": 7,
  "shouts": ["Fertig!", { "text": "Stopp", "color": "#ff6b6b" }],
  "rules": ["Regel 1 …", "Regel 2 …"],
  "cards": [
    { "name": "Rot 1", "image": "karten/rot-1.png", "count": 2 },
    { "name": "Joker", "image": "karten/joker.png", "count": 4 }
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `aspect` | Breite ÷ Höhe der Kartenbilder (z. B. 0.667 für 2:3) |
| `table` | `true` = freie Tischfläche zum Auslegen (z. B. Rommé), `false` = nur Stapel (z. B. Uno) |
| `piles` | Die Stapel in der Mitte. `faceUp: true` = offen (man sieht die oberste Karte) |
| `startPile` | Hier liegen am Anfang/bei „Neue Runde“ alle Karten gemischt |
| `deal` | Vorschlag beim Austeilen |
| `shouts` | Ruf-Knöpfe, die bei allen groß eingeblendet werden |
| `count` | Wie oft es diese Karte im Deck gibt |
| `cover` | (optional) Bild für die Spielauswahl, sonst die Rückseite |

4. Den Ordnernamen in `decks/index.json` eintragen: `["uno", "phase10"]`
5. Website neu veröffentlichen – fertig.

Das Uno-Deck wird von `tools/make_uno.py` erzeugt (`py tools/make_uno.py`).
