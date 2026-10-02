# ContactFlow brand kit (for ChatGPT)

| Asset | File | Notes |
|---|---|---|
| Logo | `package/assets/logo.png` | 512×512, transparent corners. Rendered from `packages/web/public/logo.svg` (the main logo, "B": soft light and shadow on the flat mark). |
| Composer icon | `package/assets/icon.png` | Same mark, 512×512. |
| Vector source | `packages/web/public/logo.svg` | The mark: a flow line from a person (cream dot) to a delivered email (green dot). Same art in `favicon.svg` and the site's `AppIcon` component. |
| Share image | `packages/web/public/og-v3.png` | 1200×630; handy as a portal screenshot backdrop. |

## Colours

| Token | Hex | Use |
|---|---|---|
| Ink | `#15171A` | Logo tile, `brandColor` (light mode) |
| Cream | `#F6F5F2` | Mark strokes, backgrounds |
| Signal green | `#12A87C` | The "delivered" dot, `brandColorDark` (dark mode), success states |

## Fonts

ChatGPT shows plugin listings and tool results in its own fonts, so **the plugin needs no font
files**. Ours only matter for a future in-chat results widget (Apps SDK view):

- **Geist** (500/600/700): wordmark and headings
- **Geist Mono**: emails, formats, numbers
- **Inter**: body text

All three are free on Google Fonts; the website loads them from there.
