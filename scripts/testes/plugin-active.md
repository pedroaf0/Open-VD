# Teste: plugin-active

## Descrição
Verifica se o plugin v-dicom está ativo.

## Fluxo
1. Acessa `http://localhost/wp-admin/plugins.php`
2. Verifica se o plugin "v-dicom" aparece na lista com status "Ativo"

## Seletores
- `tr[data-plugin*="v-dicom"]` ou busca por texto "v-dicom" na tabela de plugins

## Validação
- Plugin encontrado e ativo