# Browse and share files

Open the server's HTTPS address and log in with the owner account. Recipients open shared links without an account. Files are managed on the host; the browser does not upload or edit them.

## Browse files

Open folders by name and use breadcrumbs to go back. **Filter files** searches names in the current directory, not its descendants. By default, every space-separated text term must appear in the name, ignoring case.

Use the filter-bar buttons to change matching:

- **Aa** — case-sensitive matching, independently of the other buttons.
- **""** — match the query as one literal substring, preserving whitespace; not a whole-word or whole-filename match.
- **`.*`** — use a regular expression, such as `^report.*\.pdf$`, without surrounding slashes or trailing flags. **Aa** controls case sensitivity.

All buttons start off; enabled buttons are highlighted. **""** and **`.*`** are mutually exclusive. Click an enabled button to turn it off. Invalid regular expressions show an error until corrected, cleared, or regex mode is turned off. The former `/regex/flags` shortcut is no longer recognized; use **`.*`** and remove the delimiters and flags.

Select **Name**, **Size**, or **Modified** to sort; select again to reverse. Earlier sort choices break ties. Filtering and sorting cover the complete directory, including rows outside the visible area. Use the file filter rather than browser Find for offscreen filenames.

## Share files and folders

1. Choose **Share** beside a file or folder, or **Share folder** for the current directory.
2. Choose **Expires after**: 1 hour, 1 day, 7 days (default), 30 days, or **Never**.
3. Choose **Create link**, then **Copy link**. If clipboard access fails, copy the displayed **Share link** manually.
4. Open the link in a private browser window to see what the recipient receives.

A file link grants access to that file. A folder link includes its descendants, future additions, and replacements at the same paths. Sharing the root includes the whole served tree.

**Copy link** beside a file has a different purpose: in the owner view, it copies an owner-only URL. Use **Share** to grant recipient access. In a shared folder, **Copy link** copies a child URL within the existing share; it does not create a separately revocable link.

## Manage shared links

Open **Shares** to copy or revoke a link. **Revoke** asks for confirmation, then prevents new requests through that link, including downloads and range requests. Transfers already underway may finish; downloaded copies remain with the recipient.

To replace a link, revoke it and create another. Renaming or removing content can break links; restoring content at the same path can make an active link work again. Changing the owner password does not revoke shares.

Owner sessions expire after 12 hours. **Log out** ends the current session; restarting the server ends every owner session but preserves shares.

## Open shared links

Anyone with a complete link can open or forward it. A file link opens the file; a folder link opens the file browser within that folder. An unavailable response can mean the link expired, was revoked, or its content moved. Contact the sender for a replacement.

Browsers may play supported media directly or download it. The server supports HTTP ranges but does not transcode media; playback and seeking depend on the client's codecs and format support. External players need HTTPS support and the complete shared URL. HTML, SVG, and unknown file types download as attachments.

Use a current browser with JavaScript and cookies enabled. Clipboard permission is optional because links can also be copied manually.

## Change appearance

In either the owner or shared-folder browser, choose the palette icon (**Choose theme**) beside the item count, below the path. Search or select a theme, then choose **Apply**. Search and selection do not change the current theme until applied. **Cancel** or Escape keeps the current choice. **Use system default** clears the saved preference and uses the OS light/dark setting.

Themes include Light, Dark, Catppuccin Latte/Frappe/Macchiato/Mocha, Nord, Atom One Dark/Light, and Rose Pine/Moon/Dawn. Preferences are saved in this browser, separately for the owner page and each shared-folder link. The OS preference is read at page load or reset. If browser storage is unavailable, a change may last only for the current page.

## Keyboard controls

| Key | Action |
|---|---|
| Tab / Shift+Tab | Move through links and controls |
| Enter | Open a focused link or activate a button |
| Space | Activate a focused button |
| Arrow Up / Down on a filename | Move between entries |
| Home / End on a filename | Move to the first / last entry |
| Escape in an optional dialog | Close without applying draft changes |

Opening a folder focuses its filter. In the theme list, use arrow keys or type-ahead to select. The login dialog stays open until authentication succeeds.
