# Browse and share files

Open the server's HTTPS address and log in with the owner account. Recipients open shared links without an account. Files are managed on the host; the browser does not upload or edit them.

## Browse files

Open folders by name and use breadcrumbs to go back. **Filter files** searches names in the current directory, not its descendants. By default, every space-separated text term must appear in the name, ignoring case.

Use the always-visible buttons inside the right edge of **Filter files** to change matching:

- **Aa** — case-sensitive matching, independently of the other buttons.
- **""** (**Match phrase**) — match the query as one literal substring, preserving whitespace; not a whole-word or whole-filename match.
- **`.*`** — use a regular expression, such as `^report.*\.pdf$`, without surrounding slashes or trailing flags. **Aa** controls case sensitivity.

These borderless buttons start off; enabled buttons are highlighted and underlined, and keyboard focus stays outlined. **""** and **`.*`** are mutually exclusive. Click an enabled button to turn it off. Invalid regular expressions show an error until corrected, cleared, or regex mode is turned off. The former `/regex/flags` shortcut is no longer recognized; use **`.*`** and remove the delimiters and flags.

If nothing matches, choose **Clear filter** to restore the list and return focus to the input. Matching modes stay selected. An empty folder shows **This folder is empty** instead. A compact count row below the controls shows totals or filtered/total items, above the sort headers. Count changes are announced to assistive technology.

Select **Name**, **Size**, or **Modified** to sort; select again to reverse. Earlier sort choices break ties. Filtering and sorting cover the complete directory, including rows outside the visible area. Use the file filter rather than browser Find for offscreen filenames.

## Share files and folders

1. Choose **Share** beside a file or folder, or **Share folder** for the current directory.
2. Choose **Expires after**: 1 hour, 1 day, 7 days (default), 30 days, or **Never**.
3. Choose **Create link**, then **Copy link**. If clipboard access fails, copy the displayed **Share link** manually.
4. Open the link in a private browser window to see what the recipient receives.

A file link grants access through its saved basename, without sibling browsing. A folder link includes its descendants, future additions, and replacements at the same paths. Paths are live references: trusted filesystem writers can retarget existing shares. Relative symlinks must stay within the applicable folder or file-parent boundary; see [filesystem boundaries](../SECURITY.md#filesystem-boundaries). Sharing the root includes the whole served tree; the dialog identifies this as **All files and folders** before you create the link.

The row copy button is labeled **Copy owner-only link** in the owner view. It copies an address that requires owner login; use the always-visible **Share** action to grant recipient access. In a shared folder, **Copy link** copies a child URL within the existing share; it does not create a separately revocable link.

## Manage shared links

Open **Shares** to copy or revoke a link. **Revoke** asks for confirmation, then prevents new requests through that link, including downloads and range requests. Transfers already underway may finish; downloaded copies remain with the recipient.

To replace a link, revoke it and create another. Renaming or removing content can break links; restoring content at the same path can make an active link work again. Changing the owner password does not revoke shares.

Owner sessions expire after 12 hours. **Log out** ends the current session; restarting the server ends every owner session but preserves shares.

## Open shared links

Anyone with a complete link can open or forward it. A file link opens the file; a folder link opens the file browser within that folder. An unavailable response can mean the link expired, was revoked, or its content moved. Contact the sender for a replacement.

Browsers may play supported media directly or download it. The server supports HTTP ranges but does not transcode media; playback and seeking depend on the client's codecs and format support. External players need HTTPS support and the complete shared URL. HTML, SVG, and unknown file types download as attachments.

Use a current browser with JavaScript and cookies enabled. Clipboard permission is optional because links can also be copied manually.

## Change appearance

In either the owner or shared-folder browser, choose the palette icon (**Choose theme**) in the controls below the path. Search or select a theme, then choose **Apply**. Search and selection do not change the current theme until applied. **Cancel** or Escape keeps the current choice. **Use system default** clears the saved preference and uses the OS light/dark setting.

Choose from Light, Nord, Catppuccin Mocha, Rose Pine, and Rose Pine Dawn. The system default is Light for a light OS setting, Nord otherwise; it is read at page load or reset.

An applied choice is saved for one year in a host-only, Secure, SameSite=Lax cookie with `Path=/`. It applies across owner and shared-folder pages on the same hostname and browser profile, not other hosts, subdomains, or profiles. Reload an already-open page to pick up another page's choice. **Use system default** clears this shared preference. Invalid or removed theme IDs fall back to the system default; if cookies are blocked, your choice may last only for the current page.

Older per-page theme preferences are not migrated; reselect your theme once. Sort preferences still use per-page browser storage.

## Keyboard controls

| Key | Action |
|---|---|
| Tab / Shift+Tab | Move through links and controls |
| Enter | Open a focused link or activate a button |
| Space | Activate a focused button |
| Arrow Up / Down on a filename | Move between entries |
| Home / End on a filename | Move to the first / last entry |
| Escape in an optional dialog | Close without applying draft changes |

Touch layouts use larger row and control targets; desktop layouts keep compact rows. Opening a folder focuses its filter. In the theme list, use arrow keys or type-ahead to select. The login dialog stays open until authentication succeeds.
