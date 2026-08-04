from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "agentpay-guard-deck.pdf"
PREVIEW = ROOT / "docs" / "assets" / "agentpay-guard-deck-preview.png"
SCREENSHOT = ROOT / "docs" / "assets" / "screenshots" / "x402-policy-envelope.png"
FALLBACK_SCREENSHOT = ROOT / "docs" / "assets" / "screenshots" / "demo-main.png"
W, H = 1600, 900
BG = (8, 16, 29)
PANEL = (17, 31, 49)
PANEL_ALT = (22, 43, 59)
WHITE = (241, 246, 248)
MUTED = (165, 185, 194)
CYAN = (42, 205, 222)
GREEN = (82, 211, 145)
YELLOW = (247, 201, 87)
RED = (245, 105, 103)

FONT_CANDIDATES = {
    "regular": [Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")],
    "bold": [Path("C:/Windows/Fonts/arialbd.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")],
    "mono": [Path("C:/Windows/Fonts/consola.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")],
}


def resolve_font(kind: str) -> str:
    for candidate in FONT_CANDIDATES[kind]:
        if candidate.exists():
            return str(candidate)
    raise RuntimeError(f"No supported {kind} font found: {FONT_CANDIDATES[kind]}")


REG = resolve_font("regular")
BOLD = resolve_font("bold")
MONO = resolve_font("mono")


def f(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(MONO if mono else (BOLD if bold else REG), size)


def text(draw: ImageDraw.ImageDraw, xy, value: str, size: int = 30, fill=WHITE, bold: bool = False, mono: bool = False, anchor=None):
    draw.text(xy, value, font=f(size, bold, mono), fill=fill, anchor=anchor)


def paragraph(draw: ImageDraw.ImageDraw, xy, value: str, width: int, size: int = 28, fill=MUTED, leading: int = 12, bold: bool = False):
    x, y = xy
    for source_line in value.split("\n"):
        for line in wrap(source_line, width=width) or [""]:
            draw.text((x, y), line, font=f(size, bold), fill=fill)
            y += size + leading
    return y


def card(draw: ImageDraw.ImageDraw, box, fill=PANEL, outline=None):
    draw.rounded_rectangle(box, radius=22, fill=fill, outline=outline, width=2 if outline else 1)


def base(kicker: str, title: str, page: int):
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 16, H), fill=CYAN)
    text(draw, (86, 55), kicker.upper(), 18, CYAN, bold=True)
    text(draw, (86, 95), title, 46, WHITE, bold=True)
    text(draw, (1515, 58), f"{page:02d}", 20, MUTED, mono=True, anchor="ra")
    draw.line((86, 175, 1514, 175), fill=(45, 71, 83), width=2)
    draw.line((86, 835, 1514, 835), fill=(45, 71, 83), width=1)
    text(draw, (86, 850), "AGENTPAY GUARD / PROGRAMMABLE MONEY HACKATHON", 16, MUTED, bold=True)
    text(draw, (1514, 850), "ARC / CIRCLE / ENCODE CLUB", 16, MUTED, bold=True, anchor="ra")
    return image, draw


def slide_one():
    image, draw = base("Agentic Economy Track", "AgentPay Guard", 1)
    text(draw, (86, 225), "Policy and evidence before autonomous USDC spend", 42, WHITE, bold=True)
    paragraph(draw, (90, 305), "A deterministic control plane that evaluates an agent payment intent, returns ALLOW / REVIEW / BLOCK, and records evidence before any future settlement adapter executes.", 67, 30, MUTED, 14)
    card(draw, (90, 495, 1510, 670), PANEL, CYAN)
    text(draw, (135, 535), "x402-STYLE API INTENT", 20, CYAN, bold=True)
    text(draw, (135, 585), "ALLOW", 38, GREEN, bold=True)
    text(draw, (530, 585), "REVIEW", 38, YELLOW, bold=True)
    text(draw, (945, 585), "BLOCK", 38, RED, bold=True)
    text(draw, (90, 745), "No wallet. No signing. No broadcast. No USDC movement.", 27, WHITE, bold=True)
    return image


def slide_two():
    image, draw = base("The problem", "Agents outpace payment review", 2)
    card(draw, (86, 235, 760, 730), PANEL)
    text(draw, (130, 285), "THE REQUEST", 21, CYAN, bold=True)
    paragraph(draw, (130, 345), "An agent can propose a recipient, amount, purpose, route, authority, and fee context in seconds.", 31, 31, WHITE, 15, True)
    card(draw, (840, 235, 1514, 730), PANEL_ALT)
    text(draw, (885, 285), "THE GAP", 21, YELLOW, bold=True)
    paragraph(draw, (885, 345), "A payment rail does not retain why the request was allowed, reviewed, or blocked. That reasoning must exist before execution.", 31, 31, WHITE, 15, True)
    return image


def slide_three():
    image, draw = base("First proof", "A trusted 0.08 USDC x402-style API intent", 3)
    stages = ["Intent", "Validation", "Policy + limits", "Decision + receipt", "Future adapter"]
    colors = [CYAN, WHITE, YELLOW, GREEN, MUTED]
    x = 86
    for index, (stage, color) in enumerate(zip(stages, colors)):
        card(draw, (x, 320, x + 255, 510), PANEL, color)
        text(draw, (x + 24, 350), f"0{index + 1}", 18, color, bold=True, mono=True)
        paragraph(draw, (x + 24, 405), stage, 14, 25, WHITE, 8, True)
        x += 285
    paragraph(draw, (90, 620), "The envelope shows per-request limit, daily spend, remaining budget, projected spend, velocity, matched rules, reason codes, and append-only audit evidence.", 86, 27, MUTED, 12)
    text(draw, (90, 740), "AgentPay Receipt: fundsMoved: false", 28, GREEN, bold=True, mono=True)
    return image


def slide_four():
    image, draw = base("Policy contexts", "One Guard, several proposal types", 4)
    items = [
        ("GENERIC USDC", "Recipient, scenario, amount, daily limit, velocity, suspicious terms", CYAN),
        ("CCTP PREVIEW", "Local route, finality, wallet-control, fee, and total-budget policy", YELLOW),
        ("ERC-20 AUTHORITY", "Proposed approve / transferFrom and deterministic spender policy", GREEN),
        ("PAYMASTER PREVIEW", "Local USDC fee and wallet-control policy; no UserOperation", RED),
    ]
    for (title, body, color), (x, y) in zip(items, [(86, 245), (790, 245), (86, 510), (790, 510)]):
        card(draw, (x, y, x + 620, y + 205), PANEL, color)
        text(draw, (x + 28, y + 28), title, 20, color, bold=True)
        paragraph(draw, (x + 28, y + 78), body, 34, 24, WHITE, 6)
    return image


def fit_image(path: Path, box):
    source = Image.open(path).convert("RGB")
    width, height = box[2] - box[0], box[3] - box[1]
    scale = min(width / source.width, height / source.height)
    resized = source.resize((max(1, int(source.width * scale)), max(1, int(source.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), (4, 10, 19))
    canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return canvas


def slide_five():
    image, draw = base("Judge path", "The x402 policy envelope in one minute", 5)
    screenshot = SCREENSHOT if SCREENSHOT.exists() else FALLBACK_SCREENSHOT
    image.paste(fit_image(screenshot, (86, 225, 865, 770)), (86, 225))
    card(draw, (930, 225, 1515, 770), PANEL)
    text(draw, (975, 275), "WHAT THE JUDGE SEES", 20, CYAN, bold=True)
    paragraph(draw, (975, 330), "Trusted API intent\nALLOW / REVIEW / BLOCK\nSpend controls\nMatched rules + audit trace\nReceipt + future adapter boundary", 28, 27, WHITE, 11, True)
    text(draw, (975, 630), "fundsMoved: false", 25, GREEN, bold=True, mono=True)
    text(draw, (975, 685), "broadcast: false", 25, GREEN, bold=True, mono=True)
    return image


def slide_six():
    image, draw = base("Boundary", "Evidence now; execution remains separate", 6)
    card(draw, (86, 235, 760, 760), PANEL)
    text(draw, (130, 285), "IMPLEMENTED", 21, GREEN, bold=True)
    paragraph(draw, (130, 345), "Deterministic policy\nDecimal-safe controls\nAppend-only JSONL\nIdempotent replay\nAgentPay Receipt", 30, 28, WHITE, 11)
    card(draw, (840, 235, 1515, 760), PANEL_ALT)
    text(draw, (885, 285), "NOT EXECUTED", 21, RED, bold=True)
    paragraph(draw, (885, 345), "No wallet or private keys\nNo signing or custody\nNo live Arc / Circle / x402 call\nNo RPC or transaction\nNo settlement or finality claim", 30, 28, WHITE, 11)
    return image


def slide_seven():
    image, draw = base("Release state", "Keep every adapter behind the evidence contract", 7)
    card(draw, (86, 235, 705, 750), PANEL)
    text(draw, (130, 285), "VERIFICATION", 21, CYAN, bold=True)
    paragraph(draw, (130, 355), "Deterministic tests\nLint and typecheck\nProduction build\nLocal API smoke", 28, 30, WHITE, 12, True)
    text(draw, (130, 635), "Append-only JSONL + idempotency", 22, GREEN, bold=True)
    card(draw, (775, 235, 1515, 750), PANEL_ALT)
    text(draw, (820, 285), "NEXT MANUAL ACTIONS", 21, YELLOW, bold=True)
    paragraph(draw, (820, 345), "Review the integration PR. Redeploy the public demo from merged main. Review or re-record the public video for the x402-first click path.", 34, 28, WHITE, 12, True)
    text(draw, (820, 620), "github.com/KirillNedoboy/agentpay-guard-circle-arc", 17, CYAN, mono=True)
    text(draw, (820, 680), "NO WALLET / NO SIGNING / NO BROADCAST", 20, WHITE, bold=True)
    return image


if __name__ == "__main__":
    slides = [slide_one(), slide_two(), slide_three(), slide_four(), slide_five(), slide_six(), slide_seven()]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    slides[0].save(OUT, "PDF", resolution=144.0, save_all=True, append_images=slides[1:])
    slides[0].save(PREVIEW, "PNG")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    print(f"wrote {PREVIEW} ({PREVIEW.stat().st_size} bytes)")
