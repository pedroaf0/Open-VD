# Teste: delete-scene

## Descrição
Exclusão da cena de teste via REST API (limpeza final).

## Fluxo
1. Lê `sceneKey` de `test-scene-key.json`
2. Login no admin (wp-login.php)
3. Faz DELETE request para `http://localhost/wp-json/v-dicom/v1/scenes/{sceneKey}`
   - Headers: `Content-Type: application/json`, `X-WP-Nonce` (se disponível)
4. Verifica response OK
5. Verifica que cena não é mais acessível publicamente:
   - GET `http://localhost/v-dicom/{sceneKey}/` retorna 404 ou 410

## Seletores/Endpoints
- `POST /wp-login.php` - Login
- `DELETE /wp-json/v-dicom/v1/scenes/{sceneKey}` - Deleta cena
- `GET /v-dicom/{sceneKey}/` - Verifica acesso público

## Validações
- DELETE retorna success
- Cena não acessível publicamente (404/410)