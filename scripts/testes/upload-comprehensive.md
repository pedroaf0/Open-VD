# Teste: upload-comprehensive

## Descrição
Upload: pasta DICOM (webkitdirectory), arquivos DICOM, ZIP via file input, STL.

## Fluxo
1. Acessa `http://localhost/v-dicom/`
2. Aguarda `#v-dicom-root` visível
3. **Encontra os 3 inputs de arquivo:**
   - `stlInput`: `input[type="file"][accept*=".stl"]`
   - `dicomInput`: `input[type="file"][accept*=".dcm"]` (aceita .dcm e .zip)
   - `dicomFolderInput`: `input[type="file"][webkitdirectory]`

### TESTE 1: Seleção de pasta DICOM (webkitdirectory)
1. Cria pasta temporária com 50 arquivos .dcm (copia de `C:\Users\pedro\Desktop\vd\Scene\ScalarVolume_7\ScalarVolume_7`)
2. `dicomFolderInput.setInputFiles(tempDir)`
3. Aguarda processamento - monitora `canvas` count
4. **Validação:** Pelo menos 4 canvases (3 MPR + 1 3D)
   - Usa seletor genérico `canvas` - o Viewer renderiza 4 canvases total

### TESTE 1b: Salvar/Compartilhar a cena no servidor
1. Clica no botão **Compartilhar** (header): `button.btn-primary:has(svg.lucide-share-2)` ou `button:has-text("Compartilhar")`
2. **Dialog de compartilhamento abre** (role="dialog" com aria-label="Compartilhar cena")
3. Preenche nome da cena: `input[value={sceneName}]` no dialog (placeholder "Ex.: Paciente João — CBCT")
4. Clica em **"Enviar e gerar link"**: `button.btn-primary:has-text("Enviar e gerar link")` no dialog
5. **Aguarda conclusão do upload** - monitora na página (não no dialog):
   - O link aparece em: `div.flex.shrink-0.flex-wrap.items-center.gap-2.border-b.border-border.bg-panel.px-3.py-2.text-\[11px\] input[readonly][value*="/v-dicom/"]`
   - Extrai scene key da URL: `/v-dicom/KEY/` ou `?scene=KEY`
6. **Salva scene key em `test-scene-key.json`** para testes downstream
7. **NÃO clica em Fechar** - o modal/barra fecha sozinho

### TESTE 2: Upload STL
1. Para cada STL em `C:\Users\pedro\Desktop\vd\Scene\`:
   - `stlInput.setInputFiles(stlPath)`
   - Aguarda processamento
2. Abre lista de modelos: botão com ícone `Layers` / `Boxes` / aria-label "Modelos"
3. Verifica se nomes dos STLs aparecem na lista
4. Fecha com Escape

### TESTE 3: Upload ZIP DICOM via file input
1. Cria ZIP temporário com 15 arquivos .dcm
2. `dicomInput.setInputFiles(zipPath)` (dicomInput aceita .zip)
3. Aguarda processamento - monitora `canvas` count >= 4
4. **Validação:** 4+ canvases

## Seletores Principais
- `#v-dicom-root` - Root do viewer
- `input[type="file"][accept*=".stl"]` - stlInput
- `input[type="file"][accept*=".dcm"]` - dicomInput
- `input[type="file"][webkitdirectory]` - dicomFolderInput
- `button.btn-primary:has(svg.lucide-share-2)` - Botão Compartilhar no header
- `[role="dialog"]` - Dialog de compartilhamento
- `[role="dialog"] input[value={sceneName}]` - Input nome da cena no dialog
- `[role="dialog"] button.btn-primary:has-text("Enviar e gerar link")` - Botão submit no dialog
- `div.flex.shrink-0.flex-wrap.items-center.gap-2.border-b.border-border.bg-panel.px-3.py-2.text-\[11px\] input[readonly][value*="/v-dicom/"]` - Input readonly com URL de compartilhamento (após share)
- `button:has-text("Modelos"), button:has-text("Meshes"), button[aria-label*="model"], button:has(svg.lucide-layers), button:has(svg.lucide-boxes)"` - Botão lista de modelos
- `canvas` - Qualquer canvas (total 4: 3 MPR + 1 3D)

## Validações
- TESTE 1: 4+ canvases renderizando
- TESTE 1b: Scene key extraída e salva em JSON
- TESTE 2: STLs listados na mesh list
- TESTE 3: 4+ canvases após ZIP

## Arquivo JSON gerado
`test-scene-key.json` com `{ "sceneKey": "..." }`