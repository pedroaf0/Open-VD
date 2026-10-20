# Teste: enable-direct-dicom

## Descrição
Habilita directDicomEnabled, publicLoadingEnabled e define limite de armazenamento do admin (10 GB).

## Fluxo
1. Login no admin (wp-login.php)
2. Acessa `http://localhost/wp-admin/admin.php?page=v-dicom`
3. **Configura limite de armazenamento do admin (user ID 1):**
   - Encontra input `input[name="v_dicom_limit[1]"]`
   - Se valor < 10000, preenche com "10000"
   - Encontra input `input[name="v_dicom_credit[1]"]` e preenche com "100" se existir
   - Clica no botão **específico**: `input[name="submit"][id="submit"][value="Salvar cotas para novas contas"]`
4. **Habilita directDicomEnabled:**
   - Encontra checkbox `input[name="v_dicom_direct_dicom"]` ou similar
   - Se não marcado, marca
   - Clica em botão submit genérico
5. **Habilita publicLoadingEnabled:**
   - Encontra checkbox `input[name="v_dicom_public_loading"]` ou similar
   - Se não marcado, marca
   - Clica em botão submit genérico
6. **Verifica se inputs DICOM estão disponíveis na página do viewer:**
   - Acessa `http://localhost/v-dicom/`
   - Verifica `#v-dicom-root` visível
   - Verifica inputs:
     - `input[type="file"][accept*=".dcm"]` (dicomInput)
     - `input[type="file"][webkitdirectory]` (dicomFolderInput)
     - `input[type="file"][accept*=".stl"]` (stlInput)

## Seletores Admin
- `input[name="v_dicom_limit[1]"]` - Limite de armazenamento user 1
- `input[name="v_dicom_credit[1]"]` - Créditos user 1
- `input[name="submit"][id="submit"][value="Salvar cotas para novas contas"]` - **Botão correto para salvar limites**
- `input[name="v_dicom_direct_dicom"]` - Checkbox directDicomEnabled
- `input[name="v_dicom_public_loading"]` - Checkbox publicLoadingEnabled
- `input[type="submit"], button[type="submit"]` - Botões submit genéricos

## Seletores Viewer
- `#v-dicom-root` - Root do viewer
- `input[type="file"][accept*=".dcm"]` - Input DICOM files
- `input[type="file"][webkitdirectory]` - Input DICOM folder
- `input[type="file"][accept*=".stl"]` - Input STL

## Validações
- Limite salvo com sucesso
- Checkboxes marcados
- 3 inputs de arquivo encontrados no viewer