/*
 * Markdown viewer for Sushi (GNOME Files' Space-bar preview).
 *
 * Renders like VS Code's Markdown preview by using the same libraries and
 * settings: markdown-it (HTML on, linkify without fuzzy links), highlight.js,
 * KaTeX through @vscode/markdown-it-katex, front matter, GitHub-style heading
 * ids and Mermaid diagrams. It adds GitHub's task lists, > [!NOTE] alerts and
 * footnotes, which VS Code leaves to extensions.
 *
 * Sushi loads extra viewers from ~/.local/share/sushi/viewers and install.sh
 * puts the libraries in ~/.local/share/sushi/markdown. Markdown becomes HTML
 * here, in Sushi's own JS engine; the WebView showing it never runs scripts
 * from the document. Only Mermaid runs in the page, as an injected user
 * script, because it needs a real DOM to lay out diagrams.
 */

const {Gdk, Gio, GLib, GObject} = imports.gi;

var WebKit2;
try {
    imports.gi.versions.WebKit2 = '4.1';
    WebKit2 = imports.gi.WebKit2;
} catch (e) {
}

const Renderer = imports.ui.renderer;

const LIB_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'sushi', 'markdown']);
const libPath = (...parts) => GLib.build_filenamev([LIB_DIR, ...parts]);

const MARKDOWN_IT_JS = libPath('markdown-it', 'dist', 'markdown-it.min.js');
const MARKDOWN_IT_KATEX_JS = libPath('markdown-it-katex', 'dist', 'index.js');
const MARKDOWN_IT_FOOTNOTE_JS = libPath('markdown-it-footnote', 'dist', 'markdown-it-footnote.min.js');
const HIGHLIGHT_JS = libPath('highlight.js', 'lib', 'index.js');
const HIGHLIGHT_CSS = libPath('highlight.js', 'styles', 'github-dark.css');
const KATEX_JS = libPath('katex', 'dist', 'katex.min.js');
const KATEX_CSS = libPath('katex', 'dist', 'katex.min.css');
const MERMAID_JS = libPath('mermaid', 'dist', 'mermaid.min.js');

const BACKGROUND = '#1e1e1e';

const PAGE_CSS = `
html { background: ${BACKGROUND}; color: #e6edf3; }
body {
  font: 16px/1.6 system-ui, sans-serif; max-width: 880px;
  margin: 0 auto; padding: 32px 40px 64px; overflow-wrap: break-word;
}
body > :first-child { margin-top: 0; }
h1, h2, h3, h4, h5, h6 { margin: 1.5em 0 0.6em; line-height: 1.25; font-weight: 600; }
h1, h2 { padding-bottom: 0.3em; border-bottom: 1px solid #3d444d; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
p, ul, ol, dl, table, blockquote, pre, details, .katex-block { margin: 0 0 1em; }
a { color: #4493f8; text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre { font-family: ui-monospace, "Ubuntu Mono", "DejaVu Sans Mono", monospace; font-size: 0.9em; }
:not(pre) > code { background: #2a2a2a; padding: 0.15em 0.4em; border-radius: 6px; }
pre { background: #2a2a2a; padding: 16px; border-radius: 8px; overflow-x: auto; line-height: 1.45; }
pre code.hljs { padding: 0; background: transparent; overflow: visible; }
blockquote { padding: 0 1em; color: #9198a1; border-left: 0.25em solid #3d444d; margin-left: 0; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid #3d444d; padding: 6px 13px; }
th { font-weight: 600; }
tr:nth-child(2n) { background: #252525; }
img { max-width: 100%; }
hr { border: 0; height: 1px; background: #3d444d; margin: 1.5em 0; }
.katex-block { overflow-x: auto; overflow-y: hidden; }
.katex-error { color: #f85149; }
.mermaid { display: block; text-align: center; margin: 0 0 1em; }
.mermaid-error { color: #f85149; text-align: left; white-space: pre-wrap; font-family: ui-monospace, monospace; }
.task-list-item { list-style: none; }
.task-list-item-checkbox { margin: 0 0.4em 0 -1.4em; vertical-align: middle; }
.footnotes { font-size: 0.875em; color: #9198a1; }
.front-matter td:first-child { font-weight: 600; }
.markdown-alert { color: inherit; }
.markdown-alert-title { font-weight: 600; margin-bottom: 0.25em; }
.markdown-alert-note { border-color: #4493f8; } .markdown-alert-note .markdown-alert-title { color: #4493f8; }
.markdown-alert-tip { border-color: #3fb950; } .markdown-alert-tip .markdown-alert-title { color: #3fb950; }
.markdown-alert-important { border-color: #ab7df8; } .markdown-alert-important .markdown-alert-title { color: #ab7df8; }
.markdown-alert-warning { border-color: #d29922; } .markdown-alert-warning .markdown-alert-title { color: #d29922; }
.markdown-alert-caution { border-color: #f85149; } .markdown-alert-caution .markdown-alert-title { color: #f85149; }
`;

// Content-Security-Policy for the page: no scripts, and only local or
// inline styles and fonts. Images may come from anywhere, as in VS Code.
const CSP = "default-src 'none'; img-src * data: file:; media-src * file:; " +
    "style-src 'unsafe-inline' file:; font-src file: data:";

// Runs in the page after it loads; mirrors how VS Code renders each diagram
// on its own, so one broken diagram shows an error and the rest still draw.
const RENDER_MERMAID = `
mermaid.initialize({
    startOnLoad: false, theme: 'dark', securityLevel: 'strict', suppressErrorRendering: true,
});
(async () => {
    let count = 0;
    for (const container of document.querySelectorAll('.mermaid')) {
        const source = container.textContent;
        const id = 'mermaid-diagram-' + count++;
        try {
            const { svg } = await mermaid.render(id, source);
            container.innerHTML = svg;
        } catch (e) {
            // Mermaid leaves its scratch element behind when a diagram fails.
            document.getElementById('d' + id)?.remove();
            container.classList.add('mermaid-error');
            container.textContent = 'Mermaid: ' + (e && e.message ? e.message : e) + '\\n\\n' + source;
        }
    }
})();`;

function _readText(path) {
    let [, bytes] = GLib.file_get_contents(path);
    return new TextDecoder().decode(bytes);
}

// A small CommonJS loader, enough for the libraries' CommonJS and UMD builds.
const _modules = new Map();
const _moduleAliases = new Map([['katex', KATEX_JS]]);

function _require(path) {
    path = Gio.File.new_for_path(path).get_path();
    let module = _modules.get(path);
    if (module)
        return module.exports;

    module = {exports: {}};
    _modules.set(path, module);
    let dir = GLib.path_get_dirname(path);
    let require = name => _require(_moduleAliases.get(name) ??
        GLib.build_filenamev([dir, name.endsWith('.js') ? name : `${name}.js`]));
    try {
        new Function('module', 'exports', 'require', _readText(path))(module, module.exports, require);
    } catch (e) {
        _modules.delete(path);
        throw e;
    }
    return module.exports;
}

// From VS Code's markdownEngine.ts.
function _normalizeHighlightLang(lang) {
    switch (lang?.toLowerCase()) {
    case 'shell':
        return 'sh';
    case 'py3':
        return 'python';
    case 'tsx':
    case 'typescriptreact':
        return 'jsx';
    case 'json5':
    case 'jsonc':
        return 'json';
    case 'c#':
    case 'csharp':
        return 'cs';
    default:
        return lang;
    }
}

// GitHub's heading slugs, as in VS Code's slugify.ts: keep letters, marks,
// numbers, connector punctuation, '-' and spaces; spaces become '-'.
function _slugify(heading) {
    return heading.trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
        .replace(/\s/g, '-');
}

function _tokenToPlainText(token) {
    if (token.children)
        return token.children.map(_tokenToPlainText).join('');
    return ['text', 'emoji', 'code_inline'].includes(token.type) ? token.content : '';
}

function _addNamedHeaders(md) {
    md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
        let slugs = env.slugs ??= new Map();
        let slug = _slugify(_tokenToPlainText(tokens[idx + 1]));
        if (slugs.has(slug)) {
            let count = slugs.get(slug) + 1;
            slugs.set(slug, count);
            slug = _slugify(`${slug}-${count}`);
        } else {
            slugs.set(slug, 0);
        }
        tokens[idx].attrSet('id', slug);
        return self.renderToken(tokens, idx, options);
    };
}

// Port of VS Code's yamlPreamble front matter rule. VS Code shows it as a
// table; simple "key: value" front matter gets one, anything else is shown
// as a YAML code block.
function _addFrontMatter(md, hljs) {
    md.block.ruler.before('fence', 'front_matter', (state, startLine, endLine, silent) => {
        if (startLine !== 0 || state.tShift[startLine] !== 0)
            return false;
        let lineText = line => state.src.slice(state.bMarks[line], state.eMarks[line]).replace(/\s+$/, '');
        if (lineText(startLine) !== '---')
            return false;

        let nextLine = startLine + 1;
        for (; nextLine < endLine; nextLine++) {
            if (state.tShift[nextLine] === 0 && lineText(nextLine) === '---')
                break;
        }
        if (nextLine >= endLine)
            return false;
        if (silent)
            return true;

        let token = state.push('front_matter', '', 0);
        token.block = true;
        token.map = [startLine, nextLine + 1];
        token.content = state.src.slice(state.bMarks[startLine + 1], state.bMarks[nextLine]).replace(/\n$/, '');
        state.line = nextLine + 1;
        return true;
    }, {alt: ['paragraph', 'reference', 'blockquote', 'list']});

    md.renderer.rules.front_matter = tokens => {
        let content = tokens[0].content;
        let lines = content.split('\n').filter(l => l.trim());
        let pairs = lines.map(l => /^([\w.-]+):[ \t]*(.*)$/.exec(l));
        if (pairs.length && pairs.every(Boolean)) {
            let rows = pairs.map(([, key, value]) =>
                `<tr><td>${md.utils.escapeHtml(key)}</td><td>${md.utils.escapeHtml(value)}</td></tr>`);
            return `<table class="front-matter"><tbody>${rows.join('')}</tbody></table>\n`;
        }
        let code = hljs.highlight(content, {language: 'yaml', ignoreIllegals: true}).value;
        return `<pre class="front-matter"><code class="hljs language-yaml">${code}</code></pre>\n`;
    };
}

// Port of VS Code's Mermaid support: ```mermaid fences and ::: mermaid blocks.
function _addMermaid(md) {
    let preProcess = source => source
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n+$/, '')
        .trimStart();

    let highlight = md.options.highlight;
    md.options.highlight = (code, lang, attrs) => {
        if (lang && /\bmermaid\b/i.test(lang))
            return `<pre class="mermaid">${preProcess(code)}</pre>`;
        return highlight(code, lang, attrs);
    };

    let markerChar = ':'.charCodeAt(0);
    let markerCount = (state, start, max) => {
        let pos = start;
        while (pos < max && state.src.charCodeAt(pos) === markerChar)
            pos++;
        return pos - start;
    };

    md.block.ruler.before('fence', 'mermaid_container', (state, startLine, endLine, silent) => {
        let start = state.bMarks[startLine] + state.tShift[startLine];
        let max = state.eMarks[startLine];
        if (state.src.charCodeAt(start) !== markerChar)
            return false;

        let count = markerCount(state, start, max);
        if (count < 3)
            return false;
        let markup = state.src.slice(start, start + count);
        let params = state.src.slice(start + count, max);
        if (params.trim().split(' ')[0].toLowerCase() !== 'mermaid')
            return false;
        if (silent)
            return true;

        let nextLine = startLine;
        let autoClosed = false;
        for (;;) {
            nextLine++;
            if (nextLine >= endLine)
                break;
            start = state.bMarks[nextLine] + state.tShift[nextLine];
            max = state.eMarks[nextLine];
            if (start < max && state.sCount[nextLine] < state.blkIndent)
                break;
            if (state.src.charCodeAt(start) !== markerChar)
                continue;
            if (state.sCount[nextLine] - state.blkIndent >= 4)
                continue;
            let closing = markerCount(state, start, max);
            if (closing < count)
                continue;
            if (state.skipSpaces(start + closing) < max)
                continue;
            autoClosed = true;
            break;
        }

        let token = state.push('mermaid_container', 'div', 1);
        token.markup = markup;
        token.block = true;
        token.info = params;
        token.map = [startLine, nextLine];
        token.content = state.getLines(startLine + 1, nextLine, state.blkIndent, true);
        state.line = nextLine + (autoClosed ? 1 : 0);
        return true;
    }, {alt: ['paragraph', 'reference', 'blockquote', 'list']});

    md.renderer.rules.mermaid_container = (tokens, idx) =>
        `<div class="mermaid">${preProcess(tokens[idx].content)}</div>`;
}

// GitHub task lists: "- [ ] item" and "- [x] item" get a disabled checkbox.
function _addTaskLists(md) {
    md.core.ruler.push('task_lists', state => {
        let tokens = state.tokens;
        for (let i = 2; i < tokens.length; i++) {
            if (tokens[i].type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' ||
                tokens[i - 2].type !== 'list_item_open')
                continue;
            let first = tokens[i].children[0];
            let match = first?.type === 'text' && /^\[([ xX])\](?:[ \t]+|$)/.exec(first.content);
            if (!match)
                continue;
            first.content = first.content.slice(match[0].length);
            let checkbox = new state.Token('html_inline', '', 0);
            checkbox.content = `<input type="checkbox" class="task-list-item-checkbox" disabled${match[1] === ' ' ? '' : ' checked'}> `;
            tokens[i].children.unshift(checkbox);
            tokens[i - 2].attrJoin('class', 'task-list-item');
        }
    });
}

// GitHub alerts: a blockquote whose first line is only [!NOTE], [!TIP],
// [!IMPORTANT], [!WARNING] or [!CAUTION].
function _addAlerts(md) {
    md.core.ruler.push('alerts', state => {
        let tokens = state.tokens;
        for (let i = 2; i < tokens.length; i++) {
            if (tokens[i].type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' ||
                tokens[i - 2].type !== 'blockquote_open')
                continue;
            let children = tokens[i].children;
            let match = children[0]?.type === 'text' &&
                /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i.exec(children[0].content);
            if (!match || (children.length > 1 && !['softbreak', 'hardbreak'].includes(children[1].type)))
                continue;
            children.splice(0, 2);
            let kind = match[1].toLowerCase();
            tokens[i - 2].attrJoin('class', `markdown-alert markdown-alert-${kind}`);
            let title = new state.Token('html_block', '', 0);
            title.content = `<p class="markdown-alert-title">${kind[0].toUpperCase()}${kind.slice(1)}</p>\n`;
            tokens.splice(i - 1, 0, title);
            i++;
        }
    });
}

let _engine = null;

// Builds markdown-it the way VS Code's MarkdownItEngine does.
function _getEngine() {
    if (_engine)
        return _engine;

    let markdownit = _require(MARKDOWN_IT_JS);
    let hljs = _require(HIGHLIGHT_JS);
    let katexPlugin = _require(MARKDOWN_IT_KATEX_JS).default;
    let footnotePlugin = _require(MARKDOWN_IT_FOOTNOTE_JS);

    let md = markdownit({
        html: true,
        breaks: false,
        linkify: true,
        typographer: false,
        highlight: (str, lang) => {
            lang = _normalizeHighlightLang(lang);
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(str, {language: lang, ignoreIllegals: true}).value;
                } catch (e) {
                }
            }
            return md.utils.escapeHtml(str);
        },
    });
    md.linkify.set({fuzzyLink: false});

    // VS Code's markdown-math extension; \def macros last for one document.
    let katexOptions = {enableFencedBlocks: true, globalGroup: true, macros: {}};
    md.core.ruler.push('reset-katex-macros', () => {
        katexOptions.macros = {};
    });
    md.use(katexPlugin, katexOptions);
    _addMermaid(md);
    md.use(footnotePlugin);
    _addFrontMatter(md, hljs);
    _addTaskLists(md);
    _addAlerts(md);

    let fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        tokens[idx].attrJoin('class', 'hljs');
        return fence(tokens, idx, options, env, self);
    };

    let validateLink = md.validateLink;
    md.validateLink = link => validateLink(link) || /^data:image\/.*?;/.test(link);

    _addNamedHeaders(md);

    _engine = {md, css: _readText(HIGHLIGHT_CSS)};
    return _engine;
}

function _renderPage(text) {
    let engine = _getEngine();
    let body = engine.md.render(text, {});
    let katexCss = body.includes('class="katex')
        ? `<link rel="stylesheet" href="${Gio.File.new_for_path(KATEX_CSS).get_uri()}">`
        : '';
    return '<!doctype html><html><head><meta charset="utf-8">' +
        `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
        `${katexCss}<style>${engine.css}${PAGE_CSS}</style></head>` +
        `<body>${body}</body></html>`;
}

function _toGLibError(e) {
    if (e instanceof GLib.Error)
        return e;
    return new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED, String(e));
}

var Klass = WebKit2 ? GObject.registerClass({
    Implements: [Renderer.Renderer],
    Properties: {
        fullscreen: GObject.ParamSpec.boolean('fullscreen', '', '',
                                              GObject.ParamFlags.READABLE,
                                              false),
        ready: GObject.ParamSpec.boolean('ready', '', '',
                                         GObject.ParamFlags.READABLE,
                                         false)
    },
}, class MarkdownRenderer extends WebKit2.WebView {
    get ready() {
        return !!this._ready;
    }

    get fullscreen() {
        return !!this._fullscreen;
    }

    _init(file) {
        // A context of our own, so the sandboxed web process may read the
        // KaTeX fonts and the images that sit next to the Markdown file.
        let context = new WebKit2.WebContext();
        context.set_sandbox_enabled(true);
        context.add_path_to_sandbox(LIB_DIR, true);
        let dir = file.get_parent()?.get_path();
        if (dir)
            context.add_path_to_sandbox(dir, true);

        super._init({
            web_context: context,
            settings: new WebKit2.Settings({enable_javascript_markup: false}),
        });

        let background = new Gdk.RGBA();
        background.parse(BACKGROUND);
        this.set_background_color(background);

        // Stay invisible until WebKit has painted, so the window never shows
        // the blank surface WebKit has before its first frame.
        this.set_opacity(0);

        this._file = file;
        this._cancellable = new Gio.Cancellable();
        this.connect('context-menu', () => true);
        this.connect('decide-policy', this._onDecidePolicy.bind(this));
        this.connect('load-changed', this._onLoadChanged.bind(this));
        this.connect_after('map', this._revealAfterPaint.bind(this));
        this.connect('destroy', () => {
            this._cancellable.cancel();
            if (this._revealTimeoutId)
                GLib.source_remove(this._revealTimeoutId);
        });
        this._file.load_contents_async(this._cancellable, this._onFileLoaded.bind(this));
    }

    _onLoadChanged(view, event) {
        // Sushi shows its window when we are ready, so wait for the page.
        if (event === WebKit2.LoadEvent.FINISHED && !this.ready)
            this.isReady();
    }

    _revealAfterPaint() {
        let reveal = () => {
            if (this._revealTimeoutId) {
                GLib.source_remove(this._revealTimeoutId);
                this._revealTimeoutId = 0;
            }
            this.set_opacity(1);
        };
        // Fallback in case the page never reports a frame.
        this._revealTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._revealTimeoutId = 0;
            reveal();
            return GLib.SOURCE_REMOVE;
        });
        this.call_async_javascript_function(
            'await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));',
            -1, null, null, null, this._cancellable,
            (view, result) => {
                try {
                    view.call_async_javascript_function_finish(result);
                } catch (e) {
                }
                reveal();
            });
    }

    _onFileLoaded(file, result) {
        try {
            let [, bytes] = file.load_contents_finish(result);
            let html = _renderPage(new TextDecoder().decode(bytes));
            if (html.includes('class="mermaid"')) {
                this.get_user_content_manager().add_script(WebKit2.UserScript.new(
                    `${_readText(MERMAID_JS)}\n${RENDER_MERMAID}`,
                    WebKit2.UserContentInjectedFrames.TOP_FRAME,
                    WebKit2.UserScriptInjectionTime.END,
                    null, null));
            }
            this.load_html(html, file.get_uri());
        } catch (e) {
            if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            logError(e, 'Markdown viewer');
            this.emit('error', _toGLibError(e));
        }
    }

    _onDecidePolicy(view, decision, type) {
        if (type !== WebKit2.PolicyDecisionType.NAVIGATION_ACTION &&
            type !== WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION)
            return false;

        let action = decision.get_navigation_action();
        if (action.get_navigation_type() !== WebKit2.NavigationType.LINK_CLICKED)
            return false;

        let uri = action.get_request().get_uri();
        let target = Gio.File.new_for_uri(uri.split('#')[0]);
        if (type === WebKit2.PolicyDecisionType.NAVIGATION_ACTION && target.equal(this._file))
            return false; // jump to a heading on this page

        decision.ignore();
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (e) {
            logError(e, `Failed to open ${uri}`);
        }
        return true;
    }

    get moveOnClick() {
        return false;
    }
}) : undefined;

var mimeTypes = [];
if (WebKit2)
    mimeTypes = [
        'text/markdown',
        'text/x-markdown',
    ];
