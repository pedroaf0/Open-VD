<?php

// Carrega o WordPress para acesso ao banco de dados
if ( ! defined( 'ABSPATH' ) ) {
    require_once __DIR__ . '/../../../../wp-load.php';
}

global $wpdb;

// Nome da tabela de URLs autorizadas
$v_dicom_authorized_urls_table = $wpdb->prefix . 'v_dicom_authorized_urls';

// Garantir que a tabela existe (idempotente — útil para sites atualizados
// de versões antigas com o CREATE TABLE quebrado no hook de ativação)
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- custom table
if ($wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $v_dicom_authorized_urls_table)) !== $v_dicom_authorized_urls_table) {
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery.SchemaChange -- table created on activation
    $v_dicom_schema_sql = "CREATE TABLE `$v_dicom_authorized_urls_table` (
        id mediumint(9) NOT NULL AUTO_INCREMENT,
        url varchar(255) NOT NULL,
        times_accessed int(11) NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY url (url)
    )";
    dbDelta($v_dicom_schema_sql);
}

// Função para verificar se URL está autorizada
function v_dicom_is_url_authorized($url) {
    global $wpdb, $v_dicom_authorized_urls_table;

    // Normalizar URL para comparação
    $normalizedUrl = strtolower(trailingslashit(wp_parse_url($url, PHP_URL_SCHEME) . '://' . wp_parse_url($url, PHP_URL_HOST) . wp_parse_url($url, PHP_URL_PATH)));

    // Verificar na tabela se já está autorizada
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, PluginCheck.Security.DirectDB.UnescapedDBParameter -- custom table
    $result = $wpdb->get_var(
        $wpdb->prepare(
            // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name from $wpdb->prefix
            "SELECT times_accessed FROM $v_dicom_authorized_urls_table WHERE url = %s",
            $normalizedUrl
        )
    );

    if ($result !== null) {
        // URL já autorizada - incrementar contador de acessos
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- custom table
        $wpdb->update(
            $v_dicom_authorized_urls_table,
            ['times_accessed' => $result + 1],
            ['url' => $normalizedUrl]
        );
        return true; // Autorizada - pode ser baixada sem consumir crédito adicional
    }

    return false; // Não autorizada - precisa de crédito para autorizar
}

// phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged -- long-running streaming download
set_time_limit(0);
ignore_user_abort(true);

$v_dicom_user_agent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' .
    'AppleWebKit/537.36 (KHTML, like Gecko) ' .
    'Chrome/131.0.0.0 Safari/537.36';




/*
|--------------------------------------------------------------------------
| ERRO
|--------------------------------------------------------------------------
*/

function v_dicom_error_response($code, $message)
{

    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: text/plain; charset=UTF-8');
    }

    // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- plain-text error body
    echo $message;
    exit;
}


/*
|--------------------------------------------------------------------------
| HOST
|--------------------------------------------------------------------------
*/

function v_dicom_get_host($url)
{
    return strtolower(
        wp_parse_url($url, PHP_URL_HOST) ?: ''
    );
}


/*
|--------------------------------------------------------------------------
| DETECTA SERVIÇO
|--------------------------------------------------------------------------
*/

function v_dicom_detect_service($url)
{
    $host = v_dicom_get_host($url);

    /*
     * Google Drive
     */

    if (
        $host === 'drive.google.com' ||
        $host === 'docs.google.com' ||
        $host === 'drive.usercontent.google.com'
    ) {
        return 'google';
    }

    /*
     * OneDrive
     */

    if (
        $host === '1drv.ms' ||
        $host === 'onedrive.live.com' ||
        $host === 'onedrive.com' ||
        substr($host, -'.onedrive.live.com' ? 16 : 0) === '.onedrive.live.com'
    ) {
        return 'onedrive';
    }

    return null;
}


/*
|--------------------------------------------------------------------------
| EXTRAI FILE ID DO GOOGLE DRIVE
|--------------------------------------------------------------------------
*/

function v_dicom_extract_google_file_id($url)
{
    $parts = wp_parse_url($url);

    if (!$parts) {
        return null;
    }


    /*
     * /file/d/FILE_ID/view
     */

    if (!empty($parts['path'])) {

        $patterns = [

            '~/(?:file/d|document/d|spreadsheets/d|presentation/d)/([a-zA-Z0-9_-]+)~',

            '~^/uc/([a-zA-Z0-9_-]+)$~',

        ];

        foreach ($patterns as $pattern) {

            if (
                preg_match(
                    $pattern,
                    $parts['path'],
                    $match
                )
            ) {
                return $match[1];
            }
        }
    }


    /*
     * ?id=FILE_ID
     */

    if (!empty($parts['query'])) {

        parse_str(
            $parts['query'],
            $query
        );

        if (
            !empty($query['id'])
        ) {
            return $query['id'];
        }
    }

    return null;
}


/*
|--------------------------------------------------------------------------
| CURL JSON
|--------------------------------------------------------------------------
*/

function v_dicom_curl_json(
    $url,
    $headers = [],
    $method = 'GET',
    $postData = null
) {

    global $v_dicom_user_agent;

    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_init -- cURL required for streaming/cookies/header capture
    $ch = curl_init($url);

    $options = [

        CURLOPT_RETURNTRANSFER => true,

        CURLOPT_FOLLOWLOCATION => true,

        CURLOPT_MAXREDIRS => 20,

        CURLOPT_CONNECTTIMEOUT => 30,

        CURLOPT_TIMEOUT => 60,

        CURLOPT_USERAGENT => $v_dicom_user_agent,

        CURLOPT_ENCODING => '',

        CURLOPT_SSL_VERIFYPEER => true,

        CURLOPT_SSL_VERIFYHOST => 2,

        CURLOPT_HTTPHEADER => $headers,

    ];


    if ($method === 'POST') {

        $options[CURLOPT_POST] = true;

        if ($postData !== null) {

            $options[CURLOPT_POSTFIELDS] =
                is_string($postData)
                    ? $postData
                    : json_encode($postData);
        }
    }


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt_array -- cURL required for streaming/cookies/header capture
    curl_setopt_array(
        $ch,
        $options
    );


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_exec -- cURL required for streaming/cookies/header capture
    $body = curl_exec($ch);

    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
    $info = curl_getinfo($ch);

    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_error -- cURL required for streaming/cookies/header capture
    $error = curl_error($ch);

    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_errno -- cURL required for streaming/cookies/header capture
    $errno = curl_errno($ch);


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_close -- cURL required for streaming/cookies/header capture
    curl_close($ch);


    return [
        'body' => $body,
        'info' => $info,
        'error' => $error,
        'errno' => $errno,
    ];
}


/*
|--------------------------------------------------------------------------
| ENCODE SHARE URL
|--------------------------------------------------------------------------
*/

function v_dicom_encode_onedrive_share_url($url)
{
    $encoded =
        base64_encode($url);

    $encoded =
        rtrim($encoded, '=');

    $encoded =
        strtr(
            $encoded,
            '+/',
            '-_'
        );

    return $encoded;
}


/*
|--------------------------------------------------------------------------
| RESOLVE ONE DRIVE
|
| Precisamos obter a URL final para pegar o "redeem".
|--------------------------------------------------------------------------
*/

function v_dicom_resolve_url($url)
{
    global $v_dicom_user_agent;

    $current = $url;

    for ($i = 0; $i < 10; $i++) {



        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_init -- cURL required for streaming/cookies/header capture
        $ch = curl_init($current);


        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt_array -- cURL required for streaming/cookies/header capture
        curl_setopt_array($ch, [

            CURLOPT_RETURNTRANSFER => true,

            CURLOPT_HEADER => true,

            CURLOPT_FOLLOWLOCATION => false,

            CURLOPT_CONNECTTIMEOUT => 30,

            CURLOPT_TIMEOUT => 30,

            CURLOPT_USERAGENT => $v_dicom_user_agent,

            CURLOPT_HTTPHEADER => [
                'Accept: */*',
            ],

            CURLOPT_ENCODING => '',

            CURLOPT_SSL_VERIFYPEER => true,

            CURLOPT_SSL_VERIFYHOST => 2,

        ]);


        $response =
            // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_exec -- cURL required for streaming/cookies/header capture
            curl_exec($ch);


        if ($response === false) {

            $error =
                // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_error -- cURL required for streaming/cookies/header capture
                curl_error($ch);

            // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_close -- cURL required for streaming/cookies/header capture
            curl_close($ch);

            v_dicom_error_response(
                502,
                __( 'Erro ao resolver OneDrive: ', 'v-dicom' ) .
                $error
            );
        }


        $httpCode =
            // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
            curl_getinfo(
                $ch,
                CURLINFO_HTTP_CODE
            );


        $headerSize =
            // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
            curl_getinfo(
                $ch,
                CURLINFO_HEADER_SIZE
            );


        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_close -- cURL required for streaming/cookies/header capture
        curl_close($ch);


        $headers =
            substr(
                $response,
                0,
                $headerSize
            );


        /*
         * Location
         */

        $location = null;


        if (
            preg_match(
                '/^Location:\s*(.+)$/im',
                $headers,
                $match
            )
        ) {

            $location =
                trim($match[1]);
        }




        if (!$location) {

            /*
             * Chegamos à URL final.
             */

            return $current;
        }


        /*
         * Location pode ser relativo.
         */

        if (
            stripos(
                $location,
                'http://'
            ) !== 0 &&
            stripos(
                $location,
                'https://'
            ) !== 0
        ) {

            $base =
                wp_parse_url($current);

            if (
                !$base ||
                empty($base['scheme']) ||
                empty($base['host'])
            ) {
                v_dicom_error_response(
                    502,
                    __( 'Redirect inválido do OneDrive.', 'v-dicom' )
                );
            }


            $origin =
                $base['scheme'] .
                '://' .
                $base['host'];


            if (
                strpos(
                    $location,
                    '/'
                ) === 0
            ) {

                $location =
                    $origin .
                    $location;

            } else {

                $path =
                    isset($base['path'])
                        ? dirname($base['path'])
                        : '/';

                $location =
                    $origin .
                    '/' .
                    ltrim(
                        $path .
                        '/' .
                        $location,
                        '/'
                    );
            }
        }


        $current =
            html_entity_decode(
                $location,
                ENT_QUOTES | ENT_HTML5,
                'UTF-8'
            );
    }


    return $current;
}


/*
|--------------------------------------------------------------------------
| BADGER TOKEN
|--------------------------------------------------------------------------
*/

function v_dicom_get_badger_token()
{


    $response =
        v_dicom_curl_json(
            'https://api-badgerp.svc.ms/v1.0/token',
            [
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            'POST',
            [
                'appId' =>
                    '5cbed6ac-a083-4e14-b191-b4ba07653de2',
            ]
        );


    if (
        $response['body'] === false
    ) {

        v_dicom_error_response(
            502,
            __( 'Não foi possível obter o token do OneDrive.', 'v-dicom' )
        );
    }


    $json =
        json_decode(
            $response['body'],
            true
        );


    if (
        !is_array($json) ||
        empty($json['token'])
    ) {



        v_dicom_error_response(
            502,
            __( 'Microsoft não forneceu o token Badger.', 'v-dicom' )
        );
    }




    return $json['token'];
}


/*
|--------------------------------------------------------------------------
| OBTÉM INFORMAÇÕES DO ONEDRIVE
|--------------------------------------------------------------------------
*/

function v_dicom_get_onedrive_info($url)
{
    /*
     * Primeiro resolvemos redirects.
     */

    $finalUrl =
        v_dicom_resolve_url($url);




    /*
     * Pega query.
     */

    $parts =
        wp_parse_url($finalUrl);


    $query = [];


    if (
        !empty($parts['query'])
    ) {

        parse_str(
            $parts['query'],
            $query
        );
    }


    /*
     * Novo OneDrive usa "redeem".
     */

    $redeem =
        isset($query['redeem'])
            ? $query['redeem']
            : '';


    /*
     * Caso antigo com authkey/resid.
     */

    if (
        $redeem === '' &&
        !empty($query['resid']) &&
        !empty($query['authkey'])
    ) {

        $downloadUrl =
            'https://onedrive.live.com/download?' .
            http_build_query([
                'cid' =>
                    $query['cid'] ?? '',
                'resid' =>
                    $query['resid'],
                'authkey' =>
                    $query['authkey'],
            ]);


        return [
            'downloadUrl' =>
                $downloadUrl,

            'filename' =>
                __( 'arquivo', 'v-dicom' ),

            'size' =>
                0,
        ];
    }


    if ($redeem === '') {

        v_dicom_error_response(
            502,
            __( 'Não foi possível obter o redeem do OneDrive.', 'v-dicom' )
        );
    }


    /*
     * O redeem já é Base64URL.
     *
     * NÃO codificamos novamente.
     */

    $shareId =
        'u!' .
        $redeem;




    /*
     * Badger.
     */

    $badgerToken =
        v_dicom_get_badger_token();


    /*
     * Endpoint de personal content.
     */

    $endpoint =
        'https://my.microsoftpersonalcontent.com' .
        '/_api/v2.0/shares/' .
        rawurlencode($shareId) .
        '/driveitem';


    $endpoint .=
        '?$select=' .
        rawurlencode(
            'id,name,size,@content.downloadUrl,@microsoft.graph.downloadUrl,parentReference,file'
        );




    $response =
        v_dicom_curl_json(
            $endpoint,
            [
                'Accept: application/json',

                'Authorization: Badger ' .
                $badgerToken,

                'Prefer: autoredeem',

                'Origin: https://onedrive.live.com',

                'Referer: https://onedrive.live.com/',
            ]
        );


    $httpCode =
        $response['info']['http_code'] ?? 0;




    if (
        $response['body'] === false
    ) {

        v_dicom_error_response(
            502,
            __( 'Falha ao consultar o arquivo no OneDrive.', 'v-dicom' )
        );
    }


    $json =
        json_decode(
            $response['body'],
            true
        );


    if (
        !is_array($json)
    ) {



        v_dicom_error_response(
            502,
            __( 'Resposta inválida do OneDrive.', 'v-dicom' )
        );
    }


    if (
        !empty($json['error'])
    ) {



        v_dicom_error_response(
            502,
            __( 'OneDrive recusou o acesso ao arquivo.', 'v-dicom' )
        );
    }


    /*
     * Download URL.
     */

    $downloadUrl = '';


    if (
        !empty(
            $json['@content.downloadUrl']
        )
    ) {

        $downloadUrl =
            $json['@content.downloadUrl'];
    }


    if (
        !$downloadUrl &&
        !empty(
            $json['@microsoft.graph.downloadUrl']
        )
    ) {

        $downloadUrl =
            $json['@microsoft.graph.downloadUrl'];
    }


    if (!$downloadUrl) {




        v_dicom_error_response(
            502,
            __( 'OneDrive não retornou URL de download.', 'v-dicom' )
        );
    }


    $filename =
        !empty($json['name'])
            ? $json['name']
            : __( 'arquivo', 'v-dicom' );


    $size =
        isset($json['size'])
            ? (int)$json['size']
            : 0;


    return [
        'downloadUrl' =>
            $downloadUrl,

        'filename' =>
            $filename,

        'size' =>
            $size,
    ];
}


/*
|--------------------------------------------------------------------------
| GOOGLE — HEADERS DE PROBE
|--------------------------------------------------------------------------
*/

function v_dicom_google_probe($url, $cookieFile)
{
    global $v_dicom_user_agent;

    $contentType = '';

    $contentLength = '';

    $contentDisposition = '';

    $body = '';

    $maxBody =
        512 * 1024;


    $ch =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_init -- cURL required for streaming/cookies/header capture
        curl_init($url);


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt_array -- cURL required for streaming/cookies/header capture
    curl_setopt_array($ch, [

        CURLOPT_RETURNTRANSFER => false,

        CURLOPT_FOLLOWLOCATION => true,

        CURLOPT_MAXREDIRS => 20,

        CURLOPT_CONNECTTIMEOUT => 30,

        CURLOPT_TIMEOUT => 60,

        CURLOPT_USERAGENT => $v_dicom_user_agent,

        CURLOPT_ENCODING => '',

        CURLOPT_COOKIEJAR => $cookieFile,

        CURLOPT_COOKIEFILE => $cookieFile,

        CURLOPT_SSL_VERIFYPEER => true,

        CURLOPT_SSL_VERIFYHOST => 2,


        CURLOPT_HEADERFUNCTION =>
            function (
                $ch,
                $header
            ) use (
                &$contentType,
                &$contentLength,
                &$contentDisposition
            ) {

                $line =
                    trim($header);


                if (
                    stripos(
                        $line,
                        'Content-Type:'
                    ) === 0
                ) {

                    $contentType =
                        trim(
                            substr(
                                $line,
                                strlen('Content-Type:')
                            )
                        );
                }


                if (
                    stripos(
                        $line,
                        'Content-Length:'
                    ) === 0
                ) {

                    $contentLength =
                        trim(
                            substr(
                                $line,
                                strlen('Content-Length:')
                            )
                        );
                }


                if (
                    stripos(
                        $line,
                        'Content-Disposition:'
                    ) === 0
                ) {

                    $contentDisposition =
                        trim(
                            substr(
                                $line,
                                strlen('Content-Disposition:')
                            )
                        );
                }


                return strlen($header);
            },


        CURLOPT_WRITEFUNCTION =>
            function (
                $ch,
                $data
            ) use (
                &$body,
                $maxBody
            ) {

                $remaining =
                    $maxBody -
                    strlen($body);


                if ($remaining <= 0) {

                    /*
                     * Interrompe a requisição.
                     *
                     * Isso é proposital.
                     */

                    return 0;
                }


                $body .=
                    substr(
                        $data,
                        0,
                        $remaining
                    );


                if (
                    strlen($body) >=
                    $maxBody
                ) {

                    return 0;
                }


                return strlen($data);
            },

    ]);


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_exec -- cURL required for streaming/cookies/header capture
    curl_exec($ch);


    $httpCode =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_HTTP_CODE
        );


    $effectiveUrl =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_EFFECTIVE_URL
        );


    $curlError =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_error -- cURL required for streaming/cookies/header capture
        curl_error($ch);


    $curlErrno =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_errno -- cURL required for streaming/cookies/header capture
        curl_errno($ch);


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_close -- cURL required for streaming/cookies/header capture
    curl_close($ch);


    /*
     * CURLE_WRITE_ERROR (23) é esperado quando
     * interrompemos o probe.
     */

    if (
        $curlErrno &&
        $curlErrno !== 23
    ) {

    }


    return [
        'httpCode' =>
            $httpCode,

        'contentType' =>
            $contentType,

        'contentLength' =>
            $contentLength,

        'contentDisposition' =>
            $contentDisposition,

        'effectiveUrl' =>
            $effectiveUrl,

        'body' =>
            $body,
    ];
}


/*
|--------------------------------------------------------------------------
| GOOGLE — TOKEN DE CONFIRMAÇÃO
|--------------------------------------------------------------------------
*/

function v_dicom_extract_google_confirm_token($html)
{
    $patterns = [

        '/[?&]confirm=([a-zA-Z0-9_-]+)/i',

        '/confirm%3D([a-zA-Z0-9_-]+)/i',

        '/name=["\']confirm["\']\s+value=["\']([^"\']+)/i',

        '/name=["\']confirm["\'][^>]+value=["\']([^"\']+)/i',

    ];


    foreach ($patterns as $pattern) {

        if (
            preg_match(
                $pattern,
                $html,
                $match
            )
        ) {

            return $match[1];
        }
    }


    return null;
}


/*
|--------------------------------------------------------------------------
| GOOGLE — UUID
|--------------------------------------------------------------------------
*/

function v_dicom_extract_google_uuid($html)
{
    if (
        preg_match(
            '/[?&]uuid=([a-zA-Z0-9-]+)/i',
            $html,
            $match
        )
    ) {

        return $match[1];
    }


    if (
        preg_match(
            '/uuid%3D([a-zA-Z0-9-]+)/i',
            $html,
            $match
        )
    ) {

        return $match[1];
    }


    return null;
}


/*
|--------------------------------------------------------------------------
| GOOGLE — NOME
|--------------------------------------------------------------------------
*/

function v_dicom_extract_filename_from_disposition($disposition)
{
    if (!$disposition) {
        return null;
    }


    if (
        preg_match(
            '/filename\*=UTF-8\'\'([^;]+)/i',
            $disposition,
            $match
        )
    ) {

        return urldecode(
            trim(
                $match[1],
                '" '
            )
        );
    }


    if (
        preg_match(
            '/filename="([^"]+)"/i',
            $disposition,
            $match
        )
    ) {

        return $match[1];
    }


    if (
        preg_match(
            '/filename=([^;]+)/i',
            $disposition,
            $match
        )
    ) {

        return trim(
            $match[1],
            '" '
        );
    }


    return null;
}


/*
|--------------------------------------------------------------------------
| GOOGLE — OBTÉM URL DE DOWNLOAD
|--------------------------------------------------------------------------
*/

function v_dicom_get_google_info($url)
{
    $fileId =
        v_dicom_extract_google_file_id($url);


    if (!$fileId) {

        v_dicom_error_response(
            400,
            __( 'Não foi possível identificar o ID do Google Drive.', 'v-dicom' )
        );
    }




    /*
     * Cookie para confirmação.
     */

    $cookieFile =
        sys_get_temp_dir() .
        '/gdrive_' .
        md5(
            uniqid(
                '',
                true
            )
        ) .
        '.cookie';


    global $wp_filesystem;
    if ( empty( $wp_filesystem ) ) {
        require_once ABSPATH . 'wp-admin/includes/file.php';
        WP_Filesystem();
    }
    $wp_filesystem->touch( $cookieFile );


    /*
     * Primeiro usamos o endpoint moderno.
     */

    $downloadUrl =
        'https://drive.usercontent.google.com/download?' .
        http_build_query([
            'id' =>
                $fileId,

            'export' =>
                'download',
        ]);




    /*
     * Probe.
     */

    $probe =
        v_dicom_google_probe(
            $downloadUrl,
            $cookieFile
        );





    $isHtml =
        stripos(
            $probe['contentType'],
            'text/html'
        ) !== false;


    /*
     * Caso o header não tenha informado HTML,
     * verifica o conteúdo capturado.
     */

    if (!$isHtml) {

        $sample =
            ltrim(
                $probe['body']
            );


        if (
            stripos(
                $sample,
                '<!doctype html'
            ) === 0 ||
            stripos(
                $sample,
                '<html'
            ) === 0 ||
            stripos(
                $sample,
                '<form'
            ) === 0
        ) {

            $isHtml = true;
        }
    }


    /*
     * Se já é arquivo, pronto.
     */

    if (
        !$isHtml &&
        $probe['httpCode'] >= 200 &&
        $probe['httpCode'] < 400
    ) {

        $filename =
            v_dicom_extract_filename_from_disposition(
                $probe['contentDisposition']
            );


        if (!$filename) {

            $filename =
                __( 'arquivo', 'v-dicom' );
        }


        return [
            'downloadUrl' =>
                $downloadUrl,

            'filename' =>
                $filename,

            'size' =>
                (int)(
                    $probe['contentLength']
                    ?: 0
                ),

            'cookieFile' =>
                $cookieFile,
        ];
    }


    /*
     * Google enviou página HTML.
     */



    $confirm =
        v_dicom_extract_google_confirm_token(
            $probe['body']
        );


    $uuid =
        v_dicom_extract_google_uuid(
            $probe['body']
        );


    if ($confirm) {

    } else {

    }


    if ($uuid) {

    }


    /*
     * Monta URL confirmada.
     */

    $params = [

        'id' =>
            $fileId,

        'export' =>
            'download',

        'confirm' =>
            $confirm ?: 't',

    ];


    if ($uuid) {
        $params['uuid'] = $uuid;
    }


    $confirmedUrl =
        'https://drive.usercontent.google.com/download?' .
        http_build_query($params);




    /*
     * Probe novamente.
     */

    $probe2 =
        v_dicom_google_probe(
            $confirmedUrl,
            $cookieFile
        );





    $isHtml2 =
        stripos(
            $probe2['contentType'],
            'text/html'
        ) !== false;


    if (!$isHtml2) {

        $sample =
            ltrim(
                $probe2['body']
            );


        if (
            stripos(
                $sample,
                '<!doctype html'
            ) === 0 ||
            stripos(
                $sample,
                '<html'
            ) === 0
        ) {

            $isHtml2 = true;
        }
    }


    if (
        !$isHtml2 &&
        $probe2['httpCode'] >= 200 &&
        $probe2['httpCode'] < 400
    ) {

        $filename =
            v_dicom_extract_filename_from_disposition(
                $probe2['contentDisposition']
            );


        if (!$filename) {
            $filename = __( 'arquivo', 'v-dicom' );
        }


        return [
            'downloadUrl' =>
                $confirmedUrl,

            'filename' =>
                $filename,

            'size' =>
                (int)(
                    $probe2['contentLength']
                    ?: 0
                ),

            'cookieFile' =>
                $cookieFile,
        ];
    }


    /*
     * Última tentativa usando drive.google.com/uc
     */



    $fallbackUrl =
        'https://drive.google.com/uc?' .
        http_build_query([
            'export' =>
                'download',

            'id' =>
                $fileId,
        ]);


    $probe3 =
        v_dicom_google_probe(
            $fallbackUrl,
            $cookieFile
        );


    $isHtml3 =
        stripos(
            $probe3['contentType'],
            'text/html'
        ) !== false;


    if (!$isHtml3) {

        $sample =
            ltrim(
                $probe3['body']
            );


        if (
            stripos(
                $sample,
                '<!doctype html'
            ) === 0 ||
            stripos(
                $sample,
                '<html'
            ) === 0
        ) {

            $isHtml3 = true;
        }
    }


    if (
        !$isHtml3 &&
        $probe3['httpCode'] >= 200 &&
        $probe3['httpCode'] < 400
    ) {

        $filename =
            v_dicom_extract_filename_from_disposition(
                $probe3['contentDisposition']
            );


        if (!$filename) {
            $filename = __( 'arquivo', 'v-dicom' );
        }


        return [
            'downloadUrl' =>
                $fallbackUrl,

            'filename' =>
                $filename,

            'size' =>
                (int)(
                    $probe3['contentLength']
                    ?: 0
                ),

            'cookieFile' =>
                $cookieFile,
        ];
    }


    wp_delete_file(
        $cookieFile
    );


    v_dicom_error_response(
        502,
        __( 'O Google Drive não forneceu um download direto. O arquivo pode exigir login, ter o download desativado ou estar sujeito a uma confirmação que o Google não permitiu resolver automaticamente.', 'v-dicom' )
    );
}


/*
|--------------------------------------------------------------------------
| STREAM FINAL
|--------------------------------------------------------------------------
*/

function v_dicom_stream_file(
    $downloadUrl,
    $filename,
    $size = 0,
    $cookieFile = null,
    $referer = null
) {

    global $v_dicom_user_agent;


    /*
     * Nome seguro.
     */

    $filename =
        basename(
            $filename
        );


    if (
        $filename === '' ||
        $filename === '.' ||
        $filename === '..'
    ) {
        $filename =
            __( 'arquivo', 'v-dicom' );
    }


    $filenameAscii =
        preg_replace(
            '/[^\x20-\x7E]/',
            '_',
            $filename
        );


    $filenameAscii =
        str_replace(
            ['"', '\\'],
            '_',
            $filenameAscii
        );


    if (
        $filenameAscii === ''
    ) {
        $filenameAscii =
            __( 'arquivo', 'v-dicom' );
    }


    /*
     * Limpa buffers PHP.
     */

    while (
        ob_get_level() > 0
    ) {
        ob_end_clean();
    }


    /*
     * Headers do navegador.
     */

    header(
        'Content-Type: application/octet-stream'
    );


    header(
        'Content-Disposition: attachment; filename="' .
        $filenameAscii .
        '"; filename*=UTF-8\'\'' .
        rawurlencode($filename)
    );


    if ($size > 0) {

        header(
            'Content-Length: ' .
            $size
        );
    }


    header(
        'Cache-Control: no-cache, no-store, must-revalidate'
    );

    header(
        'Pragma: no-cache'
    );

    header(
        'Expires: 0'
    );


    /*
     * CURL streaming.
     */

    $receivedBytes = 0;


    $ch =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_init -- cURL required for streaming/cookies/header capture
        curl_init(
            $downloadUrl
        );


    $headers = [
        'Accept: */*',
    ];


    if ($referer) {

        $headers[] =
            'Referer: ' .
            $referer;
    }


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt_array -- cURL required for streaming/cookies/header capture
    curl_setopt_array($ch, [

        CURLOPT_RETURNTRANSFER => false,

        CURLOPT_FOLLOWLOCATION => true,

        CURLOPT_MAXREDIRS => 20,

        CURLOPT_CONNECTTIMEOUT => 30,

        CURLOPT_TIMEOUT => 0,

        CURLOPT_USERAGENT => $v_dicom_user_agent,

        CURLOPT_HTTPHEADER =>
            $headers,

        CURLOPT_ENCODING => '',

        CURLOPT_SSL_VERIFYPEER => true,

        CURLOPT_SSL_VERIFYHOST => 2,

        /*
         * Cookies Google.
         */

        CURLOPT_COOKIEFILE =>
            $cookieFile ?: '',

        CURLOPT_COOKIEJAR =>
            $cookieFile ?: '',


        /*
         * Headers do servidor remoto.
         */

        CURLOPT_HEADERFUNCTION =>
            function (
                $ch,
                $header
            ) {

                return strlen($header);
            },


        /*
         * STREAM.
         */

        CURLOPT_WRITEFUNCTION =>
            function (
                $ch,
                $data
            ) use (
                &$receivedBytes
            ) {

                $length =
                    strlen($data);


                $receivedBytes +=
                    $length;


                // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- streams remote file bytes
                echo $data;


                flush();


                return $length;
            },

    ]);


    $result =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_exec -- cURL required for streaming/cookies/header capture
        curl_exec($ch);


    /*
     * Informações.
     */

    $errno =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_errno -- cURL required for streaming/cookies/header capture
        curl_errno($ch);

    $error =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_error -- cURL required for streaming/cookies/header capture
        curl_error($ch);

    $httpCode =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_HTTP_CODE
        );

    $finalUrl =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_EFFECTIVE_URL
        );

    $curlSize =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_SIZE_DOWNLOAD
        );

    $contentType =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_CONTENT_TYPE
        );

    $totalTime =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_TOTAL_TIME
        );

    $redirects =
        // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- cURL required for streaming/cookies/header capture
        curl_getinfo(
            $ch,
            CURLINFO_REDIRECT_COUNT
        );


    // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_close -- cURL required for streaming/cookies/header capture
    curl_close($ch);












    if ($result === false) {


    } else {

    }




    if ($cookieFile) {
        wp_delete_file($cookieFile);
    }


    exit;
}


/*
|--------------------------------------------------------------------------
| INÍCIO
|--------------------------------------------------------------------------
*/





/*
|--------------------------------------------------------------------------
| URL
|--------------------------------------------------------------------------
*/

// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only proxy endpoint
$v_dicom_url = isset( $_GET['url'] ) ? esc_url_raw( wp_unslash( $_GET['url'] ) ) : '';


if ($v_dicom_url === '') {

    v_dicom_error_response(
        400,
        __( 'Informe ?url=', 'v-dicom' )
    );
}


if (
    !filter_var(
        $v_dicom_url,
        FILTER_VALIDATE_URL
    )
) {

    v_dicom_error_response(
        400,
        __( 'URL inválida.', 'v-dicom' )
    );
}


$v_dicom_scheme =
    strtolower(
        wp_parse_url(
            $v_dicom_url,
            PHP_URL_SCHEME
        )
    );


if (
    !in_array(
        $v_dicom_scheme,
        ['http', 'https'],
        true
    )
) {

    v_dicom_error_response(
        400,
        __( 'Somente HTTP/HTTPS é permitido.', 'v-dicom' )
    );
}


/*
|--------------------------------------------------------------------------
| AUTORIZA A REQUISIÇÃO
|
| O proxy só deve ser consumido pelo próprio viewer (que envia o
| _wpnonce gerado no frontend) ou por integrações server-to-server
| autenticadas com a API key do plugin (ex.: RunPod baixando a cena).
|--------------------------------------------------------------------------
*/

$v_dicom_nonce =
    isset($_GET['_wpnonce'])
        ? sanitize_text_field(wp_unslash($_GET['_wpnonce']))
        : '';

$v_dicom_apikey =
    isset($_GET['apikey'])
        ? sanitize_text_field(wp_unslash($_GET['apikey']))
        : '';

$v_dicom_apikey_ok = false;

if ('' !== $v_dicom_apikey) {

    $v_dicom_stored_apikey = V_Dicom_Storage::api_key();

    if ('' !== $v_dicom_stored_apikey) {
        $v_dicom_apikey_ok = hash_equals(
            $v_dicom_stored_apikey,
            $v_dicom_apikey
        );
    }
}

if (
    !wp_verify_nonce($v_dicom_nonce, 'wp_rest') &&
    !$v_dicom_apikey_ok
) {
    v_dicom_error_response(
        403,
        __( 'Requisição não autorizada.', 'v-dicom' )
    );
}


/*
|--------------------------------------------------------------------------
| DETECTA SERVIÇO
|--------------------------------------------------------------------------
*/

$v_dicom_service =
    v_dicom_detect_service($v_dicom_url);


if (!$v_dicom_service) {

    v_dicom_error_response(
        400,
        __( 'Link não reconhecido. Use Google Drive ou OneDrive.', 'v-dicom' )
    );
}




/*
|--------------------------------------------------------------------------
| VERIFICA AUTORIZAÇÃO DA URL
|
| A URL deve estar pré-autorizada (via endpoint REST /authorized-url,
| que consome 1 crédito) antes de ser baixada. Se já autorizada,
| v_dicom_is_url_authorized() incrementa o contador e retorna true. Caso
| contrário, recusamos o download para que o frontend possa solicitar
| a autorização.
|
| O administrador pode desativar a exigência de autorização pelo
| painel (v_dicom_url_auth_enabled). Quando desativado, todas as
| URLs são liberadas sem verificação.
|--------------------------------------------------------------------------
*/

if (V_Dicom_Storage::url_auth_enabled() && !v_dicom_is_url_authorized($v_dicom_url)) {

    if (!headers_sent()) {
        http_response_code(403);
        header('Content-Type: application/json; charset=UTF-8');
    }

    echo json_encode([
        'error' => 'url_not_authorized',
        'message' => __( 'Esta URL precisa ser autorizada antes de ser baixada. Consulte o endpoint /wp-json/v-dicom/v1/authorized-url.', 'v-dicom' ),
    ]);

    exit;
}



/*
|--------------------------------------------------------------------------
| GOOGLE
|--------------------------------------------------------------------------
*/

if ($v_dicom_service === 'google') {

    $v_dicom_info =
        v_dicom_get_google_info(
            $v_dicom_url
        );





    v_dicom_stream_file(
        $v_dicom_info['downloadUrl'],
        $v_dicom_info['filename'],
        $v_dicom_info['size'],
        $v_dicom_info['cookieFile']
    );
}


/*
|--------------------------------------------------------------------------
| ONEDRIVE
|--------------------------------------------------------------------------
*/

if ($v_dicom_service === 'onedrive') {

    $v_dicom_info =
        v_dicom_get_onedrive_info(
            $v_dicom_url
        );





    v_dicom_stream_file(
        $v_dicom_info['downloadUrl'],
        $v_dicom_info['filename'],
        $v_dicom_info['size']
    );
}


exit;