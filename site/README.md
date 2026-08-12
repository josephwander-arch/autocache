# site/ - autocache.ai

The landing page. One file: `index.html`.

Inline CSS, inline JS, an inline data-URI favicon. **No external requests of any
kind** - no CDN, no web fonts, no analytics, no image files. Nothing to build,
no hosted service. Native plugins are dependency-free; the optional local-host MCP
bridge keeps its official SDK dependencies isolated and locked.

```
site/
  index.html    the entire site
  README.md     this file
```

## Preview locally

Open the file directly:

```
# macOS
open index.html
# Linux
xdg-open index.html
# Windows (PowerShell)
Start-Process .\index.html
```

`file://` works because there are no fetches and no module scripts. If you would
rather serve it over HTTP (to test headers, or the clipboard API on a secure
origin):

```
# any static server will do, the site has no build step
python -m http.server 8080
npx serve .
```

The copy buttons use `navigator.clipboard` with a `document.execCommand('copy')`
fallback, so they work on `file://` and on plain `http://localhost` too.

## Deploy

Any static host. Publish the contents of this directory; `index.html` is the
document root. Pick one.

### GitHub Pages

Repository settings, Pages, source: **Deploy from a branch**, branch `main`,
folder `/site`. Add a `CNAME` file next to `index.html` containing `autocache.ai`,
then point DNS at GitHub Pages:

```
A     autocache.ai     185.199.108.153
A     autocache.ai     185.199.109.153
A     autocache.ai     185.199.110.153
A     autocache.ai     185.199.111.153
CNAME www              josephwander-arch.github.io
```

Enable **Enforce HTTPS** once the certificate is issued.

### Cloudflare Pages

Connect the repo. Build command: **none**. Build output directory: `site`.
Add `autocache.ai` as a custom domain in the Pages project.

### Netlify

Publish directory `site`, build command empty. Or drag the `site` folder onto the
Netlify drop target for a one-off deploy.

### Vercel

Import the repo, framework preset **Other**, root directory `site`, build command
empty, output directory `site`.

### Object storage (S3, R2, GCS, Azure Blob)

```
aws s3 sync ./site s3://autocache.ai --delete \
  --cache-control "public, max-age=300"
```

Set the bucket index document to `index.html` and front it with a CDN for TLS.

### Anywhere else

```
scp index.html user@host:/var/www/autocache.ai/index.html
```

## Recommended headers

The page needs nothing from anywhere, so lock it down:

```
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains
Cache-Control: public, max-age=300
```

`'unsafe-inline'` is required for style and script because both are inline by
design - that is what keeps the page free of third-party origins. If you prefer
hashes over `'unsafe-inline'`, compute the SHA-256 of the single `<style>` and
`<script>` bodies and pin them; they change only when this file changes.

## Editing rules

These are not stylistic preferences. They are constraints from `SPEC.md`.

1. **No external requests.** If a change would add a `<link>`, `<script src>`,
   `@import`, `url(http...)`, web font, embedded video, or beacon - do not make
   it. Inline the asset or drop the feature.
2. **No emoji anywhere in the file.** Verify before committing:
   ```
   node -e "const s=require('fs').readFileSync('site/index.html','utf8');const n=[...s].filter(c=>c.charCodeAt(0)>126);console.log(n.length?'NON-ASCII: '+JSON.stringify([...new Set(n)]):'ascii clean')"
   ```
   The file is currently 100% ASCII. Keep it that way; it also makes encoding
   irrelevant on every host.
3. **Honesty constraints hold in copy.** Do not claim prompt caching, do not
   claim it makes the model smarter, do not claim cross-machine sync in v1. Do
   not describe any paid-tier capability (extraction, retrieval, index,
   consolidation, context budgeting, learning, eval) as free or as coming soon
   to free.
4. **The free/paid line is fixed:** *Autocache remembers your work. Autonomous
   remembers your knowledge.* Free must read as genuinely complete for its job.
5. **Tone.** Engineer to engineer. No hype words, nothing "revolutionary", never
   "AI-powered". Claim only what the code does.
6. **Both color schemes.** Light and dark come from `prefers-color-scheme` on a
   single set of CSS variables at the top of the `<style>` block. Change colors
   there, then check both.
7. **No horizontal page scroll.** Wide content (the comparison table, the
   terminal block, code blocks) scrolls inside its own container. `body` keeps
   `overflow-x: hidden` as a backstop, but do not rely on it - test at 320px.

## Checks before publishing

- 320px wide: nothing scrolls the page sideways.
- Dark and light: force each with your browser's rendering settings.
- Install tabs: click all three, and arrow-key between them for keyboard users.
- Copy buttons: each returns "Copied".
- Offline: disconnect the network, hard reload. The page must be identical.
- Devtools Network panel: exactly one request, the document itself.

## Section order

Fixed by the spec. Do not reorder:

1. Hero - the one sentence and the resumed-session terminal block
2. The problem
3. How it works - capture, persist, restore
4. Free vs paid
5. Install - Claude Code / Codex / Grok
6. What it is not
7. Upgrade - Autonomous
8. Footer
