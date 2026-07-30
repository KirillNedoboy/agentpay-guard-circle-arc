from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "agentpay-guard-deck.pdf"
PREVIEW = ROOT / "docs" / "assets" / "agentpay-guard-deck-preview.png"
W, H = 1600, 900
BG = (8, 16, 29)
PANEL = (17, 31, 49)
PANEL2 = (22, 43, 59)
WHITE = (241, 246, 248)
MUTED = (165, 185, 194)
CYAN = (42, 205, 222)
GREEN = (82, 211, 145)
YELLOW = (247, 201, 87)
RED = (245, 105, 103)
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
REG = str(FONT_DIR / "DejaVuSans.ttf")
BOLD = str(FONT_DIR / "DejaVuSans-Bold.ttf")
MONO = str(FONT_DIR / "DejaVuSansMono.ttf")


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def rounded(draw: ImageDraw.ImageDraw, box, fill, radius=22, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def txt(draw, xy, value, size=30, fill=WHITE, bold=False, mono=False, anchor=None):
    f = font(MONO if mono else (BOLD if bold else REG), size)
    draw.text(xy, value, font=f, fill=fill, anchor=anchor)


def paragraph(draw, xy, value, max_chars, size=27, fill=MUTED, leading=12, bold=False):
    x, y = xy
    lines = []
    for raw in value.split("\n"):
        lines.extend(wrap(raw, width=max_chars) or [""])
    f = font(BOLD if bold else REG, size)
    for line in lines:
        draw.text((x, y), line, font=f, fill=fill)
        y += size + leading
    return y


def header(draw, kicker, title, n):
    txt(draw, (86, 55), kicker.upper(), 18, CYAN, bold=True)
    txt(draw, (86, 95), title, 48, WHITE, bold=True)
    txt(draw, (1515, 58), f"{n:02d}", 20, MUTED, mono=True, anchor="ra")
    draw.line((86, 175, 1514, 175), fill=(45, 71, 83), width=2)


def footer(draw):
    draw.line((86, 835, 1514, 835), fill=(45, 71, 83), width=1)
    txt(draw, (86, 850), "AGENTPAY GUARD  /  PROGRAMMABLE MONEY HACKATHON", 16, MUTED, bold=True)
    txt(draw, (1514, 850), "ARC · CIRCLE · ENCODE CLUB", 16, MUTED, bold=True, anchor="ra")


def slide_base():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 16, H), fill=CYAN)
    return im, d


def slide1():
    im, d = slide_base()
    txt(d, (86, 82), "PROGRAMMABLE MONEY HACKATHON", 20, CYAN, bold=True)
    txt(d, (86, 180), "AgentPay Guard", 86, WHITE, bold=True)
    txt(d, (90, 290), "The payment firewall for autonomous AI agents", 38, MUTED, bold=True)
    rounded(d, (90, 410, 1510, 580), PANEL, 28, outline=(46, 82, 94), width=2)
    txt(d, (140, 455), "PROPOSED USDC PAYMENT INTENT", 22, CYAN, bold=True)
    txt(d, (140, 500), "ALLOW", 44, GREEN, bold=True)
    txt(d, (480, 500), "REVIEW", 44, YELLOW, bold=True)
    txt(d, (865, 500), "BLOCK", 44, RED, bold=True)
    txt(d, (140, 650), "Deterministic policy. Explainable evidence. Human-confirmed boundaries.", 29, WHITE, bold=True)
    txt(d, (90, 790), "Agentic Economy Track  ·  Arc / Circle / Encode Club", 22, MUTED)
    return im


def slide2():
    im, d = slide_base(); header(d, "The problem", "Autonomous payment intent is faster than human review", 2)
    rounded(d, (86, 235, 760, 735), PANEL, 24)
    txt(d, (130, 285), "AN AGENT CAN FORM A REQUEST", 22, CYAN, bold=True)
    paragraph(d, (130, 345), "before an operator can assess whether the recipient, purpose, amount, route, authority, and fee context are acceptable.", 32, 33, WHITE, 16, True)
    rounded(d, (840, 235, 1514, 735), PANEL2, 24)
    txt(d, (885, 285), "A PAYMENT RAIL ALONE DOES NOT", 22, YELLOW, bold=True)
    paragraph(d, (885, 345), "preserve the policy reasoning behind the decision. AgentPay Guard creates that missing evidence boundary before settlement.", 31, 31, WHITE, 16, True)
    txt(d, (885, 650), "intent  →  policy  →  evidence", 30, CYAN, bold=True, mono=True)
    footer(d); return im


def slide3():
    im, d = slide_base(); header(d, "The solution", "A hard policy boundary before settlement", 3)
    steps = [("01", "Proposed intent", CYAN), ("02", "Validation", WHITE), ("03", "Policy engine", YELLOW), ("04", "Decision + receipt", GREEN)]
    x = 95
    for i, (num, label, color) in enumerate(steps):
        rounded(d, (x, 320, x+315, 545), PANEL, 22, outline=color, width=3)
        txt(d, (x+28, 350), num, 22, color, bold=True, mono=True)
        paragraph(d, (x+28, 415), label, 15, 28, WHITE, 8, True)
        if i < len(steps)-1:
            txt(d, (x+328, 410), "→", 42, CYAN, bold=True)
        x += 370
    txt(d, (95, 650), "ALLOW", 34, GREEN, bold=True)
    txt(d, (410, 650), "REVIEW", 34, YELLOW, bold=True)
    txt(d, (790, 650), "BLOCK", 34, RED, bold=True)
    txt(d, (95, 715), "Every outcome carries matched rules, risk context, an audit ID, and an AgentPay Receipt.", 25, MUTED)
    footer(d); return im


def slide4():
    im, d = slide_base(); header(d, "Policy contexts", "One boundary, multiple payment proposals", 4)
    cards = [
        ("GENERIC USDC", "Recipient · scenario · amount\nDaily limit · velocity\nSuspicious keywords", CYAN),
        ("CCTP ROUTE PREVIEW", "Ethereum → Base\nFast Transfer · wallet control\nEstimated fee · decimal-safe totals", YELLOW),
        ("ERC-20 AUTHORITY", "approve / transferFrom\nSpender policy\nUSDC base units", GREEN),
        ("PAYMASTER PREVIEW", "Local USDC fee budget\nNo UserOperation\nNo gas execution", RED),
    ]
    positions = [(86, 245), (790, 245), (86, 510), (790, 510)]
    for (title, body, color), (x, y) in zip(cards, positions):
        rounded(d, (x, y, x+620, y+205), PANEL, 20, outline=color, width=2)
        txt(d, (x+28, y+28), title, 20, color, bold=True)
        paragraph(d, (x+28, y+78), body, 31, 24, WHITE, 5)
    txt(d, (86, 770), "All protocol-facing values remain proposal-only evidence in the current MVP.", 24, MUTED, bold=True)
    footer(d); return im


def fit_image(path: Path, box):
    im = Image.open(path).convert("RGB")
    bw, bh = box[2]-box[0], box[3]-box[1]
    scale = min(bw/im.width, bh/im.height)
    size = (max(1, int(im.width*scale)), max(1, int(im.height*scale)))
    im = im.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (bw, bh), (4, 10, 19))
    canvas.paste(im, ((bw-size[0])//2, (bh-size[1])//2))
    return canvas


def slide5():
    im, d = slide_base(); header(d, "The demo", "Make the decision and evidence legible", 5)
    left = fit_image(ROOT / "screenshots" / "06-citepay-guard-decisions.png", (86, 225, 865, 770))
    im.paste(left, (86, 225)); rounded(d, (86, 225, 865, 770), None, 18, outline=(59, 91, 102), width=2)
    rounded(d, (930, 225, 1515, 770), PANEL, 24)
    txt(d, (975, 275), "OPERATOR PATH", 21, CYAN, bold=True)
    paragraph(d, (975, 330), "CitePay request\n→ proposed USDC intent\n→ Guard preflight\n→ matched rules\n→ AgentPay Receipt", 24, 29, WHITE, 12, True)
    txt(d, (975, 625), "fundsMoved: false", 26, GREEN, bold=True, mono=True)
    txt(d, (975, 680), "No wallet. No signing. No live settlement.", 20, MUTED)
    footer(d); return im


def slide6():
    im, d = slide_base(); header(d, "Trust boundary", "Proof now, execution later", 6)
    rounded(d, (86, 235, 760, 760), PANEL, 24)
    txt(d, (130, 280), "IMPLEMENTED NOW", 22, GREEN, bold=True)
    paragraph(d, (130, 345), "Deterministic local policy engine\nAppend-only JSONL audit trail\nIdempotent replay by intent key\nAgentPay Receipt evidence\nProduction build and public demo", 30, 28, WHITE, 12)
    rounded(d, (840, 235, 1515, 760), PANEL2, 24)
    txt(d, (885, 280), "EXPLICITLY NOT EXECUTED", 22, RED, bold=True)
    paragraph(d, (885, 345), "No wallet connection\nNo private keys or signing\nNo live funds movement\nNo live Arc / Circle / CCTP / x402 calls\nNo settlement or finality claim", 30, 28, WHITE, 12)
    footer(d); return im


def slide7():
    im, d = slide_base(); header(d, "Proof and roadmap", "A controlled path from evidence to settlement", 7)
    rounded(d, (86, 235, 705, 750), PANEL, 24)
    txt(d, (130, 280), "VALIDATED", 22, CYAN, bold=True)
    txt(d, (130, 355), "142", 78, WHITE, bold=True)
    txt(d, (335, 386), "passing tests", 29, MUTED, bold=True)
    txt(d, (130, 500), "10 test files", 27, WHITE, bold=True)
    txt(d, (130, 555), "lint · typecheck · build", 27, WHITE, bold=True)
    txt(d, (130, 640), "systemd production service", 25, GREEN, bold=True)
    rounded(d, (775, 235, 1515, 750), PANEL2, 24)
    txt(d, (820, 280), "ROADMAP", 22, YELLOW, bold=True)
    paragraph(d, (820, 345), "Put Arc / Circle Gateway / x402 adapters behind the same policy boundary only after the evidence contract is proven.", 31, 29, WHITE, 12, True)
    txt(d, (820, 595), "github.com/KirillNedoboy/agentpay-guard-circle-arc", 18, CYAN, mono=True)
    txt(d, (820, 645), "https://138-124-108-146.nip.io", 20, CYAN, mono=True)
    txt(d, (820, 700), "AGENTPAY GUARD", 24, WHITE, bold=True)
    footer(d); return im


if __name__ == "__main__":
    slides = [slide1(), slide2(), slide3(), slide4(), slide5(), slide6(), slide7()]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    slides[0].save(OUT, "PDF", resolution=144.0, save_all=True, append_images=slides[1:])
    slides[0].save(PREVIEW, "PNG")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    print(f"wrote {PREVIEW} ({PREVIEW.stat().st_size} bytes)")
