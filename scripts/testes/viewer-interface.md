# Teste: viewer-interface

## Descrição
Testes de interface do viewer: MPR, 3D, anotações, medições, UI interactions.

## Fluxo
1. Lê `sceneKey` de `test-scene-key.json`
2. Acessa `http://localhost/v-dicom/{sceneKey}/`
3. Aguarda `#v-dicom-root` visível
4. **Aguarda volume carregar** - monitora 4+ canvases

### Testes de Interface

#### 1. MPR Navigation (3 slice views)
- Verifica 3 SliceViews renderizados (axial, coronal, sagittal)
- Cada SliceView tem um canvas
- Testa navegação por scroll no primeiro slice view

#### 2. Window/Level Controls
- Procura inputs range com aria-label contendo "Window" ou "Level"
- Ou elementos com classes relacionadas a window/level

#### 3. 3D Viewport Interactions
- Primeiro canvas (Volume3D) visível
- Testa rotação (orbit): mouse down + move + up

#### 4. Render Mode Selector (Equilibrada/Mais precisa/Mais rápida)
- Botão no canto do viewport 3D: `button[aria-label*="render"]` ou dropdown com Gauge/Sparkles/Zap icons
- Clica, verifica 3 opções, seleciona primeira

#### 5. Annotation Tools
- Botão "Anotar" / "Annotate" no header
- Clica, verifica ferramentas: Régua/Ruler, Seta/Arrow, Texto/Text, Desenho/Draw
- Fecha com Escape

#### 6. Measurement Tool (Ruler)
- Seleciona ferramenta Régua
- Desenha medição no primeiro slice view
- Fecha com Escape

#### 7. Mesh List / Model Visibility
- Botão modelos (Layers/Boxes icon)
- Verifica itens na lista (STLs carregados)
- Fecha com Escape

#### 8. Fullscreen Toggle
- Botão fullscreen (Maximize2/Minimize2 icon)
- Clica para entrar e sair

#### 9. Language Switcher
- Botão PT/EN/ES
- Clica, verifica 3+ opções
- Fecha com Escape

## Seletores

### Canvases
- `canvas` - Todos os canvases (total >= 4)

### MPR SliceViews
- Cada SliceView é um `.viewport-frame` contendo um `canvas`
- Header do slice: `.viewport-header .plane-label` com texto "Axial", "Coronal", "Sagittal"

### 3D Volume3D
- Primeiro canvas ou canvas dentro de `.viewport-frame` que não tem label de plano MPR
- Controles no canto: botão capture (Camera), dropdown render mode (Gauge)

### Window/Level
- `input[type="range"][aria-label*="Window"], input[type="range"][aria-label*="Level"]`
- Ou controles visíveis no header dos slice views

### Render Mode
- `button[aria-label*="render"], button:has(svg.lucide-gauge), button:has-text("Equilibrada")`
- Dropdown itens: `[role="menuitem"]`

### Anotações
- `button:has-text("Anotar"), button:has-text("Annotate"), button[aria-label*="annotate"]`
- Ferramentas no dropdown: `[role="menuitem"]:has-text("Régua"), [role="menuitem"]:has-text("Ruler"), [role="menuitem"]:has-text("Seta"), [role="menuitem"]:has-text("Arrow"), [role="menuitem"]:has-text("Texto"), [role="menuitem"]:has-text("Text"), [role="menuitem"]:has-text("Desenho"), [role="menuitem"]:has-text("Draw")`

### Mesh List
- `button:has(svg.lucide-layers), button:has(svg.lucide-boxes), button[aria-label*="model"], button:has-text("Modelos"), button:has-text("Meshes")`
- Itens: `.MeshRow`, `[class*="MeshRow"]`, `[class*="mesh-row"]`

### Fullscreen
- `button[title*="Tela cheia"], button[title*="Fullscreen"], button[aria-label*="fullscreen"], button:has(svg.lucide-maximize-2), button:has(svg.lucide-minimize-2)`

### Language
- `button:has-text("PT"), button:has-text("EN"), button:has-text("ES"), button[aria-label*="language"], button[title*="Idioma"]`

## Validações
- Todos os elementos de UI encontrados e funcionais
- Falha se seletor não encontrar elemento (não passar silenciosamente)