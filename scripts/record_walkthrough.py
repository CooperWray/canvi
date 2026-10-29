from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "walkthrough"
OUT_DIR.mkdir(exist_ok=True)


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            device_scale_factor=2,
            record_video_dir=str(OUT_DIR),
            record_video_size={"width": 1280, "height": 800},
        )
        page = context.new_page()
        page.goto("http://127.0.0.1:5173/?walkthrough=1", wait_until="networkidle")
        page.get_by_text("Walkthrough complete.").wait_for(timeout=45000)
        page.wait_for_timeout(900)
        video = page.video
        context.close()
        browser.close()
        source = Path(video.path())
        dest = OUT_DIR / "canvi-ux-walkthrough.webm"
        if dest.exists():
            dest.unlink()
        source.replace(dest)
        print(dest)


if __name__ == "__main__":
    main()
