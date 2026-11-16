# insta-dl-gui Local

A desktop Instagram downloader based on [insta-dl-gui](https://github.com/subzeroid/insta-dl-gui). It fetches public Instagram embeds and media directly from Instagram and saves them to your computer. Open the app and paste an Instagram link or an exact username. The app opens straight to Explore and requires no accounts or API keys.

- Paste a public post, Reel, or carousel link to download its exposed media.
- Search an exact username to browse recent posts, then press **Load more** for older posts available in Instagram's public timeline. Download all loaded items, a filtered view, selected items, or the avatar.
- Use **Download all public posts** for one Queue job that follows the public timeline automatically and saves each page as it goes.
- Use Queue to view or cancel downloads and Library to browse the local archive. Settings controls the download folder, metadata sidecars, and proxy.

Instagram controls which timeline pages and media it makes available to logged-out visitors. Stories, Highlights, follower lists and private content are outside this edition's scope.

## Windows build

With Node.js 22+, Rust, Microsoft C++ Build Tools, and Edge WebView2 installed, run:

```powershell
npm ci
npm run tauri build -- --bundles nsis
```

The installer is generated in `src-tauri/target/release/bundle/nsis/`. The local edition uses its own app configuration and database. The default download location is `Downloads/insta-dl`.

```sh
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

See the [usage guide](docs/usage.md) and [license](LICENSE).
