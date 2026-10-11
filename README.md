# Discord Editor

A Revenge/Vendetta plugin that changes how the official Discord account looks on your client:
its **name**, **profile picture** and **banner**.

Based on [thesillyuluv's Discord Editor](https://thesillyuluv.github.io/sillystuff/discordeditor/),
with banner support added. Licensed GPL-3.0.

## Install

Paste this into the Install Plugin box of your client:

```
https://dxckie-cell.github.io/Discord-Editor/discordeditor/
```

## Use

Open the plugin's settings and fill in any of **Name**, **Avatar** (image URL) and **Banner** (image URL).
Leave a field empty to keep Discord's default. Use a direct link to an image ending in `.png`, `.jpg` or `.gif`.

At the bottom of the settings there is a small debug log with Copy and Clear buttons. If a banner does not
show, the `banner patches` line says which part of Discord the plugin could not find.

## Build

```
bun install
bun run build   # writes dist/discordeditor/
```

Pushing to `main` builds and publishes to GitHub Pages (enable it under Settings → Pages, source `gh-pages`).
