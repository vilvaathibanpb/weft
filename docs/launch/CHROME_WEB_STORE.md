# Chrome Web Store listing — Weft

Everything needed to submit (or update) the extension in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **New item**.

## Package

Zip the *contents* of `extension/` (manifest at the zip root):

```bash
cd extension && zip -qr ../dist/cws/weft-extension-cws.zip manifest.json src icons/*.png
```

## Store listing tab

**Description** (summary comes from the manifest):

```
Weft turns any website you're logged into into a local MCP server that your AI tools can use — Claude Code, Claude Desktop, Codex and Cursor. No API keys, no OAuth apps, no cloud.

How it works
1. Install the free Weft desktop app (macOS, Windows, Linux): https://vilvaathibanpb.github.io/weft/
2. Open a site you're logged into and click "Convert this site to MCP".
3. Use the site once. Weft watches the site's own API calls and maps each one into a tool.
4. Connect your AI client from the Weft app and ask in plain English.

Your AI calls the same API the website uses, through the session already in your browser.

Privacy
• Everything runs on your computer (127.0.0.1). No account, no servers, no telemetry.
• Only sites you explicitly convert are captured.
• The extension forwards only each API request's method, URL and status to the local app — never headers, bodies, cookie values or tokens.
• Anything other than a GET request needs explicit confirmation.

Free and open source (MIT): https://github.com/vilvaathibanpb/weft
Demo: https://youtu.be/nOrxH0BQnvU
```

- **Category:** Developer Tools
- **Language:** English
- **Store icon (128×128):** `extension/icons/icon128.png`
- **Screenshots (1280×800):** `dist/cws/screen-extension.png`, `screen-picker.png`, `screen-claude-answer.png`
- **Small promo tile (440×280):** `dist/cws/tile.png`
- **Official URL / Homepage:** https://vilvaathibanpb.github.io/weft/
- **Support URL:** https://github.com/vilvaathibanpb/weft/issues
- **YouTube video:** https://youtu.be/nOrxH0BQnvU

## Privacy practices tab

**Single purpose:**

```
Weft lets the user convert a website they are logged into into a local MCP server: it observes that site's API requests (method, URL, status) and sends them to the Weft desktop app on the same computer, and replays requests in the user's own tab when the user's AI client asks.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `debugger` | Observes the API requests of the one tab the user chose to convert (method, URL, status) so the local Weft app can map the site's API. Chrome shows its debugging banner while active. No other tabs are touched. |
| `cookies` | Reads the *names* of the converted site's cookies (never values) so the app can show the user how the site authenticates. |
| `scripting` | Lists localStorage/sessionStorage *keys* (values are never read) and runs the user's AI-requested calls inside the user's own tab so the existing session applies. |
| `tabs` | Reads the current tab's URL to show which site the user is about to convert, finds an open tab of a converted site to run requests in, and opens/focuses that site when the user needs to log in again. |
| `storage` | Keeps the pairing token for the local Weft app, remembers which tab is being captured, and holds the latest auth-header values (e.g. `Authorization`) of the converted site in `chrome.storage.session` (in memory, cleared when the browser closes) so the user's requests in that tab carry them. Values are never sent anywhere. |
| Host permissions (optional, requested per site) | Requested only for the site the user clicks "Convert" on, at that moment. |

**Remote code:** No, I am not using remote code.

**Data usage:** Tick **Authentication information** (auth-header values held in browser memory only), **Website content** and **Web history** (requests made by the converted site are
observed). All data stays on the user's device and is only sent to the Weft app on `127.0.0.1`.
Tick all three certifications: not sold to third parties; not used for unrelated purposes; not used
for creditworthiness/lending.

**Privacy policy URL:** https://vilvaathibanpb.github.io/weft/privacy.html

## Distribution tab

Free · Public · All regions.

## After approval

Replace the "listing is in review / Load unpacked" copy in `README.md`, `site/docs.html#extension`
and the landing page's **Get the Chrome extension** button with the store link.
