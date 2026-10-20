# Teste: share-scene

## Descrição
Compartilhamento de cena existente (usa chave do upload), habilita carregamento público.

## Fluxo
1. Lê `sceneKey` de `test-scene-key.json`
2. Acessa `http://localhost/v-dicom/{sceneKey}/`
3. Aguarda `#v-dicom-root` visível e volume carregado
4. Clica no botão **Compartilhar** no header
5. **Tenta habilitar carregamento público:**
   - Procura checkbox/toggle próximo a texto "Público" ou "Public"
   - Se existir e não estiver marcado, marca
6. Captura URL de compartilhamento:
   - Procura input readonly com value contendo `/v-dicom/`
   - Se não encontrar, constrói: `http://localhost/v-dicom/{sceneKey}/`
7. Salva `shareUrl` em `globalThis.__TEST_SHARE_URL__`
8. Fecha dialog/barra com Escape

## Seletores
- `#v-dicom-root` - Root do viewer
- `button.btn-primary:has(svg.lucide-share-2)` - Botão Compartilhar
- `[role="dialog"] input[type="checkbox"]:near(:text("Público")), [role="dialog"] input[type="checkbox"]:near(:text("Public"))` - Toggle público
- `input[readonly][value*="/v-dicom/"]` - Input com URL de compartilhamento

## Validações
- Cena carrega corretamente
- URL de compartilhamento capturada