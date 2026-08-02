#!/usr/bin/env python3
"""
Render documentation screenshots for every theme in themes/.

Each screenshot is a mock pi session drawn with the theme's actual tokens
(the vars are resolved from the JSON, so the images can never drift from
the theme). The braille ink of the harness footer is drawn as real dot
matrices — the way the terminal renders it.

Run:  npm run render:screenshots   (or python3 scripts/render-screenshots.py)
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES_DIR = os.path.join(ROOT, "themes")
OUT_DIR = os.path.join(THEMES_DIR, "screenshots")

SCALE = 2  # 2x so the captures stay crisp on retina
W, H = 1280, 800

FONT_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Supplemental/Monaco.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]


def font(size_pt: int) -> ImageFont.FreeTypeFont:
    """Monospace font at 2x, first face that loads."""
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size_pt * SCALE)
            except Exception:
                continue
    return ImageFont.load_default()


F_TITLE = font(13)
F_SMALL = font(13)
F_BODY = font(15)
F_CODE = font(14)
F_FOOT = font(14)


class Theme:
    def __init__(self, path: str):
        data = json.load(open(path))
        self.name = data["name"]
        self.vars = data.get("vars", {})
        self.colors = data["colors"]

    def c(self, key: str) -> str:
        """Resolve a color key (may be a var reference or hex)."""
        v = self.colors[key]
        return self.vars.get(v, v)

    def v(self, key: str) -> str:
        """Resolve a var directly (backgrounds live in vars)."""
        return self.vars.get(key, key)


def braille(pattern: int):
    """Dots (col, row) for a braille pattern, per the Unicode standard."""
    dots = []
    for n in range(8):
        if pattern >> n & 1:
            if n < 6:
                dots.append((n // 3, n % 3))
            else:
                dots.append((n - 6, 3))
    return dots


def draw_braille(d: ImageDraw.ImageDraw, x: float, y: float, em: float,
                 ch: str, color: str) -> None:
    """Draw one braille cell as dots. x/y = top-left of the cell."""
    pattern = ord(ch) - 0x2800
    r = em * 0.135
    for col, row in braille(pattern):
        cx = x + col * em * 0.30
        cy = y + row * em * 0.27
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)


def text_width(d: ImageDraw.ImageDraw, s: str, f) -> float:
    return d.textlength(s, font=f)


def draw_segments(d: ImageDraw.ImageDraw, x: float, y: float,
                  segments, f) -> float:
    """Draw colored text segments left to right; returns end x."""
    for text, color in segments:
        if text == "":
            continue
        d.text((x, y), text, font=f, fill=color)
        x += text_width(d, text, f)
    return x


def render_theme(theme: Theme, path: str) -> None:
    img = Image.new("RGB", (W * SCALE, H * SCALE), theme.v("bg0"))
    d = ImageDraw.Draw(img)
    c = theme.c
    cx = 48 * SCALE

    # ── window chrome ──
    bar_h = 56 * SCALE
    d.rounded_rectangle([0, 0, W * SCALE, bar_h], radius=0, fill=theme.v("bg2"))
    for color, dx in ((c("error"), 20), (c("warning"), 44), (c("success"), 68)):
        d.ellipse([dx * SCALE, 20 * SCALE, (dx + 10) * SCALE, 30 * SCALE], fill=color)
    d.text((92 * SCALE, 19 * SCALE), f"pi — {theme.name}", font=F_TITLE, fill=c("muted"))

    y = bar_h + 28 * SCALE

    # ── status line ──
    draw_segments(d, cx, y, [
        ("plan", c("accent")),
        ("   ", None), ("~/C/p/a-w/p/reckoner  main +2", c("muted")),
        ("   ", None), ("claude-fable-5", c("dim")),
        ("   ", None), ("$0.42", c("dim")),
    ], F_SMALL)
    y += 34 * SCALE

    # ── user message ──
    bubble_w = 700 * SCALE
    bubble_h = 74 * SCALE
    d.rounded_rectangle([cx, y, cx + bubble_w, y + bubble_h], radius=12 * SCALE,
                        fill=c("userMessageBg"), outline=c("borderMuted"))
    d.text((cx + 18 * SCALE, y + 12 * SCALE), "you", font=F_SMALL, fill=c("accent"))
    d.text((cx + 18 * SCALE, y + 38 * SCALE), "the ink wall needs to breathe like the old one did",
           font=F_BODY, fill=c("userMessageText"))
    y += bubble_h + 26 * SCALE

    # ── assistant message ──
    d.text((cx, y), "I rebuilt the footer as one braille ink system — a drop, a CONTEXT",
           font=F_BODY, fill=c("text"))
    y += 30 * SCALE
    d.text((cx, y), "well, and a STEPS trail, all on one 250ms tick. The well stills to",
           font=F_BODY, fill=c("text"))
    y += 30 * SCALE
    d.text((cx, y), "amber below 30% left, red below 10% — stillness as severity.",
           font=F_BODY, fill=c("text"))
    y += 42 * SCALE

    # ── code block ──
    code_w = 860 * SCALE
    code_h = 116 * SCALE
    d.rounded_rectangle([cx, y, cx + code_w, y + code_h], radius=10 * SCALE,
                        fill=c("toolPendingBg"), outline=c("borderMuted"))
    code_x = cx + 22 * SCALE
    code_y = y + 18 * SCALE
    draw_segments(d, code_x, code_y, [
        ("const ", c("syntaxKeyword")), ("drop", c("syntaxVariable")),
        (" = ", c("syntaxPunctuation")), ("DROP_FRAMES", c("syntaxVariable")),
        ("[", c("syntaxPunctuation")), ("tick", c("syntaxVariable")),
        (" % ", c("syntaxOperator")), ("12", c("syntaxNumber")),
        ("]", c("syntaxPunctuation")),
    ], F_CODE)
    code_y += 32 * SCALE
    draw_segments(d, code_x, code_y, [
        ("return ", c("syntaxKeyword")), ("theme.fg", c("syntaxFunction")),
        ("(", c("syntaxPunctuation")), ("drop", c("syntaxVariable")),
        ("[", c("syntaxPunctuation")), ("1", c("syntaxNumber")),
        ("]", c("syntaxPunctuation")), (", ", c("syntaxPunctuation")),
        ("drop", c("syntaxVariable")), ("[", c("syntaxPunctuation")),
        ("0", c("syntaxNumber")), ("])", c("syntaxPunctuation")),
        ("   // the harness is alive", c("syntaxComment")),
    ], F_CODE)
    y += code_h + 26 * SCALE

    # ── verify line ──
    draw_segments(d, cx, y, [
        ("verify:self", c("success")),
        ("  pass 3 · fail 0 · themes 7/7", c("dim")),
    ], F_SMALL)

    # ── footer (pinned to the bottom) ──
    foot_h = 58 * SCALE
    foot_y = H * SCALE - foot_h
    d.rectangle([0, foot_y, W * SCALE, foot_y + 2 * SCALE], fill=c("borderMuted"))
    fy = foot_y + 20 * SCALE
    em = 14 * SCALE
    x = cx
    draw_braille(d, x, fy, em, "⣶", c("muted")); x += em * 1.05
    x += 14 * SCALE
    x = draw_segments(d, x, fy + 2 * SCALE, [("~/C/p/a-w/p/reckoner  main +2", c("muted"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("  ⠄  ", c("dim"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("plan", c("accent"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("  ⠄  ", c("dim"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("STEPS ", c("dim"))], F_FOOT)
    for ch, color in [("⣿", c("muted")), ("⣿", c("muted")), ("⣷", c("muted")), ("⣀", c("dim"))]:
        draw_braille(d, x, fy, em, ch, color); x += em * 0.62
    # right side
    rx = W * SCALE - 48 * SCALE
    right = [("CONTEXT ", c("dim")), ("ink-wall-refactor", c("muted"))]
    # measure right side in reverse
    rsegs = [("CONTEXT ", c("dim"))]
    rw = text_width(d, "CONTEXT ", F_FOOT)
    for ch, color in [("⣿", c("muted")), ("⣿", c("muted")), ("⣿", c("muted")), ("⣾", c("muted")), ("⣀", c("dim")), ("⣀", c("dim"))]:
        rw += em * 0.62
    rw += text_width(d, "  ⠄  $0.42", F_FOOT) + text_width(d, "  ⠄  claude-fable-5", F_FOOT) + text_width(d, "  ⠄  ink-wall-refactor", F_FOOT)
    x = rx - rw
    x = draw_segments(d, x, fy + 2 * SCALE, [("ink-wall-refactor", c("muted"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("  ⠄  ", c("dim"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("claude-fable-5", c("dim"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("  ⠄  ", c("dim"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("$0.42", c("dim"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("  ⠄  ", c("dim"))], F_FOOT)
    x = draw_segments(d, x, fy + 2 * SCALE, [("CONTEXT ", c("dim"))], F_FOOT)
    for ch, color in [("⣿", c("muted")), ("⣿", c("muted")), ("⣿", c("muted")), ("⣾", c("muted")), ("⣀", c("dim")), ("⣀", c("dim"))]:
        draw_braille(d, x, fy, em, ch, color); x += em * 0.62

    img.save(path)
    print(f"wrote {path}")


def render_footer_states(theme: Theme, path: str) -> None:
    """The CONTEXT well at four levels: breathing, warm, low, critical."""
    img = Image.new("RGB", (W * SCALE, H * SCALE), theme.v("bg0"))
    d = ImageDraw.Draw(img)
    c = theme.c
    em = 14 * SCALE
    states = [
        (84, c("muted"), "breathing"),
        (62, c("muted"), "breathing"),
        (28, c("warning"), "amber — still"),
        (7, c("error"), "red — still"),
    ]
    y = 140 * SCALE
    for avail, ink, caption in states:
        filled = max(1, round(avail / 100 * 6))
        x = 90 * SCALE
        draw_braille(d, x, y, em, "⣶", c("muted")); x += em * 1.05 + 14 * SCALE
        x = draw_segments(d, x, y + 2 * SCALE, [("~/C/p/a-w/p/reckoner  main +2", c("muted"))], F_FOOT)
        x = draw_segments(d, x, y + 2 * SCALE, [("  ⠄  ", c("dim"))], F_FOOT)
        x = draw_segments(d, x, y + 2 * SCALE, [("plan", c("accent"))], F_FOOT)
        x = draw_segments(d, x, y + 2 * SCALE, [("  ⠄  ", c("dim"))], F_FOOT)
        x = draw_segments(d, x, y + 2 * SCALE, [("CONTEXT ", c("dim"))], F_FOOT)
        for i in range(6):
            if i < filled:
                draw_braille(d, x, y, em, "⣿" if i < filled - 1 else "⣶", ink)
            else:
                draw_braille(d, x, y, em, "⣀", c("dim"))
            x += em * 0.62
        x += 26 * SCALE
        x = draw_segments(d, x, y + 2 * SCALE, [(f"{avail}% left", c("muted"))], F_FOOT)
        x = draw_segments(d, x, y + 2 * SCALE, [("  —  ", c("dim"))], F_FOOT)
        draw_segments(d, x, y + 2 * SCALE, [(caption, c("dim"))], F_FOOT)
        y += 76 * SCALE
    d.text((90 * SCALE, y + 10 * SCALE),
           "the well breathes while calm, and stills when it matters",
           font=F_SMALL, fill=c("dim"))
    img.save(path)
    print(f"wrote {path}")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    files = sorted(f for f in os.listdir(THEMES_DIR) if f.startswith("reckoner-") and f.endswith(".json"))
    for f in files:
        theme = Theme(os.path.join(THEMES_DIR, f))
        render_theme(theme, os.path.join(OUT_DIR, f.replace(".json", ".png")))
    render_footer_states(Theme(os.path.join(THEMES_DIR, "reckoner-exect.json")),
                         os.path.join(OUT_DIR, "footer-states.png"))


if __name__ == "__main__":
    sys.exit(main())
