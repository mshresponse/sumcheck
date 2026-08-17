# Permission justifications

The dashboard's **Privacy** tab asks for one justification per permission in the
manifest, plus a single-purpose statement and a remote-code declaration. These
are written to be pasted verbatim.

---

## Single purpose

```
Sumcheck converts documents the user chooses — files, the current page, or a
selection — into Markdown, HTML, plain text or JSON, entirely on the user's own
device.
```

---

## Permissions in `manifest.json`

### `activeTab`

```
Required for "Convert this page" and "Convert selection". When the user invokes
Sumcheck on a tab — by clicking the toolbar button or a right-click menu entry —
activeTab grants temporary access to read that one page's content so it can be
converted. It grants nothing until the user acts, and nothing on any other tab.
Sumcheck does not use it to observe browsing.
```

### `scripting`

```
Used with activeTab to run a single function in the page the user asked to
convert. That function reads the page's HTML, or the current selection, and
returns it for conversion. It is injected only in response to a user action and
only into the tab the user acted on.
```

### `contextMenus`

```
Adds the four right-click entries that are the extension's main entry points:
convert this page, convert the selection, convert a linked file, and open
Sumcheck.
```

### `storage`

```
Two uses, both local. chrome.storage.local remembers the user's conversion
settings between sessions. chrome.storage.session briefly holds a captured page
so the converter tab can pick it up; those entries are removed after five
minutes. Nothing is synced to a Google account and nothing is transmitted.
```

### `optional_host_permissions` — `http://*/*`, `https://*/*`

```
Requested only for "Convert linked file with Sumcheck", and only for the single
origin of the link the user right-clicked, at the moment they use it. Sumcheck
needs to fetch that one file to convert it. These are optional permissions: they
are never granted at install time, the user is asked per site, and declining
simply cancels that one conversion.
```

**Not requested:** `host_permissions`, `tabs`, `downloads`, `cookies`,
`webRequest`, `management`, `<all_urls>`.

---

## Remote code

Dashboard answer: **"No, I am not using remote code."**

```
Sumcheck executes no remote code. Every dependency — the PDF engine, the OCR
engine and its language data, the word lists, and all conversion libraries — is
bundled inside the package. The extension makes no network requests at runtime.
```

This is enforced, not merely intended: `npm run check` fails the build on any
remote `<script src>`, and Manifest V3's CSP (`script-src 'self'
'wasm-unsafe-eval'`) blocks remotely hosted code at the platform level.
