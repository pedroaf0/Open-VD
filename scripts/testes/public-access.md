# Teste: public-access

## Descrição
Acesso público à cena compartilhada (sem login).

## Fluxo
1. Lê `sceneKey` de `test-scene-key.json`
2. Acessa `http://localhost/v-dicom/{sceneKey}/` em contexto limpo (sem login)
3. Aguarda `#v-dicom-root` visível
4. **Aguarda volume carregar** - monitora canvases:
   - Mínimo 4 canvases total (3 MPR + 1 3D)
   - Usa `page.waitForFunction(() => document.querySelectorAll('canvas').length >= 4)`
5. Verifica viewport 3D: primeiro canvas visível
6. Verifica MPR viewports: pelo menos 3 canvases (slice views)
7. Verifica que NÃO há elementos de admin visíveis

## Seletores
- `#v-dicom-root` - Root do viewer
- `canvas` - Qualquer canvas (total >= 4)
- `button:has-text("Admin"), a[href*="/wp-admin/"]` - Elementos de admin (não devem existir)

## Validações
- Cena pública carrega (4+ canvases)
- Viewport 3D renderizado
- 3+ viewports MPR
- Sem elementos de admin