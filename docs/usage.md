# Browse and share files

An operator must first [install the server](../README.md#choose-an-installation) with trusted HTTPS and provision the single owner account. There is no signup, upload, file editor, multi-user account system or password-reset email.

## Owner: first share

1. Open the configured HTTPS origin and log in. Use a synthetic file for the first check, not confidential content.
2. Open folders by name; use breadcrumbs to go back. The filter matches the current directory, not a recursive search. **Name**, **Size** and **Modified** sort the complete listing; press again to reverse. Earlier sort choices break ties.
3. Choose **Share** beside a file/folder, or **Share folder** for the current directory. Check the displayed target: sharing the root grants access to the entire served tree.
4. Choose **Expires after**: 1 hour, 1 day, 7 days (initial default), 30 days or **Never**. Choose **Create link**, then **Copy link**. If copying fails, select and copy the displayed **Share link** manually.
5. Open that link in a private browser window without owner cookies. Confirm only intended content is available. A file share opens the file; a folder share opens a browser for that folder and descendants.
6. Return to the owner window, open **Shares**, choose **Revoke** on that link and confirm. Reload it in the recipient window: it must be unavailable. Check a new download or seek too; an already-running transfer may finish.
7. **Log out** when finished. Sessions expire after 12 hours; restarting the server logs out every owner session.

**Copy link beside a file is not the same as Share.** In the owner browser, it copies an owner-only file URL; recipients cannot use it without login. Use **Share → Create link** to grant access. In a shared folder, copying a child link carries the existing bearer scope; it does not create a new independently revocable share.

### API compatibility

The browser offers presets only. Existing API clients can still send integer `seconds` to `POST /api/shares`: 1–315360000 for a finite lifetime, or 0 for no expiry. Owner authentication and the existing Origin/header checks still apply. Existing shares and their expiry times are unchanged.

## Recipient links and revocation

No recipient account is needed. Anyone with the complete link can use or forward it. Keep links out of public chats, screenshots, analytics and support logs. Do not give recipients the owner's password.

Folder shares are live, not snapshots: future files, changed content and replacements at the same path are included. Renaming/removing a path can break links; putting content back at that path can make an unexpired, unrevoked link work again. A single-file share does not grant sibling access. To replace a link, revoke the old share and create a new one; changing the owner password does **not** revoke shares.

Expiry/revocation blocks new requests, including HEAD and range requests. Downloaded copies cannot be recalled. The same unavailable response covers missing, expired and revoked links; ask the sender rather than repeatedly trying credentials. Restoring an older server backup can bring revoked links back: see [safe recovery](operations.md#restore-without-surprising-recipients).

## Keyboard and large folders

Tab/Shift+Tab reaches links and actions, including offscreen rows. On a filename, Arrow Up/Down moves between entries; Home/End jumps to first/last. Opening a directory focuses its filter. Native buttons work with Enter/Space; dialogs have Close or Cancel buttons (the required login dialog cannot be canceled).

The list scrolls continuously and mounts only nearby rows plus a retained focus row. Use the directory filter rather than browser Find for names not mounted in the page. Filtering/sorting covers the whole listing, which still consumes browser memory. A 100,000-entry test is not a promise for every phone, browser or storage device.

## Themes

Choose **Choose theme** in the toolbar. Search names with ordinary text (case-insensitive, not regex); Tab to the native **Theme** list and use arrow keys or type-ahead. Choose **Apply** to save. Search and selection do not preview or change the current theme. If filtering removes the selection, choose a visible result before applying. No matches disables Apply. **Cancel** or Escape discards the draft and returns focus to the toolbar button.

Choices: Light, Dark, Catppuccin Latte/Frappe/Macchiato/Mocha, Nord, Atom One Dark/Light and Rose Pine/Moon/Dawn. These are representative UI adaptations from a pinned collection snapshot, not a popularity ranking or exact terminal renderings. Colors, secondary surfaces and status cues are adjusted for readability; upstream authors do not endorse this UI.

**Use system default** clears the saved preference and applies the current OS light/dark setting (dark if unavailable). The OS setting is read at page load and reset, not continuously. Explicit Light/Dark choices remain supported, including older saved preferences. Unknown or malformed preferences fall back safely. If browser storage is denied, changes work for the current page but may not persist; reset cannot erase storage the browser refuses to access.

Preferences stay in local storage for this origin and pathname: the owner page and each shared-folder link have separate settings; navigating subfolders within one link keeps its theme. Nothing is sent to the server or another site. Themes need no external network; file listings still require the server. A saved theme also colors the login dialog, but its required modal login must finish before the toolbar can be used. Browser/OS forced-color overrides remain enabled.

## Browsers, downloads and media

Use a current standards-capable browser with JavaScript, cookies, HTTPS, Fetch and native dialog support. Clipboard access may require permission; manual copy remains available. Narrow layouts and keyboard checks are not a screen-reader certification or a guarantee across Chromium, Firefox, WebKit and every mobile device.

The server supplies HTTP GET/HEAD and byte ranges, not a media player or transcoder. Browsers may play supported audio/video directly or download it; container format, codecs, subtitles and seeking behavior depend on the client. A `.mp4` suffix alone does not prove codec compatibility. If playback fails, download and try a trusted compatible local player. Treat downloaded files as untrusted; this server does not scan for malware.

External players must support HTTPS and the complete bearer URL, including escaped path characters; test a synthetic file, seeking and expiry with your player. No named-player certification, playlist conversion, codec conversion or DRM support is promised. Active HTML/SVG and unknown content download as attachments rather than executing within the file browser.
