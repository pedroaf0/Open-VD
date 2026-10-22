# WordPress Plugin with React Frontend: Architecture Reference

## Overview

This document describes an architectural pattern for building a WordPress plugin that serves as the integration layer between a **PHP backend** and a **React frontend** compiled into static assets. The plugin owns a custom route, renders a minimal HTML shell, injects configuration into the browser, and loads a single IIFE JavaScript bundle. The React application communicates with WordPress exclusively through a custom REST API authenticated via WP REST nonces.

This pattern is suitable for applications that need:
- Full viewport ownership within WordPress (no theme interference)
- Server-side configuration passed securely to the client
- Standard WordPress authentication and permissions
- A production build that requires no Node.js runtime

---

## 1. WordPress Plugin Structure

### Directory Layout
```
wordpress-plugin/
└── my-plugin/
    ├── my-plugin.php              # Main plugin file (bootstrap)
    ├── includes/
    │   ├── class-my-plugin-page.php    # Route handler, HTML rendering
    │   ├── class-my-plugin-rest.php    # REST API endpoints
    │   ├── class-my-plugin-storage.php # Data persistence
    │   └── class-my-plugin-admin.php   # Admin settings UI
    ├── assets/
    │   ├── my-plugin.js           # Compiled React bundle (IIFE)
    │   └── my-plugin.css          # Compiled styles
    ├── icon/                      # PWA icons, favicons
    └── languages/                 # Translation files
```

### Bootstrap (`my-plugin.php`)
- Defines constants: version, file path, directory URL, custom post type slug.
- Includes PHP classes for page, REST, storage, admin.
- Registers activation/deactivation hooks (rewrite flush, DB tables, cron).
- Registers custom post type for application data (private, no UI).
- Instantiates main classes: `My_Plugin_Page`, `My_Plugin_REST`, `My_Plugin_Admin`.

### Custom Route Registration
- Uses `add_rewrite_rule` to map pretty URLs to query variables:
  - `/my-plugin/` → `index.php?my_plugin_app=1`
  - `/my-plugin/<key>/` → `index.php?my_plugin_app=1&my_plugin_key=<key>`
- Registers query vars: `my_plugin_app`, `my_plugin_key`, plus manifest/SW vars.
- Handles legacy URL redirects for backward compatibility.

### Page Rendering (`class-my-plugin-page.php`)
- Hooks `template_redirect` at priority 5.
- `maybe_render()` checks for the app query var.
- Builds configuration object from WordPress state (user, settings, capabilities).
- Injects configuration into `window` global.
- Enqueues stylesheets and scripts via `wp_enqueue_style/script`.
- Outputs complete HTML document (`<html>`, `<head>`, `<body>`) with root `<div>`.
- Calls `exit` to prevent theme template loading.

---

## 2. React Integration

### Standalone Entry Point (`src/embed.tsx`)
- **Single file**, no router, no SSR, no framework runtime beyond React DOM.
- Responsibilities:
  1. Wait for `DOMContentLoaded`.
  2. Find root element by ID (e.g., `#my-plugin-root`).
  3. Guard against double-mount with `data-mounted` attribute.
  4. Initialize any client-side setup (i18n, feature flags).
  5. Mount root React component via `createRoot(root).render(<App />)`.

### Root Element
- Printed by PHP in `maybe_render()`: `<div id="my-plugin-root" class="my-plugin-root"></div>`.
- CSS ensures full viewport: `min-height: 100vh; min-height: 100dvh;`.

---

## 3. Communication: WordPress → React (Configuration Injection)

### Configuration Object
PHP builds a plain PHP array with all data the frontend needs:

```php
$config = [
    'restUrl'       => rest_url('my-plugin/v1'),
    'nonce'         => wp_create_nonce('wp_rest'),
    'canUpload'     => is_user_logged_in(),
    'sceneKey'      => $keyFromQueryVar ?? null,
    'homeUrl'       => home_url('/'),
    'viewerUrl'     => self::url(),
    'shareTemplate' => self::url('placeholder') . 'with_placeholder',
    'brand'         => [ 'name' => '', 'logo' => '' ],
    'loginUrl'      => wp_login_url(self::url($key)),
    'uploadLimit'   => calculate_upload_limit(),
    'downloadUrl'   => plugin_dir_url(__FILE__) . 'includes/download.php',
    'featureFlags'  => [ ... ],
    // ... additional settings
];
```

### Injection Mechanism
1. PHP prints an inline `<script>` **before** the bundle script:
   ```html
   <script>window.MY_PLUGIN = { ...config... };</script>
   ```
2. React reads synchronously via `window.MY_PLUGIN` in a config module (`src/lib/wp.ts`).
3. A React hook (`useWpConfig`) exposes the config reactively to components.

### Data Categories
| Category | Examples |
|----------|----------|
| API Access | `restUrl`, `nonce` |
| Permissions | `canUpload`, `canEdit`, `isAdmin` |
| Context | `sceneKey`, `viewerUrl`, `shareTemplate` |
| Branding | `name`, `logo`, `colors` |
| Limits | `uploadLimit`, `quota` |
| Feature Flags | `enableFeatureX`, `enableFeatureY` |
| External Services | `proxyUrl`, `webhookUrl` |

---

## 4. Communication: React → WordPress (REST API)

### REST Namespace
- Registered under `my-plugin/v1` via `register_rest_route`.
- All endpoints under this namespace.

### Endpoint Categories
| Category | Endpoints | Auth |
|----------|-----------|------|
| Resource CRUD | `POST /items`, `GET /items/<key>`, `DELETE /items/<key>` | Owner |
| File Upload | `POST /items/<key>/files`, `POST /uploads/<token>/files` | Owner / Session |
| Settings | `POST /items/<key>/settings` | Owner |
| User Panel | `GET /me`, `GET /me/recent` | Logged in |
| Async Operations | `POST /items/<key>/run`, `GET /items/<key>/status` | Owner + credits |
| Admin | `GET /download/<key>/zip` | API Key |

### Authentication Methods
1. **Standard (User)**: `X-WP-Nonce` header + `credentials: 'same-origin'` (cookies).
   - Nonce generated in PHP config, passed to React via `window.MY_PLUGIN.nonce`.
2. **Admin API Key**: `?apikey=<key>` query param, verified with `hash_equals()`.
   - Used for server-to-server callbacks and privileged operations.
3. **Upload Sessions**: Transient `my_plugin_up_<token>` → user ID (TTL 24h).
   - Enables chunked uploads for large files without keeping request alive.

### React API Client (`src/lib/wp.ts`)
- Centralized fetch wrapper adding nonce header and `credentials: 'same-origin'`.
- Error handling with localized messages.
- Typed helper functions for each endpoint:
  ```ts
  fetchItem(key), createItem(data), uploadFile(key, file),
  saveSettings(key, settings), deleteItem(key),
  fetchUserPanel(), runOperation(key, params), ...
  ```

---

## 5. PHP Backend Integration

### Data Persistence (`class-my-plugin-storage.php`)
- Custom post type stores primary records (scenes, projects, etc.).
- Post meta holds: settings JSON, file lists, annotations, segmentation status.
- Upload directory structure: `wp-content/uploads/my-plugin/<key>/`.
- User quotas and credits stored in user meta.
- Optional custom DB tables for high-volume data (e.g., authorized URLs).

### Business Logic in REST Callbacks
- Permission checks: `current_user_can()`, ownership verification.
- Quota enforcement before write operations.
- File handling: sanitization, type detection, chunk assembly.
- External service integration (e.g., segmentation via RunPod) via `wp_remote_post`.
- Callback endpoints for async operations (no auth, verified by source IP or secret).

### Admin Integration (`class-my-plugin-admin.php`)
- Settings page under WordPress admin.
- Registers settings fields via `register_setting`.
- Renders UI for: feature flags, external service credentials, branding, limits.
- Values retrieved via `get_option()` and passed to frontend config.

---

## 6. Static Build Configuration

### Vite Config for Plugin (`vite.embed.config.ts`)
```ts
export default defineConfig({
  publicDir: false,                    // No public/ copy
  plugins: [react(), tailwindcss(), ...],
  build: {
    outDir: 'wordpress-plugin/my-plugin/assets',
    emptyOutDir: true,
    cssCodeSplit: false,               // Single CSS file
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: 'src/embed.tsx',          // Standalone entry
      output: {
        format: 'iife',                // Global execution
        entryFileNames: 'my-plugin.js',
        assetFileNames: 'my-plugin.[ext]',
        inlineDynamicImports: true     // No code splitting
      }
    }
  }
});
```

### Key Settings Explained
| Setting | Purpose |
|---------|---------|
| `format: 'iife'` | Bundle executes immediately; no module loader needed. |
| `inlineDynamicImports: true` | All code in one file; single `<script>` enqueue. |
| `cssCodeSplit: false` | Single CSS file; single `wp_enqueue_style`. |
| `publicDir: false` | Icons, manifest served by PHP, not copied to build. |
| `outDir` | Directly writes to plugin's `assets/` directory. |

### Optional: Obfuscation
- `javascript-obfuscator` plugin in `generateBundle` hook.
- Controlled by flag; disabled for development.

### Build Script (`scripts/build-plugin.js`)
1. Runs `vite build --config vite.embed.config.ts`.
2. Normalizes line endings, strips BOM.
3. Increments version in main PHP file and `readme.txt`.
4. Validates gettext translator comments.
5. Creates installable ZIP via `fflate`.
6. Optionally copies to local test environment.

### Asset Loading in PHP
```php
$css = MY_PLUGIN_URL . 'assets/my-plugin.css';
$js  = MY_PLUGIN_URL . 'assets/my-plugin.js';

wp_register_style('my-plugin-app', $css, [], MY_PLUGIN_VERSION);
wp_enqueue_style('my-plugin-app');

wp_register_script('my-plugin-app', $js, [], MY_PLUGIN_VERSION, true); // in_footer
wp_enqueue_script('my-plugin-app');
```
- `MY_PLUGIN_URL = plugin_dir_url(__FILE__)`.
- Version constant = cache busting via `?ver=X.Y.Z`.
- Production: static files served by web server (no dev server).

---

## 7. Execution Flow

```
1. Browser Request
   └─ GET /my-plugin/abc123/

2. WordPress Rewrite
   └─ ^my-plugin/([a-z0-9]+)/?$ → index.php?my_plugin_app=1&my_plugin_key=abc123

3. PHP: template_redirect (priority 5)
   └─ My_Plugin_Page::maybe_render()
       ├─ Detect my_plugin_app query var
       ├─ Extract key = "abc123"
       ├─ Build $config array (REST URL, nonce, permissions, context, settings...)
       ├─ Inject window.MY_PLUGIN = $config via inline <script>
       ├─ Enqueue: fonts, my-plugin.css, inline CSS, my-plugin.js (defer)
       ├─ Output HTML with <div id="my-plugin-root">
       └─ exit

4. Browser Loads HTML
   ├─ CSS (blocking)
   ├─ Inline config script (synchronous)
   ├─ my-plugin.js (defer)
   └─ DOMContentLoaded

5. my-plugin.js Executes (IIFE)
   ├─ createRoot('#my-plugin-root')
   ├─ Reads window.MY_PLUGIN → config module
   ├─ Mounts <App />
   │   ├─ Determines current key from URL or config
   │   └─ Fetches initial data via REST (GET /items/abc123)
   └─ Application Interactive

6. User Actions → REST Calls
   ├─ Upload → POST /items/<key>/files (FormData, nonce)
   ├─ Save → POST /items/<key>/settings (JSON, nonce)
   ├─ Create → POST /items → upload → save settings
   └─ Async Ops → POST /items/<key>/run → callback → status poll
```

---

## 8. Component Responsibilities Summary

| Component | File | Responsibility |
|-----------|------|----------------|
| Plugin Bootstrap | `my-plugin.php` | Constants, includes, hooks, CPT registration |
| Route & HTML | `class-my-plugin-page.php` | Rewrite rules, config build, injection, HTML output, asset enqueue |
| REST API | `class-my-plugin-rest.php` | Endpoint registration, permission callbacks, business logic |
| Data Layer | `class-my-plugin-storage.php` | CRUD, file storage, quotas, user meta, custom tables |
| Admin UI | `class-my-plugin-admin.php` | Settings page, option registration |
| React Entry | `src/embed.tsx` | DOM mount, root element, app bootstrap |
| Config Bridge | `src/lib/wp.ts` | `window.MY_PLUGIN` access, decryption (if used), React hook, typed fetch helpers |
| Build Config | `vite.embed.config.ts` | IIFE output, single file, plugin assets directory |
| Build Script | `scripts/build-plugin.js` | Vite run, normalization, version bump, validation, ZIP creation |

---

## 9. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Plugin owns route via `template_redirect` | Full HTML control; no theme interference; clean separation. |
| Standalone React entry (`embed.tsx`) | Minimal bundle; no router/SSR overhead; deterministic init. |
| Config via `window` global | Synchronous, available before React mounts; no async bootstrap race. |
| IIFE bundle + `inlineDynamicImports` | Single file load; standard WP script enqueue; no module polyfills. |
| WP REST nonces + cookies | Native auth; no token storage; CSRF protection built-in. |
| Admin API key for callbacks | Server-to-server without user session; constant-time verification. |
| Upload sessions via transients | Chunked uploads bound to user; auto-expiry; no custom tables. |
| CORS proxy endpoint | Bypasses cross-origin restrictions for external file sources. |
| PWA manifest/SW via PHP | Dynamic `start_url`, `scope`, icons, theme colors per install. |
| Isolated Vite config | Plugin build independent from main app dev/build config. |
| Version constant for assets | Automatic cache busting via WP's `?ver=` query string. |

---

## 10. Replication Checklist

- [ ] Create plugin skeleton with main file, includes, assets, languages directories.
- [ ] Implement `class-MyPlugin_Page` with rewrite rules and `maybe_render()`.
- [ ] Build configuration array in PHP; inject via inline script before bundle.
- [ ] Create `src/embed.tsx` mounting React on a known root element ID.
- [ ] Configure `vite.embed.config.ts` for IIFE output to `plugin/assets/`.
- [ ] Implement REST endpoints under custom namespace with nonce auth.
- [ ] Write `src/lib/wp.ts` with config access, fetch wrapper, typed helpers.
- [ ] Add build script: Vite → normalize → version bump → validate → ZIP.
- [ ] Test full flow: route → PHP HTML → JS load → config read → REST fetch → UI interaction.

---

## 11. Common Pitfalls

1. **Nonce Expiration**: Nonces expire (default 24h). Handle 403/401 in React with page reload.
2. **Upload Limits**: PHP `uploadLimit` must match client-side validation; implement chunking for large files.
3. **CORS Proxy**: Proxy endpoint requires valid nonce; test with external sources (Drive, OneDrive).
4. **Asset Caching**: Version constant drives `?ver=`; ensure it increments on every build.
5. **Obfuscation**: Disable during development; complicates debugging.
6. **Double Mount**: Guard `embed.tsx` with `data-mounted` attribute.
7. **Hostname Mismatch**: If using client-side decryption, `location.hostname` must match `home_url()` host.
8. **Theme Conflict**: `exit` in `maybe_render()` is essential to prevent theme template inclusion.