# PROJECT_CONTEXT.md — v-dicom (Open-VD)

> Arquivo de contexto para reaproveitar em novos chats/agentes. Resume o que é o
> projeto, sua arquitetura, onde fica cada coisa e as convenções a seguir.
> Última atualização: revisão do repositório local.

---

## 1. Visão geral

**v-dicom** é um visualizador de exames **DICOM/CBCT odontológicos e radiológicos**
que roda no **navegador**. Decodifica DICOM (JPEG lossless, JPEG 2000, JPEG-LS, RLE
e nativo), monta o volume 3D, exibe cortes **axial/coronal/sagital**, faz
**reconstrução 3D**, carrega modelos **STL/PLY/OBJ**, permite **MPR oblíquo**,
**anotações** nos cortes, **segmentação automática por IA (cloud/RunPod)** e
**compartilhamento** por link público ou por e-mail.

Dois modos de uso:
- **Servidor oficial** (free): https://v-dicom.online-web.app.br/
- **Servidor próprio**: plugin WordPress `v-dicom` (PHP) — o app React é embutido
  numa página própria `/v-dicom/`.

- Licença: **GPL-2.0-or-later**
- Idiomas da UI: **pt-BR (padrão/fonte)**, `en`, `es`
- Versionamento do plugin: `1.67.0` em `wordpress-plugin/v-dicom/v-dicom.php`
  (o `README.md` está com badge `1.71.0`, possivelmente desatualizado).
- Repositório é um clone de `h-share-insight-3d-viewer` (pasta `Open-VD`), branch `main`.

---

## 2. Stack técnica

| Camada | Tecnologias |
| --- | --- |
| Front-end | React 19, TypeScript 5.8, Vite 8 |
| Roteamento/SSR | TanStack Router + TanStack Start (SSR), Nitro (`cloudflare-module` no build) |
| UI | Tailwind CSS 4 (lightningcss), Radix UI (dialog, dropdown-menu), shadcn (`new-york`), lucide-react, `tw-animate-css`, `motion` |
| Gráficos | Three.js 0.185 (+ `STLLoader`, `PLYLoader`, `OBJLoader`, `MTLLoader`, `OrbitControls`), `@dimforge/rapier3d-compat` (presente como dependência) |
| Imagem/DICOM | `dicom-parser`, `jpeg-js`, `jpeg-lossless-decoder-js`, `@cornerstonejs/codec-openjpeg` (JPEG2000), `@cornerstonejs/codec-charls` (JPEG-LS) |
| Arquivos | `fflate`, `@zip.js/zip.js` |
| i18n | `i18next` + `react-i18next` + `i18next-browser-languagedetector` |
| Extras | `react-qr-code`, `clsx`, `tailwind-merge` |
| Backend | WordPress (PHP 7.4+, WP 5.8+) — plugin próprio, sem dependência de tema |
| Build/tooling | `nitro` beta, `javascript-obfuscator` (bundle do plugin), `sharp` (ícones), `prettier`, `eslint` 9 flat config, `bun` (lockfile texto) |

Gerenciador implícito: **bun** (`bunfig.toml` com `saveTextLockfile` e guarda de
supply-chain de 24h). Há também `package-lock.json`.

---

## 3. Estrutura de diretórios

```
Open-VD/
├─ src/                         # App React (front-end)
│  ├─ routes/                   # Rotas TanStack (file-based)
│  │  ├─ __root.tsx             # Shell HTML, providers, i18n bootstrap, 404/erro
│  │  └─ index.tsx              # Rota "/" → <Viewer/> (meta/SEO em pt)
│  ├─ components/
│  │  ├─ Viewer.tsx             # ⭐ Componente central (~3.5k linhas): toda a lógica de UI
│  │  ├─ Volume3D.tsx           # Viewport 3D (Three.js): volume + meshes + planos
│  │  ├─ SliceView.tsx          # Viewport 2D de um plano (MPR, navegação, anotações)
│  │  ├─ ProfileView.tsx        # Dashboard do usuário logado (cenas, storage, créditos)
│  │  ├─ SceneDownloadModal.tsx # Modal de download de cena (zip)
│  │  ├─ MultiSeriesModal.tsx   # Seleção de série quando o estudo tem múltiplas
│  │  ├─ LoadingIcons.tsx, UploadIcon.tsx, LanguageSwitcher.tsx, DebugPanel.tsx
│  │  └─ ui/                    # Primitivas shadcn (dialog, dropdown-menu, input)
│  ├─ lib/                      # Regras de negócio / utilitários puros
│  │  ├─ dicom.ts               # Parse DICOM + decodificação + Volume + renderSlice
│  │  ├─ mpr.ts                 # Álgebra vetorial + planos de reslice (MPR oblíquo)
│  │  ├─ annotations.ts         # Tipos e desenho/PNG de anotações
│  │  ├─ zip.ts                 # Leitor ZIP em streaming (fflate/zip.js + CRC-32)
│  │  ├─ wp.ts                  # ⭐ Ponte com o WordPress (REST, uploads, cenas, RunPod)
│  │  ├─ meshVolume.ts          # Cálculo de volume de STL/PLY/OBJ (mm³/cm³)
│  │  ├─ pwa.ts                 # Service worker + prompt de instalação
│  │  ├─ debuglog.ts            # Buffer de console.* na tela (iOS)
│  │  ├─ format.ts, utils.ts
│  ├─ i18n/                     # i18next + locales/{pt-BR,en,es}/{common,lib,ui,viewer}.json
│  ├─ styles.css                # Design tokens Tailwind 4 (tema "sala de leitura")
│  ├─ embed.tsx                 # ⭐ Entry standalone usado pelo plugin WordPress
│  ├─ router.tsx, routeTree.gen.ts
│  └─ assets.d.ts, zipjs.d.ts
├─ scripts/
│  ├─ build-plugin.js           # Build do bundle do plugin + bump de versão + zip
│  ├─ generate-icons.js         # Gera ícones PWA/iOS (sharp)
│  └─ plugin-i18n.js            # Extrai strings do PHP → .pot/.po/.mo
├─ wordpress-plugin/v-dicom/    # Plugin WordPress (PHP)
│  ├─ v-dicom.php               # Bootstrap: CPT, ativação, hooks, constantes
│  ├─ includes/
│  │  ├─ class-v-dicom-page.php     # Rota /v-dicom/, manifest PWA, sw.js, config injetada
│  │  ├─ class-v-dicom-rest.php     # ⭐ REST API (todos os endpoints)
│  │  ├─ class-v-dicom-storage.php  # ⭐ Persistência: cenas, arquivos, quotas, RunPod
│  │  ├─ class-v-dicom-admin.php    # Tela admin (cenas, limites, tema, API key, segmentação)
│  │  ├─ class-v-dicom-theme.php    # White-label (nome, cores, logo, quiz)
│  │  └─ download.php               # Proxy de download (Google Drive/OneDrive)
│  ├─ assets/                   # v-dicom.js / v-dicom.css (GERADOS, gitignored)
│  ├─ icon/                     # Ícones PWA/iOS (gerados)
│  ├─ languages/                # .pot/.po/.mo (en_US, es_ES)
│  └─ readme.txt
├─ vite.config.ts               # Build principal (SSR/TanStack Start)
├─ vite.embed.config.ts         # Build do bundle do plugin (IIFE, ofuscação opcional)
├─ tsconfig.json, eslint.config.js, components.json, bunfig.toml
├─ README.md / README.pt.md / README.es.md
└─ v-dicom.zip                  # Instalável gerado (gitignored)
```

Diretórios gerados/ignorados: `.output`, `.nitro`, `.tanstack`, `.wrangler`,
`node_modules`, `wordpress-plugin/v-dicom/assets/*`, `*.zip`.

---

## 4. Arquitetura

### 4.1 Dois builds, um app

1. **App principal (SSR)** — `vite.config.ts` + TanStack Start + Nitro
   (`cloudflare-module`). Entrada `src/routes/index.tsx` → `Viewer`.
   Roda como site standalone (deploy Cloudflare via Nitro).
2. **Bundle do plugin (embed)** — `vite.embed.config.ts`, entrada `src/embed.tsx`,
   saída **IIFE única** `wordpress-plugin/v-dicom/assets/v-dicom.js` (+ `.css`).
   Monta o `<Viewer/>` em `<div id="v-dicom-root">`. Ofuscação com
   `javascript-obfuscator` é **opcional** (`ofuscationEnabled = false` por padrão).

### 4.2 Modo standalone vs. embutido no WordPress

O app detecta se está dentro do WordPress por **`window.V_DICOM`**:
- **Presente** → modo WordPress: REST base, nonce, chave da cena, marca, loja,
  limites de upload, tipos de segmentação, **permissão de carregamento direto de
  DICOM** (`directDicomEnabled`), locale, etc.
- **Ausente** → visualizador **puramente local** (processamento 100% no browser,
  sem upload). Arquivos nunca saem da máquina.

A config do WordPress é **injetada criptografada** (AES-256-CBC, chave derivada
do host) como `window.V_DICOM = { e:1, iv, d }`; o front descriptografa
(`decryptWindowConfig` em `src/lib/wp.ts`). O `locale` vai em claro em
`window.V_DICOM_LOCALE` para resolver idioma antes do primeiro render.

### 4.3 Fluxo de dados principal

1. **Abrir arquivos**: pasta DICOM, ZIP (`src/lib/zip.ts`), URL (Google
   Drive/OneDrive via proxy `download.php`) ou cena compartilhada (`?scene=KEY`).
2. **Agrupar séries** (`groupFilesBySeries`) → se múltiplas, `MultiSeriesModal`.
3. **Montar volume** (`buildVolumeFromFiles` em `src/lib/dicom.ts`): parseia cada
   arquivo, decodifica pixels conforme Transfer Syntax, ordena os cortes por
   `ImagePositionPatient`, gera `Volume` (`Int16Array` + espaçamentos + direções).
4. **Render 2D**: `renderSlice` (ortogonal simples) ou `renderPlane` (MPR com
   interpolação trilinear) → `ImageData`.
5. **Render 3D**: `Volume3D.tsx` (Three.js) com textura de volume + meshes + planos.
6. **Anotações**: sobre `SliceView`, salvas como metadados + PNG na cena.
7. **Compartilhar**: cria a cena no WordPress (`createScene`) **antes** dos
   uploads e envia os arquivos direto para ela (`uploadSceneFile` + link
   `/v-dicom/KEY/`).

### 4.4 MPR oblíquo — modelo mental (importante)

Definido em `src/lib/mpr.ts`:
- **O volume é FIXO**; apenas os **planos** se movem/rotacionam.
- Cada `PlaneState` guarda `origin` (mm no espaço do volume) + eixos `u`, `v` e a
  normal `n`.
- `planeGeometry` mantém **campo de visão fixo** (dims nativas do corte ortogonal),
  limitado a `MAX_DIM = 640`; girar só reamostra dentro da mesma janela.
- `renderPlane` reamostra sempre do volume original por **interpolação trilinear**.
- Helpers: `rotatePlane`, `rotateAllPlanes`, `rotateOtherPlanes`, `clampPlane`,
  `planesIntersection`, `crosshair`, `setPlaneIndex`, `movePlaneThrough`.

---

## 5. Camada `src/lib` — APIs principais

### `dicom.ts`
- `type Volume` — dimensões `nx,ny,nz`, espaçamentos `sx,sy,sz`, `data: Int16Array`,
  `min/max`, `windowCenter/Width`, metadados do paciente/estudo, `origin`,
  `rowDir/colDir/sliceDir`.
- `buildVolumeFromFiles(files, onProgress)` — núcleo do parse/decodificação.
- `groupFilesBySeries(files, onProgress)` → `DicomSeriesGroup[]`.
- `renderSlice(v, plane, index, center, width, invert)` → `ImageData` (ortogonal).
- `flipVolumeInPlace(v, axis)` + `VOLUME_AXES` / `type VolumeAxis` — correção
  manual de orientação: espelha os voxels do volume **in place** num eixo
  (`x`/`y`/`z`) quando o exame abre invertido (de cabeça para baixo / espelhado).
  Como os cortes MPR e o 3D derivam sempre do mesmo array, corrige os dois; aplicar
  o mesmo eixo duas vezes restaura o volume.
- `sliceCount`, `sliceDims`, `makeTextureVolume` (downsample p/ 3D).
- Transfer Syntaxes suportados: nativo, JPEG baseline/lossless, JPEG-LS, JPEG2000, RLE.
- Cuidado com `MONOCHROME1` (inverte), `signed`, `rescale slope/intercept`.

### `mpr.ts`
Álgebra de vetores/matrizes 3x3, `PlaneState`, `PlaneGeom`, `renderPlane`,
`volumeExtent/Center`, `defaultPlaneState(s)`, `isOblique`, `toPlane2D`/`fromPlane2D`,
`intersectionLine`, `crosshair`. `PLANES = ["axial","coronal","sagittal"]`.

### `wp.ts` (ponte WordPress — arquivo central)
- `wpConfig()` / `wpConfigAsync()` / `useWpConfig()` — lê e **descriptografa** a config.
- `currentSceneKey()` — chave via `?scene=` ou `/base/KEY/`.
- `shareUrl(key)` — monta link (`shareTemplate` com `ZZKEYZZ` ou `?scene=`).
- Cenas: `fetchScene`, `createScene`, `deleteScene`, `saveSceneSettings`,
  `downloadSceneFiles`, `fetchUserPanel`, `fetchRecentScenes`, `markSceneAccessed`.
- Upload: `uploadSceneFile` (com **chunks** `nome.NofMpart` quando passa do
  `uploadLimit` do PHP) — envia para uma cena **já existente**.
  - **Ordem de compartilhamento (importante)**: `publishScene` cria a cena
    primeiro (`createScene({ title, settings })`) e só depois sobe arquivos,
    PNGs de anotação e por fim `saveSceneSettings`. Assim todo arquivo enviado
    pertence a uma cena real e excluível; se um upload falhar/interromper, os
    arquivos ficam presos a uma cena que pode ser apagada — nunca órfãos no
    servidor (o endpoint de sessão `/uploads` do PHP permanece só para API
    externa via `apikey`).
- Segmentação: `runSegmentation`, `fetchSegmentationStatus`.
- URL externa: `fetchUrlFiles` (proxy + autorização), `authorizeUrl` (2 passos
  dry-run→confirma→consome crédito), `AuthorizeUrlError`.
- Anotações: `uploadAnnotationPng`.
- Tipos: `WpConfig`, `Scene`, `SceneFile`, `SceneSettings`, `SceneSummary`,
  `UserPanel`, `StorageInfo`, `StoragePlan`, `SegmentationType`.
  - `SceneSettings` inclui `flip?: {x,y,z}` (correção de orientação do volume).
- **iOS**: downloads são acumulados como `{name, data}` em memória e expandidos,
  evitando `File.arrayBuffer()` gigante (falha NotReadableError no WebKit).

### `zip.ts`
Parser ZIP em streaming (EOCD → Central Directory → entradas), ZIP64, com
`DecompressionStream('deflate-raw')` nativo → fallback `fflate` → fallback
`zip.js`, e **verificação CRC-32** para detectar falhas silenciosas (mobile).
`expandArchives(inputs, onProgress, {forceJs})`, `isZipBuffer`.

### `annotations.ts`
`Annotation` (kind `text|mark|measure|arrow|draw`, ligada a um plano + snapshot de
`PlaneState`), `Tool` (`ruler|arrow|mark|draw|text|select`), `measureLengthMm`,
`drawAnnotationInto`, `renderAnnotationPng`. Cores em `ANNOTATION_COLORS`.

### `meshVolume.ts`
`computeGeometryVolumeInfo` (volume assinado + teste de "watertight"),
`computeMeshFileVolume` (STL/PLY/OBJ, soma meshes de OBJ), `formatMeshVolume`.

### `pwa.ts`, `debuglog.ts`, `format.ts`
- SW: `/v-dicom/sw.js` no WP, `/sw.js` fora; `useInstallPrompt()`.
- `DEBUG_OVERLAY_ENABLED = false` (botão de debug removível em produção).
- `formatBytes`, `pctUsed`.

---

## 6. Componente central: `src/components/Viewer.tsx`

Concentra quase toda a lógica de UI (~3.5k linhas). Responsabilidades:
- Estado do volume/meshes, **window/level** (`wc`,`ww`), `invert`, `threshold`,
  `opacity`, `showVolume`, `showPlanes`.
- **Correção de orientação** (`volumeFlip` + `toggleFlip`/`resetFlip`): espelha o
  volume em X/Y/Z via `flipVolumeInPlace` (exame de cabeça para baixo); persistido
  em `settings.flip` e reaplicado ao carregar cena compartilhada.
- `planeStates` (os 3 planos MPR) e cursor/crosshair 3D.
- Abrir arquivos: drag-drop, `loadDicom`, `openByUrl`.
- Carregar cena compartilhada (`?scene=`) com progresso e painel/quiz de espera.
- Rotas internas leves: `"viewer" | "profile"` (dashboard).
- Compartilhar: criar/atualizar cena, modal de share, QR code.
- Anotações: modo, ferramenta, cor, ativas, linhas.
- Segmentação: dispara job, faz polling de status, modal de progresso.
- Responsividade via `useBreakpoint()` (mobile/tablet/desktop) e abas de plano no mobile.
- Helpers: `withRetry`, `runPool` (`UPLOAD_CONCURRENCY = 6`), serialização de planos,
  cores forçadas por nome de mesh (`FORCED_MESH_COLORS` — ex.: "mandibula").

Sub-componentes no mesmo arquivo: `QuizLoadingPanel`, `useBreakpoint`,
`Section`, `Range`. Componentes de viewport em arquivos próprios: `SliceView`,
`Volume3D`.

---

## 7. i18n

- `src/i18n/index.ts` — init do i18next; recursos montados de `locales/*/*.json`
  via `import.meta.glob` (eager). Cada arquivo vira um namespace top-level
  (`viewer.json` → chaves `viewer.*`).
- `src/i18n/languages.ts` — `DEFAULT_LANGUAGE = "pt-BR"`, `LANGUAGES`,
  `normalizeLanguage`, `htmlLang`, chave de storage `v-dicom.lang`.
- Resolução de idioma (cliente), em ordem: **1) escolha salva → 2) navegador →
  3) locale do WordPress (`V_DICOM_LOCALE`) → 4) pt-BR**.
- **SSR sempre renderiza pt-BR**; o idioma detectado é aplicado após a hidratação
  (em `__root.tsx` e em `embed.tsx` antes do primeiro render).
- Áreas por idioma: `common`, `lib`, `ui`, `viewer` (272 chaves em `viewer`).

---

## 8. Plugin WordPress (PHP)

### Bootstrap — `v-dicom.php`
- Constantes: `V_DICOM_VERSION`, `V_DICOM_DIR/URL/FILE`, `V_DICOM_CPT`
  (`v_dicom_scene`).
- CPT privado `v_dicom_scene` (cenas; `public=false`).
- Ativação: cria pasta de uploads, rewrite rules, tabela
  `{prefix}v_dicom_authorized_urls`, agenda cron `v_dicom_storage_expiry_check`.
- Qualquer usuário **logado** pode salvar cenas/upload (quota decide).
- Hooks: `new V_Dicom_REST()`, `new V_Dicom_Page()`, `new V_Dicom_Admin()`.
- `v_dicom_shop_url()` via filtro `v_dicom_shop_url` (plugin companheiro /
  WooCommerce) — o plugin base não conhece WooCommerce.

### Página — `class-v-dicom-page.php`
- Rota `/v-dicom/` e `/v-dicom/<key>/` (+ `manifest.webmanifest`, `sw.js`).
- **Não carrega o tema ativo** — renderiza o app em viewport cheio.
- Redireciona URLs legadas `visordicom` (301).
- Injeta `window.V_DICOM_LOCALE` (claro) e `window.V_DICOM` (**AES-256-CBC**,
  chave = `sha256(host)`), além de CSS vars do white-label e o script do bundle.
- `get_upload_limit()` = menor entre `upload_max_filesize`, `post_max_size`,
  `memory_limit` (menos 5 MB de margem) → alimenta o upload em chunks do front.
- Manifest PWA e service worker são gerados aqui.

### REST API — `class-v-dicom-rest.php` (`namespace v-dicom/v1`)

| Método | Rota | Permissão | Função |
| --- | --- | --- | --- |
| POST | `/uploads` | logado | Abre sessão de upload → `{token}` |
| POST | `/uploads/<key>/files` | logado **ou** apikey | Envia 1 arquivo (ou chunk) |
| POST | `/uploads/<key>/annotations` | logado | PNG de anotação |
| GET | `/download/<key>/zip` | **apikey** | Baixa a pasta como ZIP |
| GET | `/me` | logado | Painel do usuário (storage, créditos, cenas) |
| POST | `/scenes` | logado | Cria cena |
| GET | `/scenes/<key>` | **público** | Lê cena compartilhada |
| DELETE | `/scenes/<key>` | logado | Remove cena |
| POST | `/scenes/<key>/files` | logado | Upload em cena existente |
| POST | `/scenes/<key>/settings` | logado | Salva settings/anotações/título |
| POST | `/scenes/<key>/annotations` | logado | PNG em cena existente |
| POST | `/scenes/<key>/run` | dono/apikey | Dispara segmentação |
| GET/POST | `/scenes/<key>/segmentation-status` | dono/apikey | Status / callback RunPod |
| POST | `/scenes/<key>/access` | logado | Marca acesso recente |
| GET | `/me/recent-scenes` | logado | Cenas recentes |
| POST | `/authorized-url` | logado | Autoriza URL externa (consome 1 crédito) |

- `DEBUG_RUNPOD = false`; `api_key_is_valid()` libera rotas de admin com apikey.
- **Compartilhar (ordem)**: `POST /scenes` **sem** `token` cria a cena vazia com
  `title` + `settings`; os arquivos entram por `/scenes/<key>/files` (o
  `store_file` anexa o descritor a `_v_dicom_files`), os PNGs por
  `/scenes/<key>/annotations` e por fim `/scenes/<key>/settings`. O par
  `/uploads` + `POST /scenes` **com** `token` (sessão que vira cena) fica mantido
  para a **API externa via apikey**.
- `upload_scene_annotation()` (`/scenes/<key>/annotations`) espelha
  `upload_session_annotation()` e usa `scene_for_write()` + `store_annotation_png()`.
- Segmentação: valida dono + crédito, envia `POST {url}/run` ao RunPod com
  `download-url`, `upload-url`, `max-voxels`, `max-triangles`; guarda `job_id`;
  reembolsa crédito em falha; notifica conclusão.

### Storage — `class-v-dicom-storage.php`
- Base: `wp-content/uploads/v-dicom/<key>/` (bloqueia execução PHP e listagem).
- Extensões permitidas (`SAFE_EXT`): dcm, dicom, ima, img, stl, ply, obj, mtl, png,
  jpg, jpeg, nrrd, nii, gz, json, bin, zip.
- Cenas via CPT + meta (`_v_dicom_settings`, `_v_dicom_annotations`,
  `_v_dicom_segmentations`, keys de job RunPod, debug).
- **Quotas/planos**: `user_limit_mb`, `used_bytes`, `available_bytes`, `check_quota`,
  `add_user_plan`, `prune_expired_plans`, `enforce_quota`, `cron_prune_and_enforce`.
- Créditos: `user_credit`, `set_user_credit`, `OPTION_DEFAULT_CREDIT`.
- Segmentação multi-tipo: `get_segmentation_types`, `get_public_segmentation_types`,
  `set_segmentation/get_segmentation`, por tipo.
- Opções: API key, URL-auth, carregamento direto de DICOM
  (`OPTION_DIRECT_DICOM_ENABLED`, padrão **desativado**), custo de segmentação,
  defaults de novos usuários.
- Sanitização: `sanitize_key`, `sanitize_files`, `sanitize_settings`,
  `sanitize_annotations`, `sanitize_plane_state`; upload em **chunks**
  (`parse_chunk_name`, `store_chunk`).
- Cenas recentes: `record_scene_access`, `get_recent_scenes(_data)` (máx. 10).

### Admin — `class-v-dicom-admin.php`
Menu top-level `v-dicom` (cap. `upload_files`). Ações via `admin_post_*`:
delete, limite (`limit`), tema, **API key**, **tipos de segmentação**, URL-auth,
**carregamento direto de DICOM** (`direct_dicom`), defaults de novos usuários.
A tela lista cenas, gera/edita links, mostra debug do
RunPod e faz polling do status de segmentação.

**Listas com busca + paginação** (linhas por página: `PER_PAGE_USERS` /
`PER_PAGE_SCENES` = 20): as listas de **usuários** (`query_quota_users()`,
`WP_User_Query` com `search` sobre nome/login/e-mail) e de **cenas**
(`query_scenes()`, SQL com `LIKE` sobre título, chave da cena e dono) recebem
`busca` + `página` via query args `uq`/`upage` e `sq`/`spage`. Cada lista
preserva o estado da outra (inputs ocultos / `keep`). Como a lista de usuários
é um `<form>` de limites, **apenas os usuários da página atual são salvos**
(o form de busca é um `<form method="get">` separado). UI em
`render_list_search()` + `render_list_pages()` (`paginate_links`).

### Tema / white-label — `class-v-dicom-theme.php`
`get()` (nome, logo, cores, quiz URL/texto), `css_vars()`, `login_css()`
(estiliza `wp-login.php`).

### Proxy de download — `download.php`
Resolve e faz streaming de links **Google Drive** e **OneDrive** (best-effort),
usando cookie jar, `curl`, extração de IDs/tokens; autorização de URL
consome crédito. Chamado pelo front (`downloadUrl`).

---

## 9. Scripts e comandos

```sh
npm run dev            # vite dev (visualizador local, server host :: port 8080)
npm run build          # build SSR/TanStack Start (saída .output, nitro cloudflare)
npm run build:dev      # build em modo development
npm run build:plugin   # ⭐ bundle do plugin + bump de versão + empacota v-dicom.zip
npm run plugin:i18n    # extrai strings do PHP → languages (.pot/.po/.mo)
npm run icons          # gera ícones PWA/iOS
npm run preview        # serve o build
npm run lint           # eslint .
npm run format         # prettier --write .
```

**`build:plugin`** (`scripts/build-plugin.js`) faz, em ordem:
1. `vite build --config vite.embed.config.ts` (gera `assets/v-dicom.{js,css}`).
2. Remove BOM e normaliza line endings (evita warnings do Plugin Check).
3. **Bump de versão** minor (`X.Y.0` → `X.(Y+1).0`) em `v-dicom.php` e sincroniza
   o `Stable tag` do `readme.txt`.
4. Valida comentários `translators:` acima de cada gettext com placeholder
   (`--check-i18n` roda só a validação).
5. Empacota `v-dicom.zip` na raiz com `fflate`.

---

## 10. Convenções e padrões a respeitar

- **Alias de import**: `@/*` → `./src/*` (TS paths + vite). Use sempre `@/...`.
- **TypeScript estrito**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`.
  Indexar arrays/records exige checagem (`arr[i]!`).
- **Tailwind 4** com tokens em `src/styles.css` (tema escuro "sala de leitura";
  `--axial/--coronal/--sagittal`; classes utilitárias `card-panel`, `data-mono`).
- **UI shadcn** (`new-york`, base slate): componentes em `src/components/ui/`,
  sem prefixo. Ícones: `lucide-react`.
- **i18n obrigatório**: nada de string crua na UI; use `t("...")` e adicione a
  chave nos **três** idiomas. Áreas por arquivo (`common/lib/ui/viewer`).
- **PHP**: prefixos `v_dicom_` / classes `V_Dicom_*`; text domain `v-dicom`;
  toda string traduzível usa `__()` etc.; gettext com `%s`/`%d` **exige** comentário
  `/* translators: ... */` imediatamente acima (validado no build).
- **Comentários**: o código mistura PT-BR e EN; mantenha o tom do arquivo.
- **Não commitar** artefatos: `v-dicom.zip`, `assets/v-dicom.js|css` (gitignored).
- **Prettier** `.prettierrc` + `eslint-plugin-prettier` (eslint falha em formatação).
- **Cuidados de iOS/WebKit**: evitar `File.arrayBuffer()` de arquivos grandes;
  preferir bytes em memória; ZIP com CRC para detectar falhas silenciosas.

---

## 11. Segurança / privacidade (relevante ao editar)

- Processamento de imagem é **local no browser**; não há upload a menos que se
  "salve e compartilhe".
- Compartilhamento com nível de acesso: **link público** (default), **privado** (dono/admins) e **restrito** (e-mails autorizados, cada um recebe um link privado por e-mail). Implementado no backend (`class-v-dicom-rest.php` `GET /scenes/<key>` com `can_access_scene`; rota `GET /scenes/<key>/file`; `POST /scenes/<key>/share`) e no modal do visor (`Viewer.tsx`). Arquivos de cenas não públicas passam por um endpoint verificável; a pasta recebe `.htaccess` bloqueando acesso direto (best-effort).
- Pasta de uploads bloqueia **execução de PHP** e **listagem de diretório**.
- `window.V_DICOM` é **criptografado** (AES-256-CBC; chave derivada do host);
  apenas o locale vai em claro.
- API key (admin) habilita upload/download por chave sem login (`?apikey=`);
  inválida → HTTP 401.
- Aceitação de URL externa consome **1 crédito** na primeira autorização
  (dry-run → confirmação → consumo); reembolso em falha de segmentação.
- Recomendação do projeto: **anonimizar** o exame antes de compartilhar publicamente.

---

## 12. Pontos de atenção / divergências conhecidas

- `README.md` cita versão **1.71.0**; `v-dicom.php` está em **1.67.0**. O bump só
  ocorre via `npm run build:plugin` (minor, `X.Y.0`).
- `assets/v-dicom.js|css` são **gerados** e gitignored — não edite à mão.
- `src/routeTree.gen.ts` é gerado pelo TanStack Router (não editar).
- `Viewer.tsx` é muito grande (~3.5k linhas) — mudanças pontuais exigem âncoras de
  texto únicas; considere extrair subcomponentes só quando fizer sentido.
- O build embutido usa **IIFE + `inlineDynamicImports`**; imports dinâmicos
  (codecs openjpeg/charls) entram no mesmo chunk.
- `nitro` está em versão **beta** (fixada).
- `bunfig.toml` impõe **guarda de 24h** contra pacotes recém-publicados
  (`minimumReleaseAge = 86400`).
- `@dimforge/rapier3d-compat` está em dependências mas **não há uso evidente** no
  código de `src/` — verificar antes de remover.

---

## 13. Guia rápido: "onde mexer para..."

| Tarefa | Arquivo(s) |
| --- | --- |
| UI/fluxo do visualizador | `src/components/Viewer.tsx` |
| Render 2D de um plano | `src/components/SliceView.tsx` + `src/lib/mpr.ts` |
| Reconstrução 3D / meshes | `src/components/Volume3D.tsx` + `src/lib/meshVolume.ts` |
| Decodificar novo formato DICOM | `src/lib/dicom.ts` (`decodePixels`) |
| Ler ZIP / robustez mobile | `src/lib/zip.ts` |
| Comunicação com WordPress | `src/lib/wp.ts` |
| Novo endpoint REST | `wordpress-plugin/v-dicom/includes/class-v-dicom-rest.php` |
| Persistência/quotas/créditos | `.../class-v-dicom-storage.php` |
| Tela de admin | `.../class-v-dicom-admin.php` |
| Config injetada / PWA / rota | `.../class-v-dicom-page.php` |
| Proxy de download externo | `.../includes/download.php` |
| Textos/idiomas da UI | `src/i18n/locales/<lang>/*.json` |
| Textos do plugin (PHP) | `scripts/plugin-i18n.js` + `.../languages/*.po` |
| Build do plugin / versão | `scripts/build-plugin.js`, `vite.embed.config.ts` |
| Design tokens / tema | `src/styles.css` |

---

## 14. Glossário

- **MPR**: reformatação multiplanar (cortes axial/coronal/sagital). **Oblíquo** =
  planos reorientados (ex.: ao longo do eixo do dente).
- **Volume**: cubo 3D de voxels `Int16Array` reconstruído das fatias DICOM.
- **Window/Level (wc/ww)**: brilho/contraste clínico (centro/largura).
- **Crosshair**: interseção dos três planos (cursor 3D).
- **Cena**: estudo salvo no WordPress, acessível por chave (`/v-dicom/KEY/`).
- **RunPod**: serviço externo de **segmentação automática por IA** (gera STL).
- **Segmentação**: geração automática de modelos (meshes) a partir do volume.
- **Proxy**: `download.php`, resolve links Google Drive/OneDrive contornando CORS.
