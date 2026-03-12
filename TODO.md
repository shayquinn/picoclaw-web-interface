# TODO / Known Issues

These items need manual investigation and fixing. They were identified during
a code review but could not be safely automated without more context.

## 🔴 High Priority

- [ ] **edge-tts tool integration** — There are known issues adding edge-tts as a
      tool/skill. Needs investigation: is it a PATH issue on Windows, a skill
      definition format issue, or a Python dependency problem? Document the
      exact error and fix the skill definition or add edge-tts to the build script
      if it needs to be bundled.

- [ ] **Gateway startup on Windows** — The gateway has required significant tweaking
      to work on Windows. The exact fixes applied should be documented here and/or
      in CONFIGURATION.md so they can be reproduced. Check whether `gateway` args,
      working directory, or environment variables need to be set explicitly in
      `electron-main.js` `startGateway()`.

- [ ] **`web-interface/CONFIGURATION.md` is stale** — This file contains debug output
      from a specific session (e.g. hardcoded Node v25.6.0 version, a specific 401
      error log). It should be rewritten as a proper, version-agnostic setup guide
      for new users.

## 🟡 Medium Priority

- [ ] **`build-all.bat` / `build.sh` not tested end-to-end** — The build scripts added
      in this PR are based on code analysis. They should be run on a clean checkout
      and any errors fixed before being considered stable.

- [ ] **macOS binary name in `findBinary`** — The arm64 vs amd64 detection for macOS
      in `electron-main.js` `findBinary()` uses `process.arch`. Verify this returns
      `arm64` correctly on Apple Silicon and `x64` (not `amd64`) — the mapping
      `x64 → amd64` has been added but should be tested.

- [ ] **`package.json` `extraResources` binary paths** — The electron-builder config
      now expects binaries at `../build/picoclaw-windows-amd64.exe` etc. Verify
      these match the actual Makefile output names on each platform.

- [ ] **`workspace/skills/tmux`** — tmux is a Linux/macOS tool and will not work on
      Windows. This skill should either be conditionally disabled on Windows or
      replaced with a Windows-compatible terminal skill (e.g. using PowerShell/cmd).

## 🟢 Lower Priority

- [ ] **Electron version** — `package.json` specifies `electron: ^40.8.0`. This is a
      very recent major version. If you experience Electron-specific bugs, check the
      Electron 40 changelog and consider pinning to a specific version.

- [ ] **Make the repository private or add a proper README** — The repo is currently
      a public fork. Either make it private (may require detaching the fork first)
      or add a README that clarifies this is a customised fork with the web interface
      additions.

- [ ] **`CONFIGURATION.md` references `/api/gateway/start` and `/api/gateway/stop`**
      endpoints that do not exist in `api-server.js`. Either implement them or
      remove the references.
