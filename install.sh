#!/bin/bash
# Add rendered Markdown previews to GNOME Files' Space-bar preview (Sushi).
# Usage: ./install.sh            install for the current user
#        ./install.sh --uninstall
set -euo pipefail

SUSHI_DIR="$HOME/.local/share/sushi"
LIB_DIR="$SUSHI_DIR/markdown"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

# The libraries VS Code's Markdown preview uses, at the versions its
# package-lock.json pins, plus markdown-it-footnote. Each line: npm package,
# version, sha512 from the npm registry, and the paths to keep.
PACKAGES=(
    "markdown-it 14.3.2 sHHjZ5fJKlgrG4qns2YwVcdNep35h5fERrfkD2YNsb9UFk0UIHarbiTaHKVMlPuWAoiilyK8Fv/jAm11slsY7Q== dist LICENSE"
    "highlight.js 11.8.0 MedQhoqVdr0U6SSnWPzfiadUcDHfN/Wzq25AkXiQv9oiOO/sG0S7XkvpFIqWBl9Yq1UYyYOOVORs5UW2XlPyzg== lib styles LICENSE"
    "katex 0.16.21 XvqR7FgOHtWupfMiigNzmh+MgUVmDGU2kXZm899ZkPfcuoPuFxyHmXsgATDpFZDAXCI8tvinaVcDo8PIIJSo4A== dist LICENSE"
    "@vscode/markdown-it-katex 1.1.2 +4IIv5PgrmhKvW/3LpkpkGg257OViEhXkOOgCyj5KMsjsOfnRXkni8XAuuF9Ui5p3B8WnUovlDXAQNb8RJ/RaQ== dist LICENSE"
    "markdown-it-footnote 4.0.0 WYJ7urf+khJYl3DqofQpYfEYkZKbmXmwxQV8c8mO/hGIhgZ1wOe7R4HLFNwqx7TjILbnC98fuyeSsin19JdFcQ== dist LICENSE"
    "mermaid 11.17.0 Jo9N377Wb4MSnHFPTbLi2SxFpsQl4eVHoxnW5U1Md9EazvgMp3s+4ohDxr81YNTgbn5Kj7HJ3yslrSJ52kwpbA== dist/mermaid.min.js LICENSE"
)

restart_previewer() {
    # Sushi starts again on the next Space press and picks up the change.
    pkill -f '/usr/libexec/org.gnome.NautilusPreviewer' 2>/dev/null || true
}

remove_installed() {
    rm -rf "$LIB_DIR" "$SUSHI_DIR/assets"
    rm -f "$SUSHI_DIR/viewers/markdown.js" "$SUSHI_DIR/mdrender.py"
    rmdir "$SUSHI_DIR/viewers" "$SUSHI_DIR" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
    remove_installed
    restart_previewer
    echo "Removed. Space-bar previews of .md files are plain text again."
    exit 0
fi

missing=()
command -v sushi >/dev/null || missing+=(gnome-sushi)
gjs -c 'imports.gi.versions.WebKit2 = "4.1"; imports.gi.WebKit2;' 2>/dev/null || missing+=(gir1.2-webkit2-4.1)
command -v curl >/dev/null || missing+=(curl)
command -v openssl >/dev/null || missing+=(openssl)
if (( ${#missing[@]} )); then
    echo "Missing packages. Run this, then re-run ./install.sh:"
    echo "  sudo apt install ${missing[*]}"
    exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for entry in "${PACKAGES[@]}"; do
    read -r name version sha512 keep <<< "$entry"
    base="${name##*/}"
    echo "Downloading $name $version..."
    curl -fsSL "https://registry.npmjs.org/$name/-/$base-$version.tgz" -o "$tmp/$base.tgz"
    if [[ "$(openssl dgst -sha512 -binary "$tmp/$base.tgz" | base64 -w0)" != "$sha512" ]]; then
        echo "$name $version failed its checksum; nothing was installed."
        exit 1
    fi
    mkdir -p "$tmp/lib/$base"
    # shellcheck disable=SC2086  # $keep is a list of paths
    tar -xzf "$tmp/$base.tgz" -C "$tmp/lib/$base" --strip-components=1 $(printf 'package/%s ' $keep)
done

remove_installed
mkdir -p "$SUSHI_DIR/viewers"
mv "$tmp/lib" "$LIB_DIR"
install -m644 "$SRC_DIR/sushi/markdown.js" "$SUSHI_DIR/viewers/markdown.js"
restart_previewer

echo "Installed. Select a .md file in Files and press Space."
