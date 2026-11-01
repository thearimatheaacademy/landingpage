"""ONE-OFF: imports the static site pages (exported from the design canvas, then edited) into public/.

Already run. public/ is now the source of truth: edit those files directly. Re-running would overwrite
public/index.html, public/bootcamp/, public/programmes/ and public/retreat/index.html, so it refuses
unless you pass --force.

    python3 scripts/import-site-pages.py <folder with index.html, bootcamp.html, programmes.html, Retreat.dc.html> --force
"""
import re
import sys
from pathlib import Path

if "--force" not in sys.argv:
    sys.exit("Refusing to run: public/ is the source of truth. See the docstring.")
SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "public"

# Relative links (from the old file-per-page export) → absolute paths on the Cloudflare site.
LINKS = [
    ('href="index.html#', 'href="/#'),
    ('href="index.html"', 'href="/"'),
    ('href="bootcamp.html', 'href="/bootcamp/'),
    ('href="retreat.html', 'href="/retreat/'),
    ('href="programmes.html', 'href="/programmes/'),
    ('href="favicon.svg"', 'href="/favicon.svg"'),
    ('href="favicon.ico"', 'href="/favicon.ico"'),
    ('href="apple-touch-icon.png"', 'href="/apple-touch-icon.png"'),
    ('href="assets/', 'href="/assets/'),
    ('src="assets/', 'src="/assets/'),
]
# Every bootcamp registration button goes to the new on-site checkout.
BOOTCAMP = [('href="https://tinyurl.com/thekingdomway"', 'href="/register/"')]


def fix(html):
    for a, b in LINKS:
        html = html.replace(a, b)
    # "/bootcamp/#x" style anchors are fine; "/bootcamp/" + ".html" leftovers are not
    assert ".html" not in re.sub(r'https?://\S+', '', " ".join(re.findall(r'(?:href|src)="([^"]+)"', html))), "relative .html link left"
    return html


def write(rel, html):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html)
    print(f"{rel} ({len(html):,} bytes)")


home = fix((SRC / "index.html").read_text())
write("index.html", home)

boot = (SRC / "bootcamp.html").read_text()
for a, b in BOOTCAMP:
    boot = boot.replace(a, b)
boot = boot.replace('<a href="https://tinyurl.com/thekingdomway" style', '<a href="/register/" style')
write("bootcamp/index.html", fix(boot))

prog = fix((SRC / "programmes.html").read_text())
write("programmes/index.html", prog)

# ── Retreat: built from the canvas source with the shared head, header and scripts ──
dc = (SRC / "Retreat.dc.html").read_text()
body = re.search(r"<x-dc>(.*)</x-dc>", dc, re.S).group(1)
body = re.sub(r"<helmet>.*?</helmet>", "", body, flags=re.S).strip()
body = body.replace("/_blob/9e83f278b4b09ec3650ee099c7f0587b", "/assets/img/coach-collins.png")
body = body.replace('href="Programmes.dc.html"', 'href="/programmes/"').replace('href="Home.dc.html"', 'href="/"')
# The three package buttons open the booking form with that choice preselected.
buttons = iter(['/retreat/book/?room=double', '/retreat/book/?room=single', '/retreat/book/?option=deposit'])
body = re.sub(r'href="https://form\.jotform\.com/"', lambda _m: f'href="{next(buttons)}"', body)

header = re.search(r"<!-- HEADER / NAV -->\s*<header.*?</header>", home, re.S).group(0)
header = header.replace('<a href="/programmes/">PROGRAMMES</a>', '<a href="/programmes/">PROGRAMMES</a>')
header = header.replace('<a href="/#events">EVENTS</a>', '<a href="/#events" aria-current="page">EVENTS</a>')
header = re.sub(r'<a class="cta-gold header-cta" href="[^"]*">[^<]*</a>',
                '<a class="cta-gold header-cta" href="#packages">RESERVE YOUR PLACE</a>', header)
body = re.sub(r"<!-- HEADER / NAV -->\s*<header.*?</header>", lambda _m: header, body, count=1, flags=re.S)
body = body.replace('<div style="font-family: \'Poppins\', system-ui, sans-serif; color: #2B2A24; background: #FBF5E3; width: 100%; overflow-x: hidden">', "", 1)

head = home[: home.index("<body>")]
head = re.sub(r"<title>.*?</title>", "<title>End of Year Retreat | The Arimathea Academy</title>", head)
desc = "Four days away in Leicestershire, 28 to 31 December 2026. Rest, reflect and prepare for the year ahead."
head = re.sub(r'(<meta (?:name="description"|property="og:description") content=")[^"]*"', lambda m: m.group(1) + desc + '"', head)
head = re.sub(r'(<meta property="og:title" content=")[^"]*"', lambda m: m.group(1) + 'End of Year Retreat | The Arimathea Academy"', head)
page = (head + "<body>\n<div style=\"font-family: 'Poppins', system-ui, sans-serif; color: #2B2A24; background: #FBF5E3; width: 100%; overflow-x: hidden\">\n\n"
        + body + '\n</div>\n<script src="/assets/js/site.js" defer></script>\n</body>\n</html>\n')
assert "/_blob/" not in page and ".dc.html" not in page and "jotform" not in page
write("retreat/index.html", fix(page))
