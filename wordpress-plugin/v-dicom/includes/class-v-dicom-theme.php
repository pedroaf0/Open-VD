<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * White-label theme: viewer name, logo and the three brand colors.
 *
 * Background, interface (panel) and accent (destaque) are configurable.
 * The slice colors (axial, coronal, sagittal) are fixed and never overridden,
 * so the MPR planes keep a consistent, permanent identity.
 */
class V_Dicom_Theme {

	const OPTION = 'v_dicom_theme';

	/** Default brand colors, close to the original plugin palette. */
	public static function defaults() {
		return array(
			'name'       => 'v-dicom',
			'logo'       => '',
			'background' => '#1d2440',
			'panel'      => '#2a3355',
			'accent'     => '#e8a33d',
			// URL e texto de espera exibidos enquanto a cena carrega.
			'quiz_url'   => '',
			'quiz_text'  => __( 'Aguarde, carregando sua cena…', 'v-dicom' ),
		);
	}

	/** Read the saved theme merged with the defaults (hex normalized). */
	public static function get() {
		$saved = get_option( self::OPTION, array() );
		$saved = is_array( $saved ) ? $saved : array();
		// Remove o quiz legado (odonto show) salvo por versões anteriores.
		if ( isset( $saved['quiz_url'] ) && false !== strpos( (string) $saved['quiz_url'], 'odonto-show.online-web.app.br' ) ) {
			$saved['quiz_url'] = '';
		}
		if ( isset( $saved['quiz_text'] ) && false !== strpos( (string) $saved['quiz_text'], 'odonto show' ) ) {
			$saved['quiz_text'] = '';
		}
		$out   = self::defaults();
		foreach ( self::defaults() as $key => $default ) {
			$val = isset( $saved[ $key ] ) ? $saved[ $key ] : '';
			if ( in_array( $key, array( 'background', 'panel', 'accent' ), true ) ) {
				$hex       = self::normalize_hex( $val );
				$out[ $key ] = $hex ? $hex : $default;
			} elseif ( '' !== $val ) {
				if ( 'logo' === $key || 'quiz_url' === $key ) {
					$out[ $key ] = esc_url_raw( (string) $val );
				} else {
					$out[ $key ] = sanitize_text_field( (string) $val );
				}
			}
		}
		return $out;
	}

	/** Validate and persist a theme; missing values fall back to the default. */
	public static function save( $raw ) {
		$raw   = is_array( $raw ) ? $raw : array();
		$theme    = self::defaults();
		$name     = sanitize_text_field( isset( $raw['name'] ) ? (string) $raw['name'] : '' );
		$logo     = esc_url_raw( isset( $raw['logo'] ) ? (string) $raw['logo'] : '' );
		$quiz_url = esc_url_raw( isset( $raw['quiz_url'] ) ? (string) $raw['quiz_url'] : '' );
		$quiz_text = sanitize_text_field( isset( $raw['quiz_text'] ) ? (string) $raw['quiz_text'] : '' );
		if ( '' !== $name ) {
			$theme['name'] = $name;
		}
		$theme['logo']      = $logo;
		$theme['quiz_url']  = $quiz_url;
		$theme['quiz_text'] = $quiz_text;
		foreach ( array( 'background', 'panel', 'accent' ) as $key ) {
			$hex = self::normalize_hex( isset( $raw[ $key ] ) ? $raw[ $key ] : '' );
			if ( $hex ) {
				$theme[ $key ] = $hex;
			}
		}
		update_option( self::OPTION, $theme );
		return $theme;
	}

	/**
	 * CSS custom properties for the standalone viewer. Only the configurable
	 * colors are emitted — slice colors and --radius keep the CSS defaults.
	 */
	public static function css_vars( $theme = null ) {
		$theme = $theme ? $theme : self::get();
		$bg    = self::normalize_hex( $theme['background'] );
		$panel = self::normalize_hex( $theme['panel'] );
		$acc   = self::normalize_hex( $theme['accent'] );
		if ( ! $bg || ! $panel || ! $acc ) {
			return '';
		}

		$fg       = self::readable_text( $bg );
		$panel_fg = self::readable_text( $panel );
		$acc_fg   = self::readable_text( $acc );
		$panel2   = self::mix( $panel, $fg, 0.12 );
		$border   = self::mix( $panel, $fg, 0.28 );
		$muted    = self::mix( $bg, $fg, 0.18 );
		$muted_fg = self::mix( $fg, $bg, 0.35 );

		return ':root{'
			. '--background:' . $bg . ';'
			. '--foreground:' . $fg . ';'
			. '--panel:' . $panel . ';'
			. '--panel-2:' . $panel2 . ';'
			. '--card:' . $panel . ';'
			. '--card-foreground:' . $panel_fg . ';'
			. '--popover:' . $panel . ';'
			. '--popover-foreground:' . $panel_fg . ';'
			. '--primary:' . $acc . ';'
			. '--primary-foreground:' . $acc_fg . ';'
			. '--secondary:' . $muted . ';'
			. '--secondary-foreground:' . self::readable_text( $muted ) . ';'
			. '--muted:' . $muted . ';'
			. '--muted-foreground:' . $muted_fg . ';'
			. '--accent:' . $acc . ';'
			. '--accent-foreground:' . $acc_fg . ';'
			. '--border:' . $border . ';'
			. '--input:' . $border . ';'
			. '--ring:' . $acc . ';'
			. '}';
	}

	/** '#RRGGBB' always, or '' when invalid. Accepts 3-digit hex. */
	private static function normalize_hex( $hex ) {
		$hex = ltrim( (string) $hex, '#' );
		if ( preg_match( '/^[0-9a-f]{3}$/i', $hex ) ) {
			$hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
		}
		return preg_match( '/^[0-9a-f]{6}$/i', $hex ) ? '#' . strtoupper( $hex ) : '';
	}

	private static function hex_to_rgb( $hex ) {
		$hex = ltrim( (string) $hex, '#' );
		return array(
			hexdec( substr( $hex, 0, 2 ) ),
			hexdec( substr( $hex, 2, 2 ) ),
			hexdec( substr( $hex, 4, 2 ) ),
		);
	}

	private static function rgb_to_hex( $rgb ) {
		return sprintf( '#%02X%02X%02X', $rgb[0], $rgb[1], $rgb[2] );
	}

	/** Blend hex $a toward hex $b by factor $t (0..1). */
	private static function mix( $a, $b, $t ) {
		$a = self::hex_to_rgb( $a );
		$b = self::hex_to_rgb( $b );
		return self::rgb_to_hex(
			array(
				(int) round( $a[0] + ( $b[0] - $a[0] ) * $t ),
				(int) round( $a[1] + ( $b[1] - $a[1] ) * $t ),
				(int) round( $a[2] + ( $b[2] - $a[2] ) * $t ),
			)
		);
	}

	/** Black or white text with best contrast on a background hex. */
	private static function readable_text( $hex ) {
		list( $r, $g, $b ) = self::hex_to_rgb( $hex );
		$luma = ( 0.2126 * $r + 0.7152 * $g + 0.0722 * $b ) / 255;
		return $luma < 0.45 ? '#FFFFFF' : '#111318';
	}

	/** 'rgba(r,g,b,a)' a partir de um hex e alpha 0..1. */
	private static function rgba( $hex, $alpha ) {
		list( $r, $g, $b ) = self::hex_to_rgb( $hex );
		return 'rgba(' . $r . ',' . $g . ',' . $b . ',' . $alpha . ')';
	}

	/**
	 * CSS da tela de login do WordPress (wp-login.php) seguindo a identidade
	 * visual do app: fundo escuro, card do formulário, botão primário com a
	 * cor de destaque configurada e tipografia Geist.
	 */
	public static function login_css( $theme = null ) {
		$theme = $theme ? $theme : self::get();
		$bg    = self::normalize_hex( $theme['background'] );
		$panel = self::normalize_hex( $theme['panel'] );
		$acc   = self::normalize_hex( $theme['accent'] );
		if ( ! $bg || ! $panel || ! $acc ) {
			return '';
		}

		$fg       = self::readable_text( $bg );
		$panel_fg = self::readable_text( $panel );
		$acc_fg   = self::readable_text( $acc );
		$border   = self::mix( $panel, $fg, 0.28 );
		$muted    = self::mix( $fg, $bg, 0.38 );
		$input    = self::mix( $panel, $bg, 0.35 );
		$hover    = self::mix( $panel, $fg, 0.08 );
		$focus    = self::rgba( $acc, 0.28 );
		$danger   = '#e5484d';

		$logo = esc_url( (string) $theme['logo'] );
		$brand = $logo
			? "#login h1 a{background-image:url('{$logo}');background-size:contain;background-position:center center;background-repeat:no-repeat;width:220px;min-height:56px;margin:0 auto 18px;padding:0}"
			: '#login h1{display:none}';

		return implode(
			"\n",
			array(
				'body.login{background:' . $bg . ";font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0;min-height:100vh;padding:24px 16px;color:" . $fg . '}',
				'html{height:100%}',
				'body.login *{box-sizing:border-box}',
				'#login{width:min(400px,100%);margin:0;padding:0}',
				$brand,
				'#login form{background:' . $panel . ';border:1px solid ' . $border . ';border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:26px 26px 16px;margin-top:0}',
				'#login form p{margin:0 0 18px}',
				'#login form label{display:block;color:' . $muted . ';font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}',
				'#login form .input,#login input[type="text"],#login input[type="password"]{background:' . $input . ';color:' . $fg . ';border:1px solid ' . $border . ';border-radius:8px;font-size:16px;line-height:1.4;padding:10px 12px;height:auto;width:100%;box-shadow:none;transition:border-color .15s ease,box-shadow .15s ease}',
				'#login form .input:focus,#login input[type="text"]:focus,#login input[type="password"]:focus{border-color:' . $acc . ';box-shadow:0 0 0 3px ' . $focus . ';outline:none}',
				'#login .wp-pwd{position:relative}',
				'#login .wp-pwd .button.wp-hide-pw{position:absolute;top:50%;right:6px;transform:translateY(-50%);background:transparent;border:none;box-shadow:none;color:' . $muted . ';padding:4px}',
				'#login .wp-pwd .button.wp-hide-pw:hover{color:' . $fg . '}',
				'#login .forgetmenot{margin:-4px 0 16px}',
				'#login .forgetmenot label{text-transform:none;letter-spacing:normal;font-size:12px}',
				'#login .forgetmenot input{accent-color:' . $acc . '}',
				'#wp-submit{width:100%;background:' . $acc . ';color:' . $acc_fg . ';border:none;border-radius:8px;padding:11px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;height:auto;box-shadow:none;transition:filter .15s ease}',
				'#wp-submit:hover{filter:brightness(1.08)}',
				'#login_error,.login .message{background:' . $panel . ';border:1px solid ' . $border . ';border-radius:8px;border-left:3px solid ' . $danger . ';color:' . $fg . ';box-shadow:none;padding:10px 12px}',
				'#nav{margin:16px 0 4px;text-align:center}',
				'#nav a,#backtoblog a{color:' . $muted . ';text-decoration:none;font-size:12px;transition:color .15s ease}',
				'#nav a:hover,#backtoblog a:hover{color:' . $fg . '}',
				'#backtoblog{margin:12px 0 0;text-align:center}',
				'.language-switcher{margin-top:14px;text-align:center;opacity:.85}',
				'.language-switcher form{display:inline-flex;align-items:center;gap:8px;background:' . $panel . ';border:1px solid ' . $border . ';border-radius:8px;padding:8px 10px}',
				'.language-switcher select{background:' . $input . ';color:' . $fg . ';border:1px solid ' . $border . ';border-radius:6px;padding:4px 6px;font-size:12px}',
				'.language-switcher .button{background:transparent;border:1px solid ' . $border . ';border-radius:6px;color:' . $fg . ';font-size:12px;padding:4px 10px;box-shadow:none}',
				'.language-switcher .button:hover{background:' . $hover . '}',
				'.googlesitekit-sign-in-with-google__frontend-output-button{margin:0 auto 16px;text-align:center}',
				'@media (max-width:480px){body.login{padding:16px;justify-content:flex-start}#login form{padding:20px 18px 14px}}',
			)
		);
	}
}