# Rendering the demo-video caption cards

`build-demo-video.sh` overlays five transparent caption PNGs (`cap01..cap05.png`,
608×1320). They're rendered from styled HTML so they use the real brand fonts
(Instrument Serif + JetBrains Mono) and the oxblood accent — **this Homebrew
ffmpeg has no `drawtext`/`subtitles` filter** (built without libass/libfreetype),
so captions cannot be drawn by ffmpeg directly; they must come in as images.

**Just run `scripts/marketing/render-captions.sh`** — it renders all five cards
to `$WORK/cap0{1..5}.png` (transparent, via headless Chrome with the brand
fonts), ready for `build-demo-video.sh`. The markup below documents the card
structure; the script is the source of truth.

The five cards:

| file      | label       | line                   |
| --------- | ----------- | ---------------------- |
| cap01.png | 01 Capture  | Capture anything       |
| cap02.png | 02 Draft    | AI drafts a clean post |
| cap03.png | 03 Catalog  | Your whole catalog     |
| cap04.png | 04 Organize | Organized by theme     |
| cap05.png | 05 Queue    | Nothing gets lost      |

Card markup (one per caption, lower-third with a legibility scrim). The
lower-third is **lifted above the app's bottom tab bar** (large `padding-bottom`)
with a tall, smooth scrim, so the headline sits in a clean band instead of
colliding with the tab bar / last list row:

```html
<style>
  @import url("https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500&display=swap");
  html,
  body {
    margin: 0;
    width: 608px;
    height: 1320px;
    background: transparent;
  }
  .wrap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 64px 40px 176px;
    background: linear-gradient(
      to top,
      rgba(21, 17, 13, 0.95) 0%,
      rgba(21, 17, 13, 0.9) 38%,
      rgba(21, 17, 13, 0.74) 64%,
      rgba(21, 17, 13, 0) 100%
    );
  }
  .rule {
    width: 48px;
    height: 2px;
    background: #d65f57;
    margin-bottom: 18px;
  }
  .label {
    font-family: "JetBrains Mono", monospace;
    font-size: 15px;
    letter-spacing: 3.5px;
    text-transform: uppercase;
    color: #c2b6a1;
  }
  .label .num {
    color: #d65f57;
    margin-right: 10px;
  }
  .line {
    font-family: "Instrument Serif", serif;
    font-size: 50px;
    line-height: 1.14;
    color: #f1e9da;
    margin-top: 14px;
    letter-spacing: -0.4px;
    max-width: 15ch;
    text-wrap: balance;
  }
</style>
<div class="wrap">
  <div class="rule"></div>
  <div class="label"><span class="num">01</span>Capture</div>
  <div class="line">Capture anything</div>
</div>
```

> ffmpeg overlay gotcha: a PNG input is a single frame at pts 0. To fade/position
> it over time you **must** loop it: `-loop 1 -t 16 -i cap01.png`, otherwise the
> alpha `fade` evaluates only at t=0 and the overlay is invisible.
