# Markdown Quick Look for GNOME

Press **Space** on a `.md` file in GNOME Files (Nautilus) and see it rendered, the same way Space already previews images, videos and PDFs.

It renders like VS Code's Markdown preview because it uses the same libraries, at the same versions and with the same settings:

- **Markdown** with tables, strikethrough, links, raw HTML and front matter (markdown-it)
- **Syntax highlighting** for 190+ languages (highlight.js)
- **LaTeX math**: `$inline$`, `$$display$$` and ```` ```math ```` blocks (KaTeX)
- **Mermaid diagrams**: ```` ```mermaid ```` and `::: mermaid` blocks
- **GitHub extras**: task lists `- [x]`, alerts `> [!NOTE]`, footnotes `[^1]`

The preview is read-only. To edit, click **Open With …** in the preview's title bar.

## Requirements

- Linux with GNOME Files (Nautilus) and its previewer, **Sushi**
- WebKitGTK 4.1 with its GObject bindings (already present on most GNOME desktops)
- `curl` and `openssl`, used once by the installer

Install anything that's missing:

| Distribution | Command |
|---|---|
| Ubuntu / Debian | `sudo apt install gnome-sushi gir1.2-webkit2-4.1 curl openssl` |
| Fedora | `sudo dnf install sushi webkit2gtk4.1 curl openssl` |
| Arch | `sudo pacman -S sushi webkit2gtk-4.1 curl openssl` |

Tested on Ubuntu 26.04 with Sushi 50 and WebKitGTK 2.52. The installer checks for these requirements and tells you exactly what's missing.

## Install

Get this folder (with `git clone` or by downloading and unzipping it), then run:

```bash
cd markdown-viewer
./install.sh
```

No `sudo` is needed. Everything is installed for your user only.

Then open Files, select a `.md` file and press **Space**.

## Use

| Action | How |
|---|---|
| Preview a Markdown file | Select it in Files and press **Space** |
| Close the preview | **Space** or **Esc** |
| Full screen | **F** or **F11** |
| Edit the file | Click **Open With …** in the title bar |
| Open a link | Click it; it opens in your browser |

The **Open With** button uses your default app for `.md` files. To make it open VS Code (or another editor), right-click any `.md` file → **Open With** → **Other Application**, pick the editor and set it as the default.

## Update or uninstall

- **Update:** get the latest version of this folder and run `./install.sh` again.
- **Uninstall:** `./install.sh --uninstall`. Space-bar previews of `.md` files go back to plain text.

## How it works

Sushi, the program behind the Space-bar preview, loads extra viewers from `~/.local/share/sushi/viewers/`. The installer adds two things there:

```
~/.local/share/sushi/
├── viewers/markdown.js   the viewer (this repository's sushi/markdown.js)
└── markdown/             the libraries below, about 12 MB
```

The viewer converts Markdown to HTML inside Sushi's own JavaScript engine (GJS), then displays it in a WebKit view. Only Mermaid runs inside the page, because it needs a real browser page to lay out diagrams.

The libraries are downloaded from the npm registry at the exact versions VS Code uses. Each download is checked against its published SHA-512 checksum; if any check fails, nothing is installed.

| Library | Version | Used for |
|---|---|---|
| markdown-it | 14.3.2 | Markdown parsing |
| highlight.js | 11.8.0 | Code highlighting |
| KaTeX | 0.16.21 | Math typesetting |
| @vscode/markdown-it-katex | 1.1.2 | Math syntax (VS Code's plugin) |
| markdown-it-footnote | 4.0.0 | Footnotes |
| Mermaid | 11.17.0 | Diagrams |

## Security

Previewing a file can't run code from it:

- Scripts in the document (`<script>`, `onerror=` and other event handlers, `javascript:` links) are removed before the page is displayed, and a Content-Security-Policy blocks scripts as a second layer.
- Mermaid runs with its `strict` security level, like VS Code.
- Links never navigate the preview; they open in your browser.
- Images load as they do in VS Code: local images by path, remote images from the web. Previewing a file that references a remote image therefore contacts that server, just as opening the file in VS Code would.

## Troubleshooting

**`.md` files still preview as plain text**

1. Run `./install.sh` again. It restarts the previewer so the change takes effect.
2. Check that your files are detected as Markdown:
   ```bash
   gio info -a standard::content-type yourfile.md
   ```
   The result should be `text/markdown` or `text/x-markdown`.
3. Look for errors in the previewer's log, then press Space on a `.md` file:
   ```bash
   journalctl --user -f | grep -i -E 'previewer|markdown'
   ```

**The preview shows an error**

The previewer's log (above) has the full message. Most often the libraries are missing or incomplete; running `./install.sh` again fixes that.

**A formula or diagram shows a red error message**

The math or diagram itself has a syntax error. The message shows what the parser rejected; VS Code shows the same error for the same input.

## Limitations

- **Dark theme only.** The preview window itself is always dark.
- **No Mermaid add-ons.** VS Code's optional Mermaid extras (ELK layout, icon packs, ZenUML) aren't included.
- **Local files only.** Files on network locations that have no local path can't be previewed as Markdown.
- **Depends on Sushi.** Sushi doesn't officially document this plugin folder, so a future Sushi version could change how it loads viewers.

## Credits

- Parts of `sushi/markdown.js` are adapted from [VS Code](https://github.com/microsoft/vscode)'s Markdown and Mermaid extensions (MIT License): the highlight-language aliases, heading slugs, the front-matter rule and the `::: mermaid` container rule.
- The installed libraries keep their own licenses, which are copied into `~/.local/share/sushi/markdown/<library>/LICENSE`: markdown-it, KaTeX, Mermaid, @vscode/markdown-it-katex and markdown-it-footnote (MIT), and highlight.js (BSD-3-Clause).
