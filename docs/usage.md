# Usage

## Download a post or Reel

Paste a public Instagram post, Reel or carousel link into **Explore** or **Download** and choose **Fetch**. The job appears in **Queue**.

## Browse an exact username

Enter `@username` or the public profile link in **Explore**. The first view loads the recent public embeds. Press **Load more** to append older items from Instagram's public timeline. The **Videos** tab filters the loaded items to individual videos. Use **All** for every loaded downloadable item in the tab, **Shown** for the current filter, or **Selected** for items you marked. The **Avatar** button saves the profile picture when available.

The timeline shows the pages Instagram makes available to logged-out visitors. A post marked **Unavailable** does not provide a downloadable public embed. Private content, Stories, Highlights and follower lists require other access.

## Download the public timeline

In **Explore**, enter a public profile and press **Download all public posts**. The job follows the public timeline in page order and saves media under `Downloads/insta-dl/<username>/posts/` or your configured download folder. Existing files recorded in the Library are reused. Open **Queue** to see progress or cancel. Files already written remain in the Library if you cancel or Instagram stops serving pages.

## Library

New files are sorted inside their download folder. Photos go in `images/`, videos in `videos/`, and JSON sidecars in `metadata/`. The Library groups those files by post, including mixed-media carousels.

Downloads appear in your local Library. Choose **Scan library** to import existing media from the configured download folder.

### Search and filters

- Search matches owner username, Instagram shortcode and caption text.
- Media-kind filters cover posts, reels, stories and avatars.
- Availability separates files still on disk from entries marked **Missing**.
- The captured-date range uses local calendar dates.
- Sort by **Publication date** or **Import date**.

Photo and video previews load directly from the local archive. On macOS, allow the single folder-access request when Library first loads previews. If access is denied, previews stay as placeholders until you enable **insta-dl-gui** under **System Settings → Privacy & Security → Files and Folders** and press **Retry previews**. See [troubleshooting](troubleshooting.md#macos-keeps-asking-for-access-to-downloads-in-library-or-queue).

Open an item to inspect its metadata and files. **Open file** launches an available file with the system default app; **Show in folder** reveals it in the system file manager. These actions are disabled for missing files.

### Rescans and missing files

A successful rescan updates entries found at their existing archive paths. Catalog entries not seen during that completed scan are retained and marked **Missing**, not deleted. If a file reappears at the same path, another completed rescan marks it available again. A cancelled or failed scan does not complete the missing-file pass.

Library scans are read-only for the archive. They never move, rename, edit or delete downloaded media or JSON sidecars. Only the rebuildable catalog database is updated.

The database is `insta-dl-gui-local/catalog.sqlite3` inside your platform app-data directory:

| OS | Catalog directory |
|---|---|
| macOS | `~/Library/Application Support/insta-dl-gui-local/` |
| Windows | `%APPDATA%\insta-dl-gui-local\` |
| Linux | `$XDG_DATA_HOME/insta-dl-gui-local/` or `~/.local/share/insta-dl-gui-local/` |

Changing the download folder in **Settings** registers it as another Library root; existing roots and their history remain in the catalog. If registration fails after the setting is saved, Settings shows a warning with a link back to Library so you can fix the folder and scan again.

## Network proxy

In **Settings**, enter an HTTP, HTTPS, SOCKS5 or SOCKS5H proxy under **Network proxy** and choose **Apply proxy**. New Instagram page and media requests use that proxy. **Clear proxy** restores a direct connection.
