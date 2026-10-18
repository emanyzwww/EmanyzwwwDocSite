+++
title = 'About'
description = 'About this site, and how to change it.'
+++

This page is yours — replace it with your own introduction, background,
and contact details. The source lives in `content/about/index.en.md`.

## About this theme

No third-party theme is involved; every template and stylesheet is in the repo:

- `assets/css/tokens.css` — **all** colors, type sizes, spacing and radii live here.
  Change this one file to restyle the whole site; no values are hardcoded elsewhere.
- `assets/css/*.css` — styles split by concern (base, layout, components, content, widgets).
- `layouts/` — templates; every piece is a partial you can freely edit.
- `data/profile.yaml` — avatar, name, bio, social links.
- `data/widgets.yaml` — custom sidebar cards; add an entry to add a card.

## Extend it however you like

This theme doesn't lock you into one structure. To add a component:

```text
layouts/partials/widgets/music.html   ← create
hugo.toml, widgets = [..., 'music']   ← register
```

Remove one by deleting it from the array — no template changes needed.

## Contact

- GitHub: <https://github.com/>
- Email: <mailto:you@example.com>
