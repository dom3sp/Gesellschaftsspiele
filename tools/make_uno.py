"""Erzeugt das Uno-Deck (108 Karten) als eigene SVG-Grafiken + deck.json.

Aufruf:  py tools/make_uno.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "decks" / "uno"
CARDS = OUT / "cards"

COLORS = [
    ("rot", "Rot", "#E3242B"),
    ("gelb", "Gelb", "#F2B705"),
    ("gruen", "Grün", "#2EA043"),
    ("blau", "Blau", "#1F6FEB"),
]
DARK = "#16161a"
FONT = "font-family=\"'Arial Black','Segoe UI Black','Helvetica Neue',Arial,sans-serif\" font-weight=\"900\""


def svg(fill, inner, defs=""):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="200" height="300">
<defs><clipPath id="o"><ellipse cx="0" cy="0" rx="70" ry="118"/></clipPath>{defs}</defs>
<rect width="200" height="300" rx="18" fill="#fff"/>
<rect x="9" y="9" width="182" height="282" rx="13" fill="{fill}"/>
{inner}
</svg>
"""


def oval(fill="#fff"):
    return f'<ellipse cx="100" cy="150" rx="70" ry="118" transform="rotate(28 100 150)" fill="{fill}"/>'


def text(x, y, size, label, fill, stroke=DARK, sw=4, rot=None, italic=True):
    tr = f' transform="rotate({rot} {x} {y})"' if rot is not None else ""
    style = ' font-style="italic"' if italic else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="middle" fill="{fill}" stroke="{stroke}" '
            f'stroke-width="{sw}" stroke-linejoin="round" paint-order="stroke"{style} {FONT}{tr}>{label}</text>')


def corners(label, size=40):
    # Ecke oben links + gedreht unten rechts (Grundlinie ~0.36*size unter der Mitte)
    off = size * 0.36
    tl = text(32, 42 + off, size, label, "#fff", sw=3)
    br = f'<g transform="rotate(180 100 150)">{text(32, 42 + off, size, label, "#fff", sw=3)}</g>'
    return tl + br


def corner_icon(icon_fn):
    return icon_fn(34, 44, 0.3, "#fff") + f'<g transform="rotate(180 100 150)">{icon_fn(34, 44, 0.3, "#fff")}</g>'


def center_number(label, color):
    out = text(100, 190, 112, label, color, sw=6)
    if label in ("6", "9"):
        out += f'<rect x="76" y="200" width="44" height="9" rx="3" fill="{color}" stroke="{DARK}" stroke-width="3" paint-order="stroke"/>'
    return out


def skip_icon(cx, cy, k, color):
    r, w = 46 * k, 15 * k
    a = r * 0.707
    line = f'x1="{cx - a:.1f}" y1="{cy + a:.1f}" x2="{cx + a:.1f}" y2="{cy - a:.1f}"'
    return (f'<g fill="none" stroke-linecap="round">'
            f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" stroke="{DARK}" stroke-width="{w + 7 * k:.1f}"/>'
            f'<line {line} stroke="{DARK}" stroke-width="{w + 7 * k:.1f}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" stroke="{color}" stroke-width="{w:.1f}"/>'
            f'<line {line} stroke="{color}" stroke-width="{w:.1f}"/></g>')


ARROW = "-34,-10 8,-10 8,-24 36,0 8,24 8,10 -34,10"


def reverse_icon(cx, cy, k, color):
    sw = 6
    def arrow(dx, dy, rot):
        return (f'<polygon points="{ARROW}" fill="{color}" stroke="{DARK}" stroke-width="{sw}" stroke-linejoin="round" '
                f'paint-order="stroke" transform="translate({cx + dx * k:.1f} {cy + dy * k:.1f}) rotate({rot}) scale({k:.2f})"/>')
    return arrow(-14, -14, -45) + arrow(14, 14, 135)


def wild_oval(cx, cy, k, rot=28):
    q = [("#E3242B", -70, -118), ("#1F6FEB", 0, -118), ("#F2B705", -70, 0), ("#2EA043", 0, 0)]
    rects = "".join(f'<rect x="{x}" y="{y}" width="70" height="118" fill="{c}"/>' for c, x, y in q)
    return (f'<g transform="translate({cx} {cy}) rotate({rot}) scale({k})">'
            f'<g clip-path="url(#o)">{rects}</g>'
            f'<ellipse cx="0" cy="0" rx="70" ry="118" fill="none" stroke="#fff" stroke-width="{6 / k:.1f}"/></g>')


def wild_corner(cx, cy, k, _color):
    return wild_oval(cx, cy, 0.17, rot=28)


def write(name, content):
    (CARDS / name).write_text(content, encoding="utf-8")
    return f"cards/{name}"


def main():
    CARDS.mkdir(parents=True, exist_ok=True)
    cards = []
    for key, label, col in COLORS:
        for n in range(10):
            img = write(f"{key}-{n}.svg", svg(col, oval() + center_number(str(n), col) + corners(str(n))))
            cards.append({"name": f"{label} {n}", "image": img, "count": 1 if n == 0 else 2})
        img = write(f"{key}-aussetzen.svg", svg(col, oval() + skip_icon(100, 150, 1, col) + corner_icon(skip_icon)))
        cards.append({"name": f"{label} Aussetzen", "image": img, "count": 2})
        img = write(f"{key}-richtung.svg", svg(col, oval() + reverse_icon(100, 150, 1.25, col) + corner_icon(reverse_icon)))
        cards.append({"name": f"{label} Richtungswechsel", "image": img, "count": 2})
        img = write(f"{key}-plus2.svg", svg(col, oval() + text(100, 182, 84, "+2", col, sw=6) + corners("+2", 34)))
        cards.append({"name": f"{label} +2", "image": img, "count": 2})

    img = write("farbwahl.svg", svg(DARK, wild_oval(100, 150, 1) + corner_icon(wild_corner)))
    cards.append({"name": "Farbwahl", "image": img, "count": 4})
    img = write("farbwahl-plus4.svg", svg(DARK, wild_oval(100, 150, 1) + text(100, 182, 84, "+4", "#fff", sw=7) + corners("+4", 34)))
    cards.append({"name": "Farbwahl +4", "image": img, "count": 4})

    back = svg(DARK, oval("#E3242B") + text(100, 172, 66, "UNO", "#F2B705", sw=8, rot=-22))
    (OUT / "back.svg").write_text(back, encoding="utf-8")

    deck = {
        "name": "Uno",
        "description": "Farbe oder Zahl bedienen – wer zuerst alle Karten los ist, gewinnt.",
        "minPlayers": 2,
        "maxPlayers": 4,
        "aspect": 0.6667,
        "back": "back.svg",
        "cover": "cards/farbwahl.svg",
        "table": False,
        "piles": [
            {"id": "ziehen", "name": "Nachziehstapel", "faceUp": False},
            {"id": "ablage", "name": "Ablagestapel", "faceUp": True},
        ],
        "startPile": "ziehen",
        "deal": 7,
        "shouts": [
            {"text": "UNO!", "color": "#ffd43b"},
            {"text": "Rot", "color": "#ff6b6b"},
            {"text": "Gelb", "color": "#ffd43b"},
            {"text": "Grün", "color": "#69db7c"},
            {"text": "Blau", "color": "#74c0fc"},
        ],
        "rules": [
            "Zu Beginn bekommt jeder 7 Karten (Menü → Karten austeilen). Die oberste Karte vom Nachziehstapel kommt offen auf den Ablagestapel.",
            "Reihum legt man eine Karte auf den Ablagestapel, die in Farbe, Zahl oder Symbol passt.",
            "Wer nicht kann oder will, zieht eine Karte (auf den Nachziehstapel tippen).",
            "Aussetzen: der nächste Spieler setzt aus. Richtungswechsel: die Spielrichtung dreht sich um. +2: der nächste zieht 2 Karten.",
            "Farbwahl: darf immer gelegt werden, man wünscht sich eine Farbe (Knopf „Rot/Gelb/Grün/Blau“). Farbwahl +4: zusätzlich zieht der nächste 4 Karten.",
            "Bei der vorletzten Karte „UNO!“ rufen – sonst 2 Strafkarten.",
            "Wer zuerst keine Karten mehr hat, drückt „Gewonnen“. Danach: Menü → Neue Runde.",
            "Ist der Nachziehstapel leer: beim Ablagestapel auf ⋯ tippen → „Alle außer der obersten unter Nachziehstapel mischen“.",
        ],
        "cards": cards,
    }
    (OUT / "deck.json").write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(c["count"] for c in cards)
    print(f"{len(cards)} Kartenarten, {total} Karten geschrieben nach {OUT}")


if __name__ == "__main__":
    main()
