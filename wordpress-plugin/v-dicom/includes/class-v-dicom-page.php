<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Standalone viewer page.
 *
 * Registers /v-dicom/ (and /v-dicom/<scene-key>/) and renders a full
 * HTML document built by the plugin itself — the active theme is never loaded,
 * so the React app owns the whole viewport.
 */
class V_Dicom_Page {

	const SLUG = 'v-dicom';

	public function __construct() {
		add_action( 'init', array( $this, 'rewrites' ) );
		add_filter( 'query_vars', array( $this, 'query_vars' ) );
		add_action( 'template_redirect', array( $this, 'legacy_redirect' ), 1 );
		add_action( 'template_redirect', array( $this, 'maybe_render' ), 5 );
	}

	/**
	 * 301-redirect the legacy "visordicom" URLs to the new "v-dicom" ones so
	 * links shared before the rename keep working.
	 */
	public function legacy_redirect() {
		// Legacy query-string URLs (plain permalinks): /?visordicom_app=1 ...
		if ( isset( $_GET['visordicom_manifest'] ) ) {
			wp_safe_redirect( self::manifest_url(), 301 );
			exit;
		}
		if ( isset( $_GET['visordicom_sw'] ) ) {
			wp_safe_redirect( self::sw_url(), 301 );
			exit;
		}
		if ( isset( $_GET['visordicom_app'] ) || isset( $_GET['visordicom_scene'] ) ) {
			$key = isset( $_GET['visordicom_scene'] ) ? V_Dicom_Storage::sanitize_key( wp_unslash( $_GET['visordicom_scene'] ) ) : '';
			wp_safe_redirect( self::url( $key ), 301 );
			exit;
		}

		// Legacy path URLs (pretty permalinks): /visordicom/... 
		$request   = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path      = (string) wp_parse_url( $request, PHP_URL_PATH );
		$home_path = (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		if ( '' !== $home_path && '/' !== $home_path && 0 === strpos( $path, $home_path ) ) {
			$path = substr( $path, strlen( $home_path ) );
		}
		$path = '/' . ltrim( $path, '/' );
		if ( 0 !== strpos( $path, '/visordicom' ) ) {
			return;
		}
		$rest = ltrim( substr( $path, strlen( '/visordicom' ) ), '/' );

		if ( 0 === strpos( $rest, 'sw.js' ) ) {
			wp_safe_redirect( self::sw_url(), 301 );
			exit;
		}
		if ( 0 === strpos( $rest, 'manifest.webmanifest' ) ) {
			wp_safe_redirect( self::manifest_url(), 301 );
			exit;
		}

		$key = '' === $rest ? '' : V_Dicom_Storage::sanitize_key( (string) strtok( $rest, '/' ) );
		wp_safe_redirect( self::url( $key ), 301 );
		exit;
	}

	public function rewrites() {
		add_rewrite_rule( '^' . self::SLUG . '/?$', 'index.php?v_dicom_app=1', 'top' );
		add_rewrite_rule( '^' . self::SLUG . '/([a-z0-9]+)/?$', 'index.php?v_dicom_app=1&v_dicom_scene=$matches[1]', 'top' );
		add_rewrite_rule( '^' . self::SLUG . '/manifest\.webmanifest$', 'index.php?v_dicom_manifest=1', 'top' );
		add_rewrite_rule( '^' . self::SLUG . '/sw\.js$', 'index.php?v_dicom_sw=1', 'top' );
	}

	public function query_vars( $vars ) {
		$vars[] = 'v_dicom_app';
		$vars[] = 'v_dicom_scene';
		$vars[] = 'v_dicom_manifest';
		$vars[] = 'v_dicom_sw';
		return $vars;
	}

	/** Public URL of the standalone viewer, optionally for one scene. */
	public static function url( $key = '' ) {
		$key = V_Dicom_Storage::sanitize_key( $key );
		if ( get_option( 'permalink_structure' ) ) {
			return home_url( '/' . self::SLUG . '/' . ( $key ? $key . '/' : '' ) );
		}
		$args = array( 'v_dicom_app' => 1 );
		if ( $key ) {
			$args['v_dicom_scene'] = $key;
		}
		return add_query_arg( $args, home_url( '/' ) );
	}

	/** URL of the PWA manifest (rewrite when permalinks are pretty). */
	private static function manifest_url() {
		if ( get_option( 'permalink_structure' ) ) {
			return home_url( '/' . self::SLUG . '/manifest.webmanifest' );
		}
		return add_query_arg( 'v_dicom_manifest', '1', home_url( '/' ) );
	}

	/** URL of the service worker (rewrite when permalinks are pretty). */
	private static function sw_url() {
		if ( get_option( 'permalink_structure' ) ) {
			return home_url( '/' . self::SLUG . '/sw.js' );
		}
		return add_query_arg( 'v_dicom_sw', '1', home_url( '/' ) );
	}

	/** URL of a bundled icon asset (PNG/SVG/ICO under icon/). */
	private static function icon_url( $file = 'icon.svg' ) {
		return V_DICOM_URL . 'icon/' . $file;
	}

	/** Criptografa uma string com AES-256-CBC usando o domínio como chave. */
	private static function encrypt_config( $plain, $key ) {
		$plain  = wp_json_encode( $plain );
		$key    = hash( 'sha256', wp_parse_url( $key, PHP_URL_HOST ) ?: $key, true );
		$iv     = substr( hash( 'sha256', wp_salt( 'auth' ) . microtime( true ), true ), 0, 16 );
		$cipher = openssl_encrypt( $plain, 'aes-256-cbc', $key, 0, $iv );
		return array( 'e' => 1, 'iv' => base64_encode( $iv ), 'd' => $cipher );
	}

	/**
	 * Retorna o limite de upload efetivo em bytes.
	 * Considera upload_max_filesize e post_max_size, pega o menor dos dois.
	 * Se não conseguir ler, retorna 0 (sem limite conhecido).
	 */
	public static function get_upload_limit() {
		$ini_max  = self::parse_size_ini( ini_get( 'upload_max_filesize' ) );
		$post_max = self::parse_size_ini( ini_get( 'post_max_size' ) );
		$memory   = self::parse_size_ini( ini_get( 'memory_limit' ) );

		$limit = PHP_INT_MAX;
		if ( $ini_max > 0 ) {
			$limit = min( $limit, $ini_max );
		}
		if ( $post_max > 0 ) {
			$limit = min( $limit, $post_max );
		}
		if ( $memory > 0 ) {
			$limit = min( $limit, $memory );
		}
		if ( $limit === PHP_INT_MAX ) {
			return 0;
		}
		// Margem de segurança de 5 MB para cabeçalhos multipart, etc.
		return max( 0, $limit - 5 * 1024 * 1024 );
	}

	private static function parse_size_ini( $value ) {
		if ( empty( $value ) ) {
			return 0;
		}
		$value = trim( $value );
		$last  = strtolower( $value[ strlen( $value ) - 1 ] );
		$num   = (int) $value;
		switch ( $last ) {
			case 'g':
				$num *= 1024;
				// no break
			case 'm':
				$num *= 1024;
				// no break
			case 'k':
				$num *= 1024;
		}
		return $num;
	}

	/** Serves the PWA webmanifest with white-label colors. */
	private function send_manifest() {
		$theme = V_Dicom_Theme::get();
		nocache_headers();
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		echo wp_json_encode(
			array(
				'name'            => $theme['name'],
				'short_name'      => $theme['name'],
				'description'     => __( 'Visualizador DICOM com cortes MPR, 3D e modelos STL.', 'v-dicom' ),
				'start_url'       => self::url(),
				'scope'           => get_option( 'permalink_structure' ) ? home_url( '/' . self::SLUG . '/' ) : home_url( '/' ),
				'display'         => 'standalone',
				'display_override' => array( 'standalone', 'minimal-ui' ),
				'orientation'     => 'any',
				'background_color' => $theme['background'] ? $theme['background'] : '#1d2440',
				'theme_color'     => $theme['accent'] ? $theme['accent'] : '#22d3ee',
				'prefer_related_applications' => false,
				// iOS ignores SVG for apple-touch-icon, so real PNGs ship in every
				// size Apple looks for — plus the Android/desktop manifest sizes
				// and a maskable variant for adaptive icons.
				'icons'           => array(
					array(
						'src'     => self::icon_url( 'icon-192x192.png' ),
						'sizes'   => '192x192',
						'type'    => 'image/png',
						'purpose' => 'any',
					),
					array(
						'src'     => self::icon_url( 'icon-512x512.png' ),
						'sizes'   => '512x512',
						'type'    => 'image/png',
						'purpose' => 'any',
					),
					array(
						'src'     => self::icon_url( 'maskable-512x512.png' ),
						'sizes'   => '512x512',
						'type'    => 'image/png',
						'purpose' => 'maskable',
					),
					array(
						'src'     => self::icon_url( 'icon.svg' ),
						'sizes'   => 'any',
						'type'    => 'image/svg+xml',
						'purpose' => 'any',
					),
				),
			)
		);
		exit;
	}

	/** Serves a minimal network-first service worker for app-shell caching. */
	private function send_sw() {
		nocache_headers();
		header( 'Content-Type: text/javascript; charset=utf-8' );
		$js = <<< 'SWJS'
const CACHE = 'v-dicom-shell-v1';
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only cache navigations of the viewer shell; never DICOM files or API calls.
  const isShell = url.pathname.indexOf('/v-dicom') === 0 && !url.searchParams.has('scene');
  if (!isShell || req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});
SWJS;
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- serves a static JS service-worker body.
		echo $js;
		exit;
	}

	public function maybe_render() {
		if ( get_query_var( 'v_dicom_manifest' ) ) {
			$this->send_manifest();
		}
		if ( get_query_var( 'v_dicom_sw' ) ) {
			$this->send_sw();
		}
		if ( ! get_query_var( 'v_dicom_app' ) ) {
			return;
		}

		$scene = V_Dicom_Storage::sanitize_key( get_query_var( 'v_dicom_scene' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only viewer route.
		if ( ! $scene && isset( $_GET['scene'] ) ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- read-only viewer route; sanitized via V_Dicom_Storage::sanitize_key().
			$scene = V_Dicom_Storage::sanitize_key( wp_unslash( $_GET['scene'] ) );
		}

		$theme = V_Dicom_Theme::get();
		$title = $theme['name'];
		if ( $scene ) {
			$post = V_Dicom_Storage::find_scene( $scene );
			if ( $post ) {
				$title = get_the_title( $post ) . ' — ' . $theme['name'];
			}
		}

$config = array(
			'restUrl'   => esc_url_raw( rest_url( V_Dicom_REST::NS ) ),
			'nonce'     => wp_create_nonce( 'wp_rest' ),
			'canUpload' => v_dicom_can_upload(),
			'sceneKey'  => $scene ? $scene : null,
			'homeUrl'   => esc_url_raw( home_url( '/' ) ),
			'viewerUrl' => esc_url_raw( self::url() ),
			'shareTemplate' => str_replace( 'zzkeyzz', 'ZZKEYZZ', esc_url_raw( self::url( 'zzkeyzz' ) ) ),
			'brand'     => array(
				'name'     => $theme['name'],
				'logo'     => $theme['logo'],
				'quizUrl'  => $theme['quiz_url'],
				'quizText' => $theme['quiz_text'],
			),
			// Login com retorno ao visualizador (mesma cena, quando houver).
			'loginUrl'  => esc_url_raw( wp_login_url( self::url( $scene ) ) ),
			// Upload limit: menor entre upload_max_filesize e post_max_size (com margem 5MB).
			'uploadLimit' => self::get_upload_limit(),
			// Proxy URL for cross-origin links (Google Drive, OneDrive, etc.)
			'downloadUrl' => esc_url_raw( V_DICOM_URL . 'includes/download.php' ),
			// Whether URL authorization (credit consumption) is enforced.
			'urlAuthEnabled' => V_Dicom_Storage::url_auth_enabled(),
			'segmentationCost' => V_Dicom_Storage::segmentation_cost(),
			'segmentationTypes' => V_Dicom_Storage::get_public_segmentation_types(),
			'locale'    => function_exists( 'determine_locale' ) ? determine_locale() : get_locale(),
		);

		// Loja, fornecida por plugin companheiro (ex.: WooCommerce) via filtro.
		$shop_url = v_dicom_shop_url();
		if ( '' !== $shop_url ) {
			$config['shopUrl'] = esc_url_raw( $shop_url );
		}

		nocache_headers();
		status_header( 200 );
		header( 'Content-Type: text/html; charset=utf-8' );

		$css = V_DICOM_URL . 'assets/v-dicom.css';
		$js  = V_DICOM_URL . 'assets/v-dicom.js';

		wp_register_style( 'v-dicom-fonts', 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap', array(), V_DICOM_VERSION );
		wp_enqueue_style( 'v-dicom-fonts' );

		wp_register_style( 'v-dicom-app', $css, array(), V_DICOM_VERSION );
		wp_enqueue_style( 'v-dicom-app' );

		$inline_css  = 'html, body { margin: 0; padding: 0; height: 100%; }';
		$inline_css .= '#v-dicom-root { min-height: 100vh; min-height: 100dvh; }';
		$inline_css .= V_Dicom_Theme::css_vars( $theme );
		wp_register_style( 'v-dicom-inline', false, array(), V_DICOM_VERSION );
		wp_enqueue_style( 'v-dicom-inline' );
		wp_add_inline_style( 'v-dicom-inline', $inline_css );

		wp_register_script( 'v-dicom-config', false, array(), V_DICOM_VERSION, false );
		wp_enqueue_script( 'v-dicom-config' );
		// The site locale is printed in clear text (before the encrypted config,
		// which is only readable after an async AES decrypt) so the embedded
		// viewer can pick its language before the first render.
		$config_js  = 'window.V_DICOM_LOCALE = ' . wp_json_encode( function_exists( 'determine_locale' ) ? determine_locale() : get_locale() ) . ';';
		$config_js .= 'window.V_DICOM = ' . wp_json_encode( self::encrypt_config( $config, home_url() ) ) . ';';
		wp_add_inline_script( 'v-dicom-config', $config_js, 'before' );

		wp_register_script( 'v-dicom-app', $js, array(), V_DICOM_VERSION, true );
		wp_enqueue_script( 'v-dicom-app' );
	?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title><?php echo esc_html( $title ); ?></title>
<link rel="manifest" href="<?php echo esc_url( self::manifest_url() ); ?>" />
<meta name="theme-color" content="<?php echo esc_attr( $theme['accent'] ? $theme['accent'] : '#22d3ee' ); ?>" />
<?php // iOS "add to home screen" flags: standalone mode, status bar, app name. ?>
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black" />
<meta name="apple-mobile-web-app-title" content="<?php echo esc_attr( $theme['name'] ); ?>" />
<meta name="application-name" content="<?php echo esc_attr( $theme['name'] ); ?>" />
<meta name="format-detection" content="telephone=no" />
<link rel="icon" type="image/svg+xml" href="<?php echo esc_url( self::icon_url( 'icon.svg' ) ); ?>" />
<link rel="icon" type="image/png" sizes="32x32" href="<?php echo esc_url( self::icon_url( 'favicon-32x32.png' ) ); ?>" />
<link rel="icon" href="<?php echo esc_url( self::icon_url( 'favicon.ico' ) ); ?>" sizes="any" />
<?php // apple-touch-icon must be PNG (iOS ignores SVG); biggest last so iOS picks 180x180. ?>
<link rel="apple-touch-icon" sizes="120x120" href="<?php echo esc_url( self::icon_url( 'apple-touch-icon-120x120.png' ) ); ?>" />
<link rel="apple-touch-icon" sizes="152x152" href="<?php echo esc_url( self::icon_url( 'apple-touch-icon-152x152.png' ) ); ?>" />
<link rel="apple-touch-icon" sizes="167x167" href="<?php echo esc_url( self::icon_url( 'apple-touch-icon-167x167.png' ) ); ?>" />
<link rel="apple-touch-icon" sizes="180x180" href="<?php echo esc_url( self::icon_url( 'apple-touch-icon-180x180.png' ) ); ?>" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<?php wp_print_styles(); ?>
<?php do_action( 'v_dicom_head' ); ?>
</head>
<body class="v-dicom-standalone">
<?php do_action( 'v_dicom_body_open' ); ?>
<div id="v-dicom-root" class="v-dicom-root"></div>
		<?php
			// Helper para tentar resumir chunks existentes.
			// Se um chunk de arquivo existir na sessão (renascer o servidor limpará).
			if ( 'v_dicom_up' === get_query_var( 'resumir' ) ) {
				self::remover_chunks_da_sessao();
			}
		?>
<?php wp_print_scripts(); ?>
<?php do_action( 'v_dicom_footer' ); ?>
</body>
</html>
		<?php
		exit;
	}
}
