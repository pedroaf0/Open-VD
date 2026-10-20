# Teste: login

## Descrição
Faz login no WordPress admin.

## Fluxo
1. Acessa `http://localhost/wp-login.php`
2. Preenche `#user_login` com "adm"
3. Preenche `#user_pass` com "adm123"
4. Clica em `#wp-submit`
5. Aguarda URL conter `/wp-admin/`

## Seletores
- `#user_login` - Input de usuário
- `#user_pass` - Input de senha
- `#wp-submit` - Botão de submit

## Validação
- `expect(page).toHaveURL(/\/wp-admin\//)`