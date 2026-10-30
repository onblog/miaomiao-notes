<div align="center">

<img src="site/public/assets/icon.svg" width="112" alt="Miaomiao Notes" />

<h1>喵喵笔记 · Miaomiao Notes</h1>

<p><strong>一只喵喵的本地 Markdown 笔记应用</strong><br />
<sub>A cute, local-first Markdown notes app for macOS</sub></p>

<p>
  <a href="https://notes.wordtk.com"><img src="https://img.shields.io/badge/下载-Download-ff7a45?style=for-the-badge" alt="Download" /></a>
  <img src="https://img.shields.io/badge/macOS-12%2B-1f2328?style=for-the-badge&logo=apple&logoColor=white" alt="macOS 12+" />
  <img src="https://img.shields.io/badge/iCloud-Drive-3b82f6?style=for-the-badge&logo=icloud&logoColor=white" alt="iCloud Drive" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-6b7280?style=for-the-badge" alt="AGPL-3.0-only" />
</p>

<p>
  <a href="README.zh-CN.md">🇨🇳 中文</a> ·
  <a href="https://notes.wordtk.com/stats">📊 Usage</a>
</p>

</div>

---

<img src="site/public/assets/screenshot.png" alt="喵喵笔记界面" />

## Why another notes app?

Because your notes should be **files**, not someone else's database.

- Three-column layout borrowed from Apple Notes: folders → notes → content
- Every note is a plain `.md` file inside iCloud Drive, so it syncs across your Macs for free
- No account, no server, no subscription — completely free, no sign-up
- A deliberately small, warm UI — one carefully made theme instead of twenty mediocre ones

## Features

| Area | What you get |
| --- | --- |
| Layout | Folder column, note column, editor — native macOS chrome; position, size, zoom and fullscreen are remembered across relaunches |
| Editing | CodeMirror 6, Markdown syntax highlighting, live preview (⌘E) |
| Storage | Plain `.md` files; iCloud Drive when available, otherwise `~/Documents` |
| Sync | macOS iCloud Drive, no extra service |
| Safety | Atomic writes, `.trash` soft delete, iCloud conflict detection |
| Interface | Chinese / English, light and dark themes |
| Updates | Manual check in Settings, plus one silent check per day |

## Requirements

- macOS 12 or later (Apple Silicon or Intel)
- iCloud Drive is optional — without it the library lives in `~/Documents/MiaomiaoNotes`

## Install

Download the latest build from **[notes.wordtk.com](https://notes.wordtk.com)**,
open the dmg and drag the app into Applications.

The build is ad-hoc signed, not notarised, so the first launch needs a right click →
**Open**. After that it starts normally.

## Development

```bash
npm install
npm run dev      # Vite + Electron with hot reload
npm run start    # build once, then launch Electron
npm run dist     # package macOS dmg for arm64 and x64 (prunes stale artifacts)
npm run clean    # keep only the current version in release/
```

## Where notes live

```
~/Library/Mobile Documents/com~apple~CloudDocs/MiaomiaoNotes/   # iCloud available
~/Documents/MiaomiaoNotes/                                      # fallback
```

The path is resolved once on first launch and stored in Settings, so signing into
iCloud later never moves your library. You can change it at any time under
**Settings → Storage**, which switches the pointer without moving or deleting files.

## iCloud conflicts

iCloud sync is eventually consistent. If the same note is edited on two Macs
before syncing, iCloud creates a copy like `笔记 2.md`. Miaomiao Notes:

- detects those copies before and after each write
- shows a warning banner in the editor
- **never merges automatically** — silent merging loses data more often than it saves it

## Privacy

- The app sends one anonymous launch signal (a random device id) and nothing else
- No IP, no user agent, no hardware details are stored
- The toggle lives in **Settings → Behaviour → Anonymous usage**
- The website has no analytics, no ads, no cookies and no third-party requests

## Architecture

```
electron/       Main process: window, vault paths, file IO, native menu, IPC
src/            Renderer: three-column UI, CodeMirror editor, Markdown preview
src/styles/     Design tokens and theme (a new theme is one [data-theme] block)
build/          App icon sources (SVG + generated icns)
site/           Official site: Cloudflare Worker plus static assets
```

The renderer never touches the filesystem directly — everything goes through a
narrow `contextBridge` surface with `contextIsolation` and sandbox enabled.

## License

Dual-licensed:

- **Open source** — [AGPL-3.0-only](LICENSE). Free to use, modify and self-host.
  If you distribute a modified version, or expose it as a network service, the
  AGPL requires you to publish the corresponding source as well.
- **Commercial** — if AGPL does not fit your product (for example, you want to
  ship a closed-source derivative), a commercial license is available.
  Contact **hello@wordtk.com**.

The name "喵喵笔记 / Miaomiao Notes" and the cat icon are not covered by the
open-source grant.
