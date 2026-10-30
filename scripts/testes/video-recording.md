# video-recording

Valida a gravação do **painel de visualização** (não apenas do viewport 3D), com o
controle no trilho lateral esquerdo, nos viewports de corte/3D e nos painéis de
tablet/mobile, incluindo a escolha de áudio do microfone.

## Dependências

- `login`
- `recording-name-pattern` (define `globalThis.__TEST_RECORDING_NAME_PATTERN__`)
- `upload-comprehensive` (cria `test-scene-key.json` e a cena com DICOM)
- `enable-direct-dicom` para os inputs diretos, quando o teste roda isolado

Se rodar isolado, o módulo lê o padrão de nome salvo no WP Admin em
`/wp-admin/admin.php?page=v-dicom-settings`.

O runner do Chromium usa `--use-fake-device-for-media-stream` e
`--use-fake-ui-for-media-stream`, além da permissão `microphone`, para validar o
caminho com áudio sem depender de um microfone físico.

## Passos

1. Abre a cena existente em `/v-dicom/<chave>/` e aguarda os 4 canvases.
2. Confere que o viewport 3D e os cortes 2D têm o botão de gravação ao lado do
   botão de captura de imagem, e que ele abre a mesma pergunta de áudio do
   trilho.
3. Localiza o botão **Gravar vídeo do painel** no `nav.rail` e confere que ele
   abre a pergunta **Gravar áudio do microfone?**.
   - Cancelar fecha a pergunta sem iniciar a gravação.
   - **Gravar sem áudio** mantém o comportamento anterior: apenas vídeo.
4. Com a gravação iniciada, confere:
   - o botão vira **Parar gravação** com `aria-pressed="true"`;
   - o indicador `role="status"` fica sobre o painel, fora do viewport 3D;
   - o timer `tabular-nums` avança.
5. Para a gravação e valida o modal **Vídeo do painel**:
   - vídeo com `blob:` e metadados válidos;
   - dimensões iguais ao canvas composto do painel (não ao viewport 3D);
   - nenhuma faixa de áudio no caminho sem microfone;
   - um frame do meio do vídeo contém pixels claros nos quatro quadrantes
     (axial, coronal, sagital e 3D);
   - o botão **Compartilhar vídeo** aparece ao lado do download somente quando
     o navegador aceita compartilhar arquivos (`navigator.canShare({ files })`).
6. Baixa o vídeo e confere o padrão de nome configurado no admin e o tamanho
   mínimo do arquivo. O arquivo é descartado, salvo se `--save-recording` for
   usado.
7. Fecha o modal, grava novamente escolhendo **Gravar com microfone** e confere
   que a prévia tem uma faixa de áudio. Isso também prova que o gravador e as
   tracks foram liberados entre as gravações.
8. Expande a janela axial, grava e confere que o vídeo tem apenas um viewport
   visível. Depois volta ao mosaico de 4 janelas.
9. Em viewport de tablet (900×800), confere que o trilho some e que o mesmo
   controle aparece no painel lateral de parâmetros; grava e valida a prévia.
10. Em viewport mobile (390×844), abre a gaveta **3D**, grava e confere que o
    vídeo segue o viewport em foco (retrato). Ao final, restaura o viewport de
    1920×1080.

## Seletores principais

| Elemento          | Seletor                                                      |
| ----------------- | ------------------------------------------------------------ |
| Trilho            | `nav.rail`                                                   |
| Gravar            | `getByRole("button", { name: /Gravar vídeo do painel/ })`    |
| Pergunta de áudio | `getByRole("dialog", { name: /Gravar áudio do microfone/ })` |
| Sem áudio         | `getByRole("button", { name: /Gravar sem áudio/ })`          |
| Com microfone     | `getByRole("button", { name: /Gravar com microfone/ })`      |
| Parar             | `getByRole("button", { name: /Parar gravação/ })`            |
| Indicador         | `getByRole("status", { name: /Gravando/ })`                  |
| Painel gravado    | `[data-recording-panel]`                                     |
| Viewports         | `[data-recording-viewport]`                                  |
| Prévia            | `[role="dialog"]:has(video)`                                 |
| Compartilhar      | `getByRole("button", { name: /Compartilhar vídeo/ })`        |
| Fechar            | `getByRole("button", { name: /^(Fechar                       | Close | Cerrar)$/ })` |
| Expandir          | `main button[aria-label^="Expandir"]`                        |
| Voltar ao mosaico | `getByRole("button", { name: /Voltar ao mosaico/ })`         |

## Validações

- O botão de gravação existe no trilho, nos viewports de corte/3D e no painel
  lateral do tablet; cancelar a pergunta de áudio nunca inicia a gravação.
- A pergunta de áudio aparece em todos os pontos de início e pode ser cancelada.
- Sem microfone, o vídeo não tem faixa de áudio e continua como antes.
- Com microfone, o vídeo tem a faixa de áudio anexada ao canvas composto.
- O vídeo tem a largura do painel, não a largura de um único viewport.
- Os quatro quadrantes do frame composto têm conteúdo clínico.
- A gravação funciona com uma janela expandida.
- A prévia, o download e uma segunda gravação funcionam.
- O botão de compartilhar vídeo só é renderizado com suporte da Web Share API.
- O nome do arquivo segue o padrão do WP Admin.
- O controle também existe no painel lateral do tablet e na gaveta 3D do mobile.
