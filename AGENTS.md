# AGENTS.md — AI Coding & Deployment Agent Guide

This repository contains **Antigravity 对话上下文查看器 & Token 用量看板 (`antigravity-context-viewer`)** — a native-styled session context window progress bar, account-wide token usage counter & 7×52 activity heatmap, and attachment analyzer for **Google Antigravity Desktop (2.x)**.

This guide provides AI coding agents (Antigravity, Claude Code, OpenAI Codex, Cursor, etc.) with the complete architectural context, setup instructions, testing procedures, development workflows, and deployment commands required to work effectively on or with this codebase.

---

## 1. Project Overview & Architecture

### Key Technologies
- **Runtime**: Pure Node.js (>= 18.0.0), no third-party npm runtime dependencies.
- **Python Component**: Optional Python (>= 3.8) scanner (`src/attachment_scan.py`) for deep inspection of attachments (PDF, DOCX, XLSX, images). Gracefully degrades to native character heuristics when Python is unavailable.
- **Architecture**:
  - **In-place ASAR Injection**: Patches Antigravity's `resources/app.asar` with zero external modules via a pure Node.js ASAR packer/unpacker (`installer/asar-engine.js`).
  - **CDP Live Hot-Reload**: Injects UI scripts directly into the active renderer window over Chrome DevTools Protocol (`DevToolsActivePort`) via standard WebSocket, providing zero-downtime updates.
  - **Modular Shadow DOM Component**: Injected UI lives entirely inside a dedicated Shadow DOM root (`#ag-context-meter`), preventing any CSS or DOM collision with host Antigravity styles.

### Directory Structure
```
antigravity-context-viewer/
├── cli.js                  # CLI main entry point (install, live, status, check, restore)
├── install.bat / .sh       # Double-click one-step installation wrapper
├── uninstall.bat / .sh     # Double-click one-step uninstall wrapper
├── package.json            # Project manifest & npm scripts
├── README.md               # Main human-facing documentation (Simplified Chinese)
├── AGENTS.md               # This agent guideline
├── LICENSE                 # MIT License
├── dist/                   # Build artifacts (dist/meter-renderer.js, dist/release/)
├── src/                    # Injected runtime source code
│   ├── meter-core.js       # Context summarizer, tokenizer heuristics, speed calculations
│   ├── meter-collector.js  # Host database reader, attachment scanner coordinator, token history
│   ├── meter-main.js       # Electron main-process hooks & safe IPC bridge
│   ├── attachment_scan.py  # Deep attachment scanner (runs standalone or under child_process)
│   └── renderer/           # Modular frontend source components
│       ├── styles.css      # Isolated Shadow DOM styles & theme CSS variables
│       ├── template.html   # HTML skeleton, dual panel markup & color picker controls
│       ├── init.js         # Host detection, Shadow DOM mounting & state machine initialization
│       ├── colors.js       # 0-level theme following, HEX/RGB/HSL conversions & heatmap palette
│       ├── layout.js       # Host toolbar docking, WCO reservation, responsive folding
│       ├── panels.js       # Panel switching, drawer collapse & keyboard event handling
│       ├── heatmap.js      # First-use-date timeline, 52-week activity heatmap, cell tooltips
│       └── main.js         # EWMA speed smoothing, 3-sig-fig formatting & render loop
├── installer/              # Host installation, patching & injection engine
│   ├── install.js          # ASAR extraction, patch injection, integrity verification
│   ├── restore.js          # Clean rollback to pre-installation backup
│   ├── asar-engine.js      # Pure Node.js zero-dependency ASAR reader/writer
│   ├── live-host.js        # Local loopback CDP bridge server for live session scanning
│   ├── local-api.js        # Internal Language Server CSRF & RPC client
│   └── runtime-check.js    # Pre-flight environment & active window diagnostics
├── tests/                  # Automated test suites
│   ├── meter-core.test.js      # Core token logic & speed tests (node:test)
│   ├── meter-renderer.test.js  # Frontend rendering, layout & interaction tests (node:test)
│   └── attachment_scan_test.py # Python attachment scanning unit tests (unittest)
├── docs/                   # Multi-language documentation & release logs
│   ├── README.en.md        # English documentation
│   ├── README.ja.md        # Japanese documentation
│   ├── README.ko.md        # Korean documentation
│   ├── README.es.md        # Spanish documentation
│   └── RELEASE_NOTES.md    # Historical release notes
└── scripts/                # Build and packaging automation
    ├── build.js            # Zero-dependency frontend component assembler
    └── package-release.py  # Multi-platform release zip generator
```

---

## 2. Invariants & Rules for AI Agents

1. **Strict Zero-Dependency Rule**:
   - **Never run `npm install`** or introduce external dependencies into `package.json`.
   - All build, installation, test, and runtime code must run on standard Node.js APIs (`fs`, `path`, `crypto`, `http`, `os`, `child_process`).
2. **Self-Protection / No Kill Rule**:
   - When running inside an Antigravity agent session, **never terminate `Antigravity.exe`**.
   - `node cli.js install` and `node cli.js live` hot-inject code into running windows via CDP with zero downtime.
3. **Source vs. Dist Separation**:
   - **Never edit or commit `dist/meter-renderer.js` directly**.
   - Edit modular components in `src/renderer/*`. The build script `scripts/build.js` automatically compiles them to `dist/meter-renderer.js` before testing, installing, or packaging.
4. **Git Safety**:
   - Do not execute `git add`, `git commit`, or `git push` automatically without explicit user confirmation.
   - When deleting untracked files on Windows 11 PowerShell, prefer `trash` to move them to the Recycle Bin.

---

## 3. Development Workflow & Commands

### Build
Assembles modular files in `src/renderer/` into the standalone bundle `dist/meter-renderer.js`:
```bash
npm run build
# Or directly:
node scripts/build.js
```
*(Note: `npm test`, `node cli.js install`, and `node cli.js live` all trigger `build.js` automatically).*

### Running Tests
Execute all Node.js unit tests (uses Node's built-in `node:test` runner):
```bash
npm test
# Or run individual test suites:
node --test tests/meter-core.test.js
node --test tests/meter-renderer.test.js
```

Execute Python attachment scanner unit tests:
```bash
# With uv (recommended):
uv run python tests/attachment_scan_test.py

# Or standard python:
python tests/attachment_scan_test.py
```

### Packaging Releases
Builds standalone zip packages and `checksums.txt` for 6 cross-platform targets (`windows_amd64`, `windows_arm64`, `darwin_amd64`, `darwin_arm64`, `linux_amd64`, `linux_arm64`):
```bash
npm run package
# Or:
python scripts/package-release.py
```
Output files are placed in `dist/release/`.

---

## 4. One-Command Installation & Lifecycle Management

When a user asks to install, inspect, update, or uninstall this tool, execute the corresponding command from the repository root:

### Step 1: Verify Environment
```bash
node cli.js check
```
Verifies Node.js version (>=18), detects `app.asar` location, detects Python availability, and probes the CDP debugger port.

### Step 2: Install and Hot-Inject
```bash
node cli.js install
```
Optional custom path: `node cli.js install --path "<custom-path-to-app.asar>"`

**What `node cli.js install` does automatically:**
1. Auto-detects `app.asar` across Windows (`%LOCALAPPDATA%\Programs\antigravity\resources\app.asar`), macOS (`/Applications/Antigravity.app/Contents/Resources/app.asar`), and Linux.
2. Backs up the clean/current `app.asar` into `backups/` with a SHA-256 verification hash.
3. Automatically runs `scripts/build.js` to compile `src/renderer/*` into `dist/meter-renderer.js`.
4. Injects `meter-main.js`, `meter-core.js`, `dist/meter-renderer.js`, `meter-collector.js`, and `attachment_scan.py` into ASAR's `dist/` directory.
5. Adds minimal read-only hooks to `dist/utils.js` and `dist/preload.js`.
6. Repacks the ASAR archive and verifies SHA-256 integrity of all untouched original files.
7. Connects to active Antigravity windows via `DevToolsActivePort` (CDP WebSocket) and hot-reloads the badge and dashboard without restarting.

### Step 3: Check Active Status
```bash
node cli.js status
```
Returns a JSON summary verifying `"asarPatched": true`, `"active": true`, live window route, token metrics, and output speed.

### Other Operations
- **Live Injection (No disk write)**:
  ```bash
  node cli.js live
  ```
  Injects components into active memory via CDP without modifying `app.asar`.
- **Restore / Uninstall**:
  ```bash
  node cli.js restore
  ```
  Restores the original official `app.asar` from backup with checksum verification.

---

## 5. UI Customization & Multi-Language Translation

The default interface is in Simplified Chinese. If a user asks to translate or customize the UI (e.g., "Translate UI to English / Japanese / Korean / Spanish"):

1. Open [`src/renderer/template.html`](src/renderer/template.html).
2. Translate user-facing strings (labels, tooltips, tab titles, status tags).
   - **Do NOT modify** DOM element IDs (`badge`, `amount`, `panel`, `badge-tokens`, `speed-val`, etc.).
   - **Do NOT modify** CSS class names or `data-*` attributes.
3. If adjusting styles, modify [`src/renderer/styles.css`](src/renderer/styles.css).
4. Run `node cli.js install` to automatically recompile `dist/meter-renderer.js` and hot-reload the translated UI into Antigravity immediately.

---

## 6. Code Style & Contribution Guidelines

- **Module Format**: CommonJS (`require` / `module.exports`) across all tools and injected scripts to align natively with Electron's Node runtime.
- **Async Pattern**: Standard `async/await` with `try/catch`.
- **Numeric Precision**: All generation speed displays (`tok/s`) format to **3 significant figures** via `formatTps` (e.g., `181 tok/s`, `95.4 tok/s`, `50.0 tok/s`, `8.40 tok/s`).
- **Speed Smoothing**: Effective speed is calculated strictly via the weighted formula: `CurrentTurn * 0.6 + PreviousTurn * 0.4` (falling back to `CurrentTurn` for the initial turn). Hover tooltips show un-smoothed physical velocities.
- **Testing**: Whenever modifying frontend layout, tokenizer algorithms, or installation logic, add/update corresponding assertions in `tests/meter-renderer.test.js` or `tests/meter-core.test.js` and verify with `npm test`.
