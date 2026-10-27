# AGENTS.md — Guia operacional para agentes

> **Este é o arquivo padrão de navegação do projeto.** Leia antes de explorar,
> editar, testar ou empacotar. Ele resume comandos, arquitetura, convenções,
> testes e armadilhas. Para detalhes históricos e explicações longas, consulte
> [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).
>
> **Precedência:** pedido explícito do usuário > este arquivo > `PROJECT_CONTEXT.md`
> / `architecture.md` / READMEs. Quando houver divergência, **o código e as
> configurações atuais são a fonte da verdade** — e este arquivo deve ser
> atualizado.
>
> Última revisão: 27/10/2026.

## Comece aqui (30 segundos)

1. `git status` e `git diff` — entenda o worktree e preserve mudanças existentes.
2. Leia as **Regras de ouro** (§2) e localize sua área no **mapa** (§5) e na
   tabela **“Onde mexer para…”** (§11).
3. Prefira a menor mudança coesa; leia os arquivos vizinhos antes de criar um
   padrão novo.
4. Para UI, atualize i18n nos três idiomas. Para PHP, valide gettext e sanitização.
5. Valide com `npx tsc --noEmit` + lint dos arquivos tocados; rode o E2E
   relevante se o fluxo de usuário mudou. Relate exatamente o que passou.

---

## 1. Resumo do projeto

**v-dicom (Open-VD)** é um visualizador de exames **DICOM/CBCT odontológicos e
radiológicos** que roda no navegador. Ele decodifica DICOM, monta o volume,
exibe cortes **axial/coronal/sagital**, faz **reconstrução 3D**, carrega
**STL/PLY/OBJ**, oferece **MPR oblíquo**, **anotações**, **segmentação por IA em
nuvem** e **compartilhamento de cenas**.

Dois modos de execução:

| Modo | Entrada | Build |
| --- | --- | --- |
| App standalone (SSR) | `src/routes/index.tsx` → `Viewer` | `vite.config.ts` + TanStack Start/Nitro |
| Embutido no WordPress | `src/embed.tsx` → `#v-dicom-root` | `vite.embed.config.ts` (ESM + chunks lazy) |

- Licença: **GPL-2.0-or-later**
- Idioma-fonte da UI: **pt-BR**; também `en` e `es`
- Destino do plugin: **WordPress 5.8+ / PHP 7.4+**
- Versão do plugin: ler em `wordpress-plugin/v-dicom/v-dicom.php`; **não
  confie em badges/README** (podem estar defasados).

---

## 2. Regras de ouro (não negociáveis)

1. **Preserve o trabalho existente.** Rode `git status` antes de editar. Há
   refatorações não commitadas com frequência; nunca descarte, reverta ou
   reformate mudanças alheias para “limpar” o worktree.
2. **Não edite arquivos gerados à mão:** `src/routeTree.gen.ts` (regenere via
   TanStack Router e versione se as rotas mudarem), os bundles
   `wordpress-plugin/v-dicom/assets/v-dicom.js|css` e `assets/chunks/*.js`, os
   ícones gerados e `*.zip`.
3. **Toda string de UI é i18n.** Adicione a chave nos **três** idiomas
   (`pt-BR`, `en`, `es`) no namespace correto. Nunca deixe texto cru em
   `tsx`, `aria-label`, `title` ou `placeholder`.
4. **Use o alias `@/`** para imports de `src/`. Não invente caminhos relativos
   profundos.
5. **Mudanças pequenas e coesas.** Não faça refatoração ampla, renomeação em
   massa ou `prettier --write .` sem relação com a tarefa.
6. **Não rode comandos destrutivos por conta própria:** `npm run build:plugin`
   faz bump de versão, apaga/substitui a cópia em `C:\xampp\htdocs\...` e gera
   ZIP. A suíte E2E altera um WordPress local. Use apenas quando solicitado ou
   quando o ambiente local for claramente descartável.
7. **Sem dados de paciente, segredos ou artefatos no commit.** Não commite
   exames, `test-scene-key.json`, `test-results/`, ZIPs, bundles ou logs.
8. **Não enfraqueça segurança:** permissões REST, nonces, sanitização,
   escape de saída, criptografia de `window.V_DICOM` e bloqueios da pasta de
   uploads são requisitos, não detalhes.

---

## 3. Stack e ferramentas

| Camada | Tecnologias principais |
| --- | --- |
| Front-end | React 19, TypeScript 5.8, Vite 8 |
| Roteamento/SSR | TanStack Router + TanStack Start, Nitro (`cloudflare-module`) |
| UI | Tailwind CSS 4 (lightningcss), Radix UI, shadcn (`new-york`, slate), lucide-react, `motion` |
| 3D | Three.js 0.185 (`STLLoader`, `PLYLoader`, `OBJLoader`, `OrbitControls`) |
| DICOM | `dicom-parser`, `jpeg-js`, `jpeg-lossless-decoder-js`, codecs OpenJPEG/CharLS |
| Arquivos | `fflate`, `@zip.js/zip.js` |
| i18n | i18next + react-i18next |
| Backend | WordPress/PHP 7.4+ (plugin próprio) |
| Testes | Playwright via runner próprio em `scripts/testes/` |
| Qualidade | ESLint 9 flat config, Prettier, `tsc`, `php -l` |

**Gerenciador:** o repositório versiona `package-lock.json`; use **npm**.
`bunfig.toml` existe e impõe guarda de 24 h para pacotes recém-publicados
(`minimumReleaseAge = 86400`). Não adicione dependências nem exceções a essa
guarda sem necessidade e confirmação.

**Versões mínimas do produto:** mantenha compatibilidade com **PHP 7.4** e
**WordPress 5.8**, mesmo que o PHP local seja mais novo. Não introduza sintaxe
PHP 8+ no plugin.

---

## 4. Comandos

```sh
npm ci                          # instalação limpa a partir do package-lock
npm run dev                     # app local em http://localhost:8080
npm run build                   # build SSR/TanStack Start + Nitro
npm run build:dev               # build em modo development
npm run preview                 # serve o build
npm run lint                    # ESLint em todo o repositório
npm run format                  # Prettier em todo o repositório (use com cautela)
npm run test:plugin             # suíte E2E Playwright (headed por padrão)
npm run plugin:i18n             # extrai gettext do PHP → .pot/.po/.mo
npm run icons                   # regenera ícones PWA/iOS
npm run build:plugin            # ⚠ bundle + bump minor + ZIP + copia p/ XAMPP
```

Comandos auxiliares usados no dia a dia:

```sh
npx tsc --noEmit                                      # typecheck completo
npx eslint src/components/Viewer.tsx                  # lint só dos arquivos tocados
npx prettier --check src/components/Viewer.tsx        # checagem de formato
npx prettier --write src/components/Viewer.tsx        # formata só o arquivo tocado
php -l wordpress-plugin/v-dicom/includes/class-v-dicom-rest.php
node scripts/build-plugin.js --check-i18n             # valida comentários "translators:"
npx vite build --config .\vite.embed.config.ts        # SÓ o bundle do plugin, sem bump/ZIP
```

### Observações importantes sobre comandos

- **`npm run build:plugin` tem efeitos colaterais:** incrementa a versão minor
  (`X.Y.0` → `X.(Y+1).0`), sincroniza `readme.txt`, gera
  `v-dicom-<versão>.zip` na raiz e **apaga/recria**
  `C:\xampp\htdocs\wp-content\plugins\v-dicom`. Não rode para “só testar o
  build”; use o comando `vite build` do bundle acima.
- **`npm run lint` deve passar sem erros.** Se aparecer falha em arquivo que
  você não tocou, não reformate o repositório inteiro; registre a falha e
  valide apenas o seu diff.
- **`npm run format` global** pode gerar um diff enorme. Prefira
  `npx prettier --write <arquivos>`.
- **PHP não passa por Prettier/ESLint.** Use `php -l` e siga o estilo do
  arquivo. Não há PHPCS configurado.
- **Não há CI** configurado no repositório; a validação é local.

---

## 5. Mapa do repositório

```
Open-VD/
├─ src/
│  ├─ routes/
│  │  ├─ __root.tsx                # shell HTML, providers, i18n, 404/erro
│  │  └─ index.tsx                 # rota "/" → <Viewer/>
│  ├─ components/
│  │  ├─ Viewer.tsx                # orquestrador central da UI
│  │  ├─ viewer/                   # subcomponentes extraídos do Viewer
│  │  │  ├─ layout/                # Header, Rail, SidePanel, ViewportGrid, mobile
│  │  │  ├─ dialogs/               # Share, QR, segmentação, erros, confirmações
│  │  │  ├─ panels/                # MeshPanel, OrientationPanel, RangeField…
│  │  │  ├─ types.ts               # FlipFlags, progresso, abas, estados de diálogo
│  │  │  ├─ settings.ts            # serialize/deserialize de planos e flip
│  │  │  └─ constants.ts
│  │  ├─ SliceView.tsx             # viewport 2D (MPR, navegação, anotações)
│  │  ├─ Volume3D.tsx              # viewport 3D (Three.js, meshes, transparência)
│  │  ├─ ProfileView.tsx           # dashboard do usuário
│  │  ├─ SceneDownloadModal.tsx    # download de cena em ZIP, agrupado
│  │  ├─ MultiSeriesModal.tsx      # escolha de série
│  │  ├─ LanguageSwitcher.tsx, LoadingIcons.tsx, DebugPanel.tsx…
│  │  └─ ui/                       # primitivas shadcn (dialog, dropdown, input)
│  ├─ hooks/useBreakpoint.ts       # mobile/tablet/desktop
│  ├─ lib/                         # regras de negócio e utilitários puros
│  │  ├─ dicom.ts                  # parse, decode, Volume, renderSlice
│  │  ├─ mpr.ts                    # álgebra, PlaneState, renderPlane
│  │  ├─ wp.ts                     # ponte REST/WordPress + tipos
│  │  ├─ zip.ts                    # ZIP em streaming + CRC-32
│  │  ├─ annotations.ts            # tipos e render de anotações
│  │  ├─ meshVolume.ts             # volume de STL/PLY/OBJ
│  │  ├─ meshColors.ts             # regras nome → cor
│  │  ├─ meshGroups.ts             # agrupamento por termo do nome
│  │  ├─ renderMode.ts             # balanced | precise | fast
│  │  ├─ transparency.ts           # OIT + depth peeling
│  │  ├─ pwa.ts, debuglog.ts, format.ts, async.ts, utils.ts
│  │  ├─ imageCapture.ts, videoCapture.ts
│  │  └─ zipjs.d.ts
│  ├─ i18n/
│  │  ├─ index.ts, languages.ts
│  │  └─ locales/{pt-BR,en,es}/{common,lib,ui,viewer}.json
│  ├─ styles.css                  # tokens Tailwind 4 + utilitários do tema
│  ├─ embed.tsx                   # entry do bundle WordPress
│  ├─ perf-main.tsx               # harness local de performance (não é o app)
│  └─ router.tsx, routeTree.gen.ts (GERADO)
├─ scripts/
│  ├─ build-plugin.js             # bundle + bump + gettext + ZIP + cópia XAMPP
│  ├─ plugin-i18n.js              # extração gettext do PHP
│  ├─ generate-icons.js
│  ├─ test-plugin.js              # runner E2E
│  └─ testes/                     # módulos E2E + helpers + docs .md
├─ wordpress-plugin/v-dicom/
│  ├─ v-dicom.php                 # bootstrap, CPT, ativação, hooks
│  ├─ includes/
│  │  ├─ class-v-dicom-page.php   # rota /v-dicom/, config injetada, PWA/SW
│  │  ├─ class-v-dicom-rest.php   # REST API (namespace v-dicom/v1)
│  │  ├─ class-v-dicom-storage.php# cenas, arquivos, quotas, créditos
│  │  ├─ class-v-dicom-admin.php  # admin, listas, segmentação, cores
│  │  ├─ class-v-dicom-theme.php  # white-label
│  │  └─ download.php             # proxy Google Drive/OneDrive
│  ├─ assets/                     # v-dicom.js/css + chunks/ (GERADO, gitignored)
│  ├─ icon/                       # gerado por npm run icons
│  └─ languages/                  # .pot/.po/.mo
├─ public/perf.html               # harness de performance
├─ architecture.md                # referência genérica do padrão WP + React
├─ PROJECT_CONTEXT.md             # contexto detalhado (pode estar defasado)
└─ README.md / README.pt.md / README.es.md
```

**Leitura recomendada por área:** `PROJECT_CONTEXT.md` §4 (arquitetura),
§5 (APIs de `src/lib`), §8 (plugin PHP) e §13 (“onde mexer para…”). Confirme
sempre no código.

---

## 6. Noções essenciais de arquitetura

### 6.1 Dois builds, um app

- **SSR:** `vite.config.ts` + TanStack Start + Nitro. Entrada
  `src/routes/index.tsx`.
- **Plugin:** `vite.embed.config.ts`, entrada `src/embed.tsx`, saída **ESM**
  `wordpress-plugin/v-dicom/assets/v-dicom.js` + `assets/chunks/*.js` (+
  `v-dicom.css`). Monta em `#v-dicom-root`, com guarda `data-mounted`.
  O entry é enqueued como `type="module"` (filtro `script_loader_tag` em
  `class-v-dicom-page.php`); imports dinâmicos viram chunks lazy (codecs
  openjpeg/charls, Three.js/`Volume3D`, fallback ZIP, loaders de malha).

### 6.2 Standalone vs. WordPress

O app detecta WordPress por `window.V_DICOM`:

- **Presente:** REST base, nonce, cena, marca, limites, permissões e locale vêm
  do WordPress. A config é **AES-256-CBC** (`{ e, iv, d }`), descriptografada em
  `src/lib/wp.ts` (`decryptWindowConfig`). O locale vai separado, em claro, em
  `window.V_DICOM_LOCALE`.
- **Ausente:** visualizador puramente local; nada é enviado ao servidor.

Ao alterar o formato da config, atualize **os dois lados** (`class-v-dicom-page.php`
e `src/lib/wp.ts`) e os tipos `WpConfig`/`SceneSettings`.

### 6.3 Fluxo principal

1. Abrir pasta DICOM, ZIP, URL (proxy) ou cena (`?scene=KEY`).
2. `groupFilesBySeries` → `MultiSeriesModal` se houver várias séries.
3. `buildVolumeFromFiles` → `Volume` (`Int16Array`, espaçamentos, direções).
4. Render 2D: `renderSlice` (ortogonal) ou `renderPlane` (MPR trilinear).
5. Render 3D: `Volume3D` (textura de volume + meshes + planos).
6. Anotações no `SliceView`, salvas como metadados + PNG.
7. Compartilhar: **criar a cena primeiro** (`POST /scenes`) e só depois subir
   arquivos/PNGs/settings. Nunca inverta essa ordem.

### 6.4 MPR oblíquo

Em `src/lib/mpr.ts`: o **volume é fixo**; apenas os planos se movem/rotacionam.
Cada `PlaneState` tem `origin`, `u`, `v`, `n`. `renderPlane` reamostra do
volume original por interpolação trilinear. `planeGeometry` mantém campo de
visão fixo (`MAX_DIM = 640`).

### 6.5 Transparência 3D

Modos em `src/lib/renderMode.ts`, persistidos em
`localStorage: openvd:transparency-mode:v1`:

| Modo | Técnica |
| --- | --- |
| `balanced` (padrão) | Weighted Blended OIT |
| `precise` | Depth Peeling (8 camadas; máx. 12) |
| `fast` | Técnica antiga (`depthWrite: true`) |

- `src/lib/transparency.ts` preserva o material original e injeta shader via
  `onBeforeCompile`.
- Os planos de corte são renderizados num depth target próprio
  (`createStaticDepthTarget`/`prepareStaticDepth` em `Volume3D`) para oclusão.
- **`precise` desativa o `OrbitControls`** e usa D-pad/zoom/reset. Qualquer nova
  interação 3D precisa respeitar esse estado.
- O modo `precise` tem custo maior de GPU; não adicione passes sem medir.

### 6.6 Estado e persistência

- `Viewer.tsx` orquestra estado de volume, window/level, planos, anotações,
  segmentação, share, cena e responsividade.
- Subcomponentes de layout/diálogo/painel ficam em `src/components/viewer/`.
- Regras puras ficam em `src/lib/`; não duplique álgebra/negócio em componentes.
- `SceneSettings` inclui `flip?: { x, y, z }` para corrigir orientação.
- `useBreakpoint()` decide mobile/tablet/desktop; no mobile há abas de plano.

---

## 7. Convenções de código

### 7.1 TypeScript / React

- **Strict de verdade:** `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`,
  `noPropertyAccessFromIndexSignature`.
  - Indexação exige checagem ou asserção consciente: `const x = arr[i]!;`
  - Objetos com índice: use `obj["chave"]`.
  - Ao passar opcional, não use `undefined` explícito se o tipo não permitir;
    use spread condicional.
- **Sem `any` gratuito.** Prefira tipos exportados de `src/lib` ou tipos locais
  claros. Evite `as` para silenciar erros.
- **Exports nomeados** para componentes/hooks/funções, seguindo o padrão atual.
- **Componentes funcionais** e hooks. Não introduza classes.
- **Organização:** UI em `components/`; lógica pura/negócio em `lib/`; hooks
  reutilizáveis em `hooks/`. Se `Viewer.tsx` crescer, extraia para
  `components/viewer/{layout,dialogs,panels}` em vez de criar mais um monólito.
- **Comentários:** o código mistura PT-BR e EN; mantenha o idioma e o tom do
  arquivo. Comente o “porquê”, não o óbvio.
- **Performance:** cuidado com re-renders em `Viewer`, canvas e Three.js.
  Não recrie geometrias/materiais a cada render; use `useMemo`/`useCallback`
  quando justificado. Meça antes de otimizar.

### 7.2 UI / Tailwind / i18n

- Tailwind 4 com tokens em `src/styles.css` (tema escuro “sala de leitura”,
  cores `--axial/--coronal/--sagittal`, utilitários `card-panel`, `data-mono`).
- shadcn `new-york`, base slate, sem prefixo; primitivas em
  `src/components/ui/`. Ícones: `lucide-react`. Combine classes com `cn()`.
- **i18n obrigatório:** use `useTranslation()`/`t("...")`. Adicione a chave
  nos **três** arquivos do namespace (`common`, `lib`, `ui` ou `viewer`).
  Mantenha as mesmas chaves em `pt-BR`, `en` e `es`.
- Preserve `aria-label`, `title` e textos usados por testes. A suíte E2E
  seleciona muitos elementos por **texto em português** e por `aria-label`.
- Resolução de idioma: escolha salva → navegador → locale do WordPress →
  `pt-BR`. SSR sempre renderiza `pt-BR`; a troca ocorre após hidratação.
- Não use `window`/`document` durante o render SSR sem guarda; o projeto já tem
  um caso conhecido de hydration mismatch no botão de fullscreen.

### 7.3 PHP / WordPress

- Prefixos: funções/opções `v_dicom_`, classes `V_Dicom_*`, text domain
  `v-dicom`.
- Toda string traduzível usa `__()`, `_e()`, `esc_html__()` etc.
- **Gettext com `%s`/`%d` exige** comentário `/* translators: ... */`
  imediatamente acima (validado por `--check-i18n` e pelo build do plugin).
- **Sanitize na entrada, escape na saída.** Use `sanitize_*`, `absint`,
  `wp_kses_post` etc. conforme o tipo. Não confie em dados de `$_GET/$_POST`.
- **REST:** toda rota precisa de `permission_callback`; valide parâmetros;
  retorne `WP_Error`/status adequados. Mantenha os tipos do front em sincronia.
- **Admin:** ações via `admin_post_*`, nonce e capability. Siga os formulários
  existentes; não crie um novo padrão de navegação.
- **Storage:** arquivos ficam em `wp-content/uploads/v-dicom/<key>/`; respeite
  `SAFE_EXT`, quotas, créditos, chunks e os helpers de storage. Não escreva
  direto em paths arbitrários.
- **Cenas:** o CPT é privado (`public=false`). Privacidade padrão é privada;
  link público/restrito é escolha explícita.
- **Compatibilidade:** PHP 7.4 e WP 5.8+. Evite APIs/recursos mais novos.
- **Sem PHPCS:** siga o estilo existente; rode `php -l` em cada arquivo alterado.

### 7.4 Formatação

- Prettier: `printWidth: 100`, aspas duplas, `semi: true`, `trailingComma: all`,
  `endOfLine: auto`.
- `eslint-plugin-prettier` transforma erro de formato em erro de lint.
- Prettier **ignora** `*.php`, `*.txt`, `*.zip`, `*.svg`,
  `wordpress-plugin/v-dicom/assets` e `routeTree.gen.ts` (ver `.prettierignore`).

---

## 8. Testes

### 8.1 O que existe (e o que não existe)

- **Não há Vitest/Jest nem testes unitários.** O typecheck (`tsc`) e o lint são
  a primeira barreira estática.
- A suíte é **E2E com Playwright**, executada por um runner próprio
  (`scripts/test-plugin.js`) que carrega módulos de `scripts/testes/*.js`.
- Não há configuração de CI; os testes rodam contra um **WordPress local**.

### 8.2 Pré-requisitos da suíte E2E

| Requisito | Valor |
| --- | --- |
| WordPress local | `http://localhost` (Apache na porta 80) |
| Plugin | `v-dicom` instalado e ativo |
| Admin | usuário/senha definidos em `scripts/test-plugin.js` (`adm` / `adm123`) |
| Fixtures DICOM | `C:\Users\pedro\Desktop\vd\Scene\ScalarVolume_7\ScalarVolume_7` (≥ 50 `.dcm`) |
| Fixtures STL | `C:\Users\pedro\Desktop\vd\Scene\Dentes inferiores.stl` e `polpa_01.stl` |
| Navegador | Chromium via Playwright (`npx playwright install chromium` se faltar) |
| Idioma da UI | **pt-BR** (vários seletores usam texto em português) |

O runner **não** sobe WordPress nem o dev server. Ele assume que o ambiente
XAMPP/WordPress já está no ar e que o plugin foi copiado para lá
(`npm run build:plugin` faz essa cópia, mas também faz bump/ZIP).

### 8.3 Comandos

```sh
npm run test:plugin                         # headed, slowMo 200
node scripts/test-plugin.js --headless      # recomendado para agente/CI
node scripts/test-plugin.js --only=login,enable-direct-dicom,upload-comprehensive,share-scene,delete-scene --headless
node scripts/test-plugin.js --help          # todas as flags
```

Flags: `--screenshots`, `--video`, `--logs`, `--save-recording`, `--headless`,
`--only=<módulos separados por vírgula>`.

### 8.4 Ordem e dependências

Os módulos são ordenados por `order` (empate: ordem alfabética do arquivo).
A suíte é **stateful** e depende da ordem:

| order | Módulo | Depende de |
| --- | --- | --- |
| 10 | `login` | WordPress local |
| 20 | `plugin-active` | login |
| 30 | `enable-direct-dicom` | login |
| 35 | `recording-name-pattern` | login |
| 40 | `upload-comprehensive` | login, direct DICOM, fixtures; grava `test-scene-key.json` |
| 50 | `share-scene` | cena criada no upload |
| 50 | `stl-deletion` | cena + STLs do upload |
| 70 | `public-access` | cena compartilhada |
| 80 | `viewer-interface` | cena carregada |
| 85 | `video-recording` | login, cena, padrão de nome |
| 90 | `delete-scene` | chave da cena; limpeza final |

**Não rode um módulo dependente isoladamente** sem antes rodar os pré-requisitos
(ou reaproveitar `test-scene-key.json`). `--only` filtra, mas não resolve
dependências.

### 8.5 Estado e artefatos

- `test-scene-key.json` (raiz) transporta a chave da cena entre módulos, via
  `readSceneKey`/`writeSceneKey`/`clearSceneKey` em `test-helpers.mjs`.
- `test-results/` recebe screenshots, vídeos e logs quando as flags são usadas.
- `globalThis.__TEST_*__` transporta valores dentro da mesma execução.
- **Não commite** `test-scene-key.json`, `test-results/`, gravações ou exames.
- A suíte **altera o WordPress local**: limites/créditos do admin, opções de
  DICOM direto/public loading, padrão de nome de vídeo, cenas e arquivos.
  Nunca aponte para produção ou para um site compartilhado.

### 8.6 Como adicionar um teste

Crie `scripts/testes/<nome>.js` exportando:

```js
import { expect } from "@playwright/test";
import { ensureLoggedIn, waitForViewerReady } from "./test-helpers.mjs";

export const name = "meu-teste";
export const description = "O que este módulo valida";
export const order = 60; // escolha a posição na cadeia

export async function run(page, config) {
  const { WP_URL } = config;

  await ensureLoggedIn(page, config);
  await page.goto(`${WP_URL}/v-dicom/`);
  await expect(page.locator("#v-dicom-root")).toBeVisible({ timeout: 10000 });
  await waitForViewerReady(page, 4, 240000);

  // prefira role/text/aria a CSS estrutural
  await expect(page.getByRole("button", { name: "Compartilhar" })).toBeEnabled();
}
```

- O runner ignora módulos sem `run()` exportado (`test-helpers.mjs` fica
  intencionalmente fora do glob `*.js`).
- Documente o fluxo em `scripts/testes/<nome>.md` (descrição, passos,
  seletores, validações), seguindo os `.md` existentes.
- Use os helpers (`ensureLoggedIn`, `waitForViewerReady`, `ensurePanelOpen`,
  `openSection`, `ensureAnnotationMode`, `createAnonymousPage`).
- Se depender de estado, documente a dependência no `description`/`.md` e
  limpe o que criou no final.
- Prefira seletores resilientes: `role`, `aria-label`, texto exato. Evite
  classes Tailwind longas e posições de DOM.
- O teste deve falhar com mensagem útil (`expect` com timeout), não com
  `waitForTimeout` longo sem verificação.

### 8.7 Matriz mínima por tipo de mudança

| Mudança | Validação mínima |
| --- | --- |
| TS/React/UI | `npx tsc --noEmit`, `npx eslint <arquivos>`, teste E2E do fluxo afetado |
| Textos/i18n | chaves nos 3 locales, `tsc`, lint, E2E do viewer (se texto/aria mudou) |
| DICOM/ZIP/MPR/3D | E2E relevante + teste manual com fixture; medir performance se 3D |
| PHP/REST/storage | `php -l`, `--check-i18n`, fluxo REST/E2E; atualizar tipos TS |
| Build do plugin | `vite build` do embed + `--check-i18n`; `build:plugin` só se solicitado |
| Docs | conferir comandos/caminhos citados; não prometer comportamento não verificado |

**Regra de honestidade:** se um teste não foi executado, diga que não foi.
Relate o comando exato, o resultado e qualquer falha pré-existente.

---

## 9. Segurança, privacidade e dados

- O processamento de imagem é **local no navegador**. Upload só ocorre ao
  salvar/compartilhar uma cena.
- Cenas são **privadas por padrão**; link público/restrito é ação explícita.
- A pasta de uploads bloqueia execução de PHP e listagem de diretório.
- `window.V_DICOM` é criptografado; apenas `V_DICOM_LOCALE` vai em claro.
- API key de admin permite upload/download por `?apikey=`. Chave inválida →
  401. Não logue a chave.
- URL externa consome **1 crédito** na primeira autorização (dry-run →
  confirmação → consumo); reembolso em falha de segmentação.
- Trate exames como **dados sensíveis de paciente**. Não inclua PHI em issues,
  logs, screenshots, fixtures ou commits. Recomende anonimização ao compartilhar.
- **iOS/WebKit:** evite `File.arrayBuffer()` de arquivos grandes; prefira bytes
  em memória. O ZIP usa CRC-32 para detectar falhas silenciosas. Não remova
  esses cuidados.

---

## 10. Armadilhas conhecidas

- **Documentação defasada:** `PROJECT_CONTEXT.md` foi escrito antes da extração
  de `Viewer.tsx` para `src/components/viewer/`; versões, números de linhas e
  nomes de artefatos podem divergir. `README` pode ter badge de versão antiga.
- **`build:plugin` não é um build incremental inocente:** bump + ZIP + cópia
  destrutiva para XAMPP.
- **`routeTree.gen.ts` é gerado** pelo TanStack Router e versionado; não edite
  à mão. Se as rotas mudarem, regenere e inclua o arquivo no commit.
- **Bundles `assets/v-dicom.js|css` e `assets/chunks/*.js` são gerados** e
  gitignored.
- **O entry do plugin é um ES module:** o WordPress o imprime como
  `type="module"` via filtro `script_loader_tag`. Se esse filtro for removido,
  o bundle não executa; os chunks são resolvidos relativamente a `assets/`.
- **Cache do entry com chunks:** o entry é estável (`v-dicom.js?ver=...`), mas
  os chunks têm hash. O build do plugin versiona os imports do entry e os nomes
  dos chunks (`...-v<versão>.js`) para evitar mismatch entre entry e chunk em
  cache. Ainda assim, uma página aberta durante a troca dos assets deve ser
  recarregada; em build manual sem bump, use hard refresh.
- **`Viewer.tsx` é grande**, mas agora é um orquestrador com subcomponentes em
  `viewer/`. Não reintroduza lógica de layout/diálogo nele sem necessidade.
- **`precise` desativa OrbitControls:** novas interações 3D devem checar o modo.
- **Hydration mismatch conhecido** no botão de fullscreen (checagem de
  `document`); não é quebra de build. Se tocar no tema, corrija com mount guard
  ou `suppressHydrationWarning`.
- **Testes dependem de caminhos Windows absolutos** e de fixtures fora do repo.
  Se as fixtures não existirem, o teste falha — não baixe dados de paciente.
- **A suíte E2E usa textos pt-BR**; mudar uma tradução pode quebrar seletores.
  Atualize o teste junto.
- **`@tanstack` e `nitro` beta/fixados:** não atualize versões “de passagem”.
- **`bunfig.toml` exige 24 h de maturação** para pacotes novos. Não adicione
  exclusões para contornar sem confirmação.

---

## 11. Onde mexer para…

| Tarefa | Arquivos |
| --- | --- |
| UI/fluxo do visualizador | `src/components/Viewer.tsx` + `src/components/viewer/**` |
| Cabeçalho, rail, painel, grid mobile | `src/components/viewer/layout/**` |
| Diálogos (share, QR, segmentação, URL) | `src/components/viewer/dialogs/**` |
| Painéis (modelos, orientação, sliders) | `src/components/viewer/panels/**` |
| Render 2D / MPR | `src/components/SliceView.tsx` + `src/lib/mpr.ts` |
| Reconstrução 3D / meshes | `src/components/Volume3D.tsx` + `src/lib/meshVolume.ts` |
| Transparência / modos de render | `src/lib/renderMode.ts`, `src/lib/transparency.ts`, `Volume3D.tsx` |
| Decodificar novo formato DICOM | `src/lib/dicom.ts` (`decodePixels`) |
| ZIP / robustez mobile | `src/lib/zip.ts` |
| Ponte WordPress / cenas / uploads | `src/lib/wp.ts` |
| Novo endpoint REST | `wordpress-plugin/v-dicom/includes/class-v-dicom-rest.php` |
| Persistência, quotas, créditos, cores | `.../class-v-dicom-storage.php` |
| Admin (cenas, limites, segmentação, cores) | `.../class-v-dicom-admin.php` |
| Página `/v-dicom/`, config, PWA/SW | `.../class-v-dicom-page.php` |
| White-label | `.../class-v-dicom-theme.php` |
| Proxy Google Drive/OneDrive | `.../includes/download.php` |
| Textos da UI | `src/i18n/locales/<lang>/*.json` |
| Textos do plugin (PHP) | `scripts/plugin-i18n.js` + `.../languages/*.po` |
| Design tokens | `src/styles.css` |
| Build/versão do plugin | `scripts/build-plugin.js`, `vite.embed.config.ts` |
| Testes E2E | `scripts/testes/*.js` + `scripts/test-plugin.js` |
| Contexto/arquitetura | `PROJECT_CONTEXT.md`, `architecture.md` |

---

## 12. Git e entrega

- Comece por `git status` e `git diff` para entender o worktree.
- Um commit = uma mudança lógica. Não misture refatoração, formatação global e
  correção funcional.
- Estilo do histórico: assunto curto em inglês, imperativo
  (`Add ...`, `Fix ...`, `Clean up ...`), corpo explicando o “porquê” quando
  necessário. Siga o tom dos commits existentes.
- Inclua testes/documentação quando a mudança altera comportamento, comandos,
  seletores ou arquitetura.
- **Não commite:** `v-dicom*.zip`, `wordpress-plugin/v-dicom/assets/*`,
  `test-results/`, `test-scene-key.json`, logs, gravações, fixtures de paciente,
  `node_modules`. `src/routeTree.gen.ts` é gerado, mas é versionado: inclua a
  regeneração quando as rotas mudarem, nunca uma edição manual.
- Não faça bump manual de versão; o fluxo oficial é `npm run build:plugin`
  (release) — e ele só deve rodar quando solicitado.
- Antes de finalizar, informe: o que mudou, o que foi validado, o que não foi
  possível validar e riscos/limitações.

---

## 13. Manutenção deste arquivo

Atualize `AGENTS.md` quando mudar:

- comandos, scripts ou requisitos de ambiente;
- estrutura de pastas/entrada de build;
- convenções de i18n, testes ou qualidade;
- fluxo de release/versionamento.

Mantenha o documento curto o suficiente para ser lido e específico o suficiente
para evitar decisões erradas. Ao alterar, revise a data no topo e confirme que
os comandos citados ainda existem em `package.json`/`scripts/`.
