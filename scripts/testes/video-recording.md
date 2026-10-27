# video-recording

Valida a gravação do **painel de visualização** (não apenas do viewport 3D), com o
controle no trilho lateral esquerdo.

## Dependências

- `login`
- `recording-name-pattern` (define `globalThis.__TEST_RECORDING_NAME_PATTERN__`)
- `upload-comprehensive` (cria `test-scene-key.json` e a cena com DICOM)
- `enable-direct-dicom` para os inputs diretos, quando o teste roda isolado

Se rodar isolado, o módulo lê o padrão de nome salvo no WP Admin em
`/wp-admin/admin.php?page=v-dicom-settings`.

## Passos

1. Abre a cena existente em `/v-dicom/<chave>/` e aguarda os 4 canvases.
2. Confere que o viewport 3D mantém apenas o botão de captura de imagem e que
   não há botão de gravação dentro dele.
3. Localiza o botão **Gravar vídeo do painel** no `nav.rail`, inicia a gravação
   e confere:
   - o botão vira **Parar gravação** com `aria-pressed="true"`;
   - o indicador `role="status"` fica sobre o painel, fora do viewport 3D;
   - o timer `tabular-nums` avança.
4. Para a gravação e valida o modal **Vídeo do painel**:
   - vídeo com `blob:` e metadados válidos;
   - dimensões iguais ao canvas composto do painel (não ao viewport 3D);
   - um frame do meio do vídeo contém pixels claros nos quatro quadrantes
     (axial, coronal, sagital e 3D).
5. Baixa o vídeo e confere o padrão de nome configurado no admin e o tamanho
   mínimo do arquivo. O arquivo é descartado, salvo se `--save-recording` for
   usado.
6. Fecha o modal, grava novamente e confirma que o gravador foi reutilizado.
7. Expande a janela axial, grava e confere que o vídeo tem apenas um viewport
   visível. Depois volta ao mosaico de 4 janelas.
8. Em viewport de tablet (900×800), confere que o trilho some e que o mesmo
   controle aparece no painel lateral de parâmetros; grava e valida a prévia.
9. Em viewport mobile (390×844), abre a gaveta **3D**, grava e confere que o
   vídeo segue o viewport em foco (retrato). Ao final, restaura o viewport de
   1920×1080.

## Seletores principais

| Elemento          | Seletor                                                   |
| ----------------- | --------------------------------------------------------- |
| Trilho            | `nav.rail`                                                |
| Gravar            | `getByRole("button", { name: /Gravar vídeo do painel/ })` |
| Parar             | `getByRole("button", { name: /Parar gravação/ })`         |
| Indicador         | `getByRole("status", { name: /Gravando/ })`               |
| Painel gravado    | `[data-recording-panel]`                                  |
| Viewports         | `[data-recording-viewport]`                               |
| Prévia            | `[role="dialog"]:has(video)`                              |
| Expandir          | `main button[aria-label^="Expandir"]`                     |
| Voltar ao mosaico | `getByRole("button", { name: /Voltar ao mosaico/ })`      |

## Validações

- O botão de gravação não existe dentro do viewport 3D.
- O vídeo tem a largura do painel, não a largura de um único viewport.
- Os quatro quadrantes do frame composto têm conteúdo clínico.
- A gravação funciona com uma janela expandida.
- A prévia, o download e uma segunda gravação funcionam.
- O nome do arquivo segue o padrão do WP Admin.
- O controle também existe no painel lateral do tablet e na gaveta 3D do mobile.
