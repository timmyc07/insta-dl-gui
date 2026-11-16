# Installation

On Windows, run the **insta-dl-gui Local** installer and open the app from the Start menu.

To build the installer from source, install Node.js 22+, Rust, Microsoft C++ Build Tools and Edge WebView2, then run:

```powershell
npm ci
npm run tauri build -- --bundles nsis
```

The installer is generated in `src-tauri/target/release/bundle/nsis/`.
