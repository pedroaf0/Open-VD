<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Scene storage: files live in wp-content/uploads/v-dicom/<key>/ and the
 * scene metadata (original names, kind, settings) lives in post meta.
 */
class V_Dicom_Storage {

	const META_FILES    = '_v_dicom_files';
	const META_SETTINGS = '_v_dicom_settings';
	const META_KEY      = '_v_dicom_key';
	const META_LIMIT    = 'v_dicom_storage_limit_mb';
	const META_ANNOTATIONS = '_v_dicom_annotations';
	/** Planos de armazenamento comprados pelo usuário (lista com expiração individual). */
	const META_PLANS    = 'v_dicom_storage_plans';

	const OPTION_API_KEY = 'v_dicom_api_key';
const OPTION_CREDIT = 'v_dicom_credit';
const OPTION_RECENT_SCENES = 'v_dicom_recent_scenes';
/** Master toggle: when false, download.php skips URL authorization entirely. */
const OPTION_URL_AUTH_ENABLED = 'v_dicom_url_auth_enabled';
/** Master toggle: when true, DICOM files may be loaded/uploaded directly from local files. */
const OPTION_DIRECT_DICOM_ENABLED = 'v_dicom_direct_dicom_enabled';
const OPTION_DEFAULT_CREDIT = 'v_dicom_default_credit';
const OPTION_DEFAULT_STORAGE_MB = 'v_dicom_default_storage_mb';
/** Padrão do nome do vídeo gravado no viewport 3D (tokens resolvidos no viewer). */
const OPTION_RECORDING_NAME_PATTERN = 'v_dicom_recording_name_pattern';
const DEFAULT_RECORDING_NAME_PATTERN = 'openvd-3d-recording-{timestamp}';
	const OPTION_SEG_COST = 'v_dicom_segmentation_cost';
	const OPTION_SEG_TYPES = 'v_dicom_segmentation_types';
	/** Regras nome-da-malha -> cor especial (dentes, mandíbula, canal, etc.). */
	const OPTION_MESH_COLORS = 'v_dicom_mesh_colors';
	/** Permite carregamento público de exames sem login (arquivo local ou URL). */
	const OPTION_PUBLIC_LOADING_ENABLED = 'v_dicom_public_loading_enabled';
	const META_SEGMENTATIONS = '_v_dicom_segmentations';

	/** Maximum number of recently accessed scenes to store */
	const MAX_RECENT_SCENES = 10;

	/** Keys for segmentation metadata stored with each scene (legacy names kept for compatibility). */
	const SEGMENTATION_KEY = 'v_dicom_segmentation_used';
	const JOB_ID_KEY = 'v_dicom_runpod_job_id';
	const JOB_STATUS_KEY = 'v_dicom_runpod_status';
	const UPLOAD_URL_KEY = 'v_dicom_runpod_upload_url';
	const DOWNLOAD_URL_KEY = 'v_dicom_runpod_download_url';
	const SEG_COST_KEY = '_v_dicom_runpod_seg_cost';
	const SEG_STARTED_AT_KEY = '_v_dicom_runpod_started_at';
	const SEG_FINISHED_AT_KEY = '_v_dicom_runpod_finished_at';
	const RUN_DEBUG_KEY = '_v_dicom_runpod_run_debug';
	const RUN_DEBUG_TIME_KEY = '_v_dicom_runpod_run_time';
	const LAST_STATUS_DEBUG_KEY = '_v_dicom_runpod_last_status_debug';
	const LAST_STATUS_TIME_KEY = '_v_dicom_runpod_last_status_time';
	const LAST_CALLBACK_KEY = '_v_dicom_runpod_last_callback';
	const LAST_CALLBACK_TIME_KEY = '_v_dicom_runpod_last_callback_time';

	/** Extensions that may be stored with their own extension. */
	const SAFE_EXT = array( 'dcm', 'dicom', 'ima', 'img', 'stl', 'ply', 'obj', 'mtl', 'png', 'jpg', 'jpeg', 'nrrd', 'nii', 'gz', 'json', 'bin', 'zip' );

	public static function base_dir() {
		$uploads = wp_get_upload_dir();
		return trailingslashit( $uploads['basedir'] ) . 'v-dicom';
	}

	public static function base_url() {
		$uploads = wp_get_upload_dir();
		return trailingslashit( $uploads['baseurl'] ) . 'v-dicom';
	}

	/** Create the storage folder and block script execution inside it. */
	public static function ensure_upload_dir( $key = null ) {
		$dir = self::base_dir();
		wp_mkdir_p( $dir );

		$htaccess = $dir . '/.htaccess';
		if ( ! file_exists( $htaccess ) ) {
			file_put_contents(
				$htaccess,
				"Options -Indexes\n<FilesMatch \"\\.(php|phtml|phar|php[0-9]?)$\">\n\tDeny from all\n</FilesMatch>\n"
			);
		}
		if ( ! file_exists( $dir . '/index.php' ) ) {
			file_put_contents( $dir . '/index.php', "<?php\n// Silence is golden.\n" );
		}

		if ( $key ) {
			$dir .= '/' . $key;
			wp_mkdir_p( $dir );
		}
		return $dir;
	}

	private static function init_filesystem() {
		global $wp_filesystem;
		if ( empty( $wp_filesystem ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			WP_Filesystem();
		}
		return $wp_filesystem;
	}

	public static function generate_key() {
		return strtolower( wp_generate_password( 16, false, false ) );
	}

	/**
	 * Ensure the authorized URLs table exists. Called proactively because
	 * the activation hook may not have run on sites upgraded from an older
	 * version that had a broken CREATE TABLE statement.
	 */
	public static function ensure_authorized_urls_table() {
		global $wpdb;
		$table = $wpdb->prefix . 'v_dicom_authorized_urls';
		// Quick check — if the table already exists, do nothing.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- custom table existence check
		if ( $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $table ) ) === $table ) {
			return true;
		}
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$sql = "CREATE TABLE `$table` (
			id mediumint(9) NOT NULL AUTO_INCREMENT,
			url varchar(255) NOT NULL,
			times_accessed int(11) NOT NULL DEFAULT 0,
			PRIMARY KEY (id),
			UNIQUE KEY url (url)
		)";
		dbDelta( $sql );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- custom table existence check
		return $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $table ) ) === $table;
	}

	/** API key configured by the admin for uploads/downloads via REST. */
	public static function api_key() {
		return (string) get_option( self::OPTION_API_KEY, '' );
	}

	/** Whether URL authorization is enabled (admin toggle). */
	public static function url_auth_enabled() {
		return (bool) get_option( self::OPTION_URL_AUTH_ENABLED, true );
	}

	/** Enable or disable URL authorization. */
	public static function set_url_auth_enabled( $enabled ) {
		update_option( self::OPTION_URL_AUTH_ENABLED, $enabled ? 1 : 0 );
	}

	/**
	 * Whether DICOM files may be loaded/uploaded directly from local files
	 * (admin toggle). When false, exams can only be loaded via Drive/OneDrive.
	 */
	public static function direct_dicom_enabled() {
		return (bool) get_option( self::OPTION_DIRECT_DICOM_ENABLED, false );
	}

	/** Enable or disable direct DICOM loading/upload. */
	public static function set_direct_dicom_enabled( $enabled ) {
		update_option( self::OPTION_DIRECT_DICOM_ENABLED, $enabled ? 1 : 0 );
	}

	/** Whether public loading of exams without login is enabled (admin toggle). */
	public static function public_loading_enabled() {
		return (bool) get_option( self::OPTION_PUBLIC_LOADING_ENABLED, false );
	}

	/** Enable or disable public loading of exams without login. */
	public static function set_public_loading_enabled( $enabled ) {
		update_option( self::OPTION_PUBLIC_LOADING_ENABLED, $enabled ? 1 : 0 );
	}

	/** Sanitize the admin-defined video filename pattern while keeping tokens. */
	public static function sanitize_recording_name_pattern( $pattern ) {
		$pattern = sanitize_text_field( (string) $pattern );
		// A extensão é definida pelo formato gravado (.mp4 ou .webm).
		$pattern = preg_replace( '/\.(?:mp4|webm)\s*$/i', '', $pattern );
		// Mantém letras (inclusive acentuadas), números, tokens e poucos sinais.
		$pattern = preg_replace( '/[^\p{L}\p{N}\p{M} _{}().-]+/u', '-', (string) $pattern );
		$pattern = preg_replace( '/\s+/u', '-', (string) $pattern );
		$pattern = preg_replace( '/-+/u', '-', (string) $pattern );
		$pattern = preg_replace( '/\.{2,}/u', '.', (string) $pattern );
		$pattern = trim( (string) $pattern, " .-_" );
		if ( '' === $pattern ) {
			return self::DEFAULT_RECORDING_NAME_PATTERN;
		}
		return mb_substr( $pattern, 0, 120 );
	}

	/** Nome padrão configurado pelo admin para o download do vídeo 3D. */
	public static function recording_name_pattern() {
		return self::sanitize_recording_name_pattern(
			get_option( self::OPTION_RECORDING_NAME_PATTERN, self::DEFAULT_RECORDING_NAME_PATTERN )
		);
	}

	/** Persist the admin-defined video filename pattern. */
	public static function set_recording_name_pattern( $pattern ) {
		update_option( self::OPTION_RECORDING_NAME_PATTERN, self::sanitize_recording_name_pattern( $pattern ) );
	}

	public static function default_new_user_credit() {
		return max( 0, (int) get_option( self::OPTION_DEFAULT_CREDIT, 0 ) );
	}

	public static function default_new_user_storage_mb() {
		return max( 0, (int) get_option( self::OPTION_DEFAULT_STORAGE_MB, 0 ) );
	}

	public static function set_default_new_user_credit( $credits ) {
		update_option( self::OPTION_DEFAULT_CREDIT, max( 0, (int) $credits ) );
	}

	public static function set_default_new_user_storage_mb( $mb ) {
		update_option( self::OPTION_DEFAULT_STORAGE_MB, max( 0, (int) $mb ) );
	}

	public static function segmentation_cost() {
		return max( 0, (int) get_option( self::OPTION_SEG_COST, 1 ) );
	}

	public static function set_segmentation_cost( $cost ) {
		update_option( self::OPTION_SEG_COST, max( 0, (int) $cost ) );
	}

	public static function sanitize_seg_type_id( $id ) {
		$id = strtolower( (string) $id );
		$id = preg_replace( '/[^a-z0-9_-]/', '', $id );
		return substr( $id, 0, 32 );
	}

	/**
	 * Default request body template for a segmentation type.
	 *
	 * Placeholders between double braces are replaced at runtime. A placeholder
	 * outside quotes becomes a JSON value (string, number or array); inside
	 * quotes it becomes escaped text. The "max-voxels"/"max-triangles" entries
	 * are only added when migrating a type that still stores those values.
	 */
	public static function default_segmentation_payload( $max_voxels = 0, $max_triangles = 0 ) {
		$lines = array(
			'    "download-url": {{download_urls}}',
			'    "upload-url": "{{upload_url}}"',
			'    "callback-url": "{{callback_url}}"',
		);
		$max_voxels    = max( 0, (int) $max_voxels );
		$max_triangles = max( 0, (int) $max_triangles );
		if ( $max_voxels > 0 ) {
			$lines[] = '    "max-voxels": ' . $max_voxels;
		}
		if ( $max_triangles > 0 ) {
			$lines[] = '    "max-triangles": ' . $max_triangles;
		}
		return "{\n  \"input\": {\n" . implode( ",\n", $lines ) . "\n  }\n}";
	}

	/** Normalised placeholder names accepted in payload/URL templates. */
	public static function segmentation_template_aliases() {
		return array(
			'download_url'   => 'download_url',
			'download_urls'  => 'download_urls',
			'downloadlink'   => 'download_url',
			'download_link'  => 'download_url',
			'download_links' => 'download_urls',
			'downloadlinks'  => 'download_urls',
			'downloadurl'    => 'download_url',
			'upload_url'     => 'upload_url',
			'uploadlink'     => 'upload_url',
			'upload_link'    => 'upload_url',
			'uploadurl'      => 'upload_url',
			'callback_url'   => 'callback_url',
			'callbacklink'   => 'callback_url',
			'callback_link'  => 'callback_url',
			'callbackurl'    => 'callback_url',
			'url'            => 'url',
			'base_url'       => 'url',
			'baseurl'        => 'url',
			'scene_key'      => 'scene_key',
			'scenekey'       => 'scene_key',
			'scene'          => 'scene_key',
			'type_id'        => 'type_id',
			'typeid'         => 'type_id',
			'type'           => 'type_id',
			'type_name'      => 'type_name',
			'typename'       => 'type_name',
			'job_id'         => 'job_id',
			'jobid'          => 'job_id',
			'site_url'       => 'site_url',
			'siteurl'        => 'site_url',
			'timestamp'      => 'timestamp',
		);
	}

	/**
	 * Replace `{{placeholder}}` tokens in a payload or URL template.
	 *
	 * In JSON mode (default) the replacement keeps the template valid JSON:
	 * outside quotes the value is encoded as JSON (so arrays/numbers work),
	 * inside quotes the value is inserted already escaped as text.
	 * In raw mode the value is inserted as plain text, useful for URL templates.
	 *
	 * @param string $template Template text.
	 * @param array  $vars     Canonical placeholder values.
	 * @param string $mode     'json' (default) or 'raw'.
	 * @return string
	 */
	public static function render_segmentation_template( $template, $vars, $mode = 'json' ) {
		$template = (string) $template;
		$vars     = is_array( $vars ) ? $vars : array();
		$aliases  = self::segmentation_template_aliases();
		$out      = '';
		$length   = strlen( $template );
		$in_string = false;
		$escaped   = false;

		for ( $i = 0; $i < $length; $i++ ) {
			$char = $template[ $i ];

			if ( '{' === $char && $i + 1 < $length && '{' === $template[ $i + 1 ] ) {
				$end = strpos( $template, '}}', $i + 2 );
				if ( false !== $end ) {
					$raw_key = substr( $template, $i + 2, $end - $i - 2 );
					$key     = strtolower( trim( $raw_key ) );
					$key     = str_replace( '-', '_', $key );
					$key     = preg_replace( '/\s+/', '_', $key );
					$canonical = $aliases[ $key ] ?? '';
					if ( '' !== $canonical && array_key_exists( $canonical, $vars ) ) {
						$value = $vars[ $canonical ];
						if ( 'raw' === $mode ) {
							if ( is_array( $value ) ) {
								$value = reset( $value );
							} elseif ( is_object( $value ) ) {
								$value = '';
							} elseif ( is_bool( $value ) ) {
								$value = $value ? '1' : '0';
							} elseif ( null === $value ) {
								$value = '';
							}
							$out .= (string) $value;
						} elseif ( $in_string ) {
							if ( is_array( $value ) || is_object( $value ) ) {
								$encoded = wp_json_encode( $value );
								$out    .= is_string( $encoded ) ? substr( $encoded, 1, -1 ) : '';
							} elseif ( is_bool( $value ) ) {
								$out .= $value ? 'true' : 'false';
							} elseif ( null === $value ) {
								$out .= '';
							} else {
								$encoded = wp_json_encode( (string) $value );
								$out    .= is_string( $encoded ) ? substr( $encoded, 1, -1 ) : '';
							}
						} else {
							$encoded = wp_json_encode( $value );
							$out    .= is_string( $encoded ) ? $encoded : 'null';
						}
						$i = $end + 1;
						continue;
					}
				}
			}

			$out .= $char;
			if ( $in_string ) {
				if ( $escaped ) {
					$escaped = false;
				} elseif ( '\\' === $char ) {
					$escaped = true;
				} elseif ( '"' === $char ) {
					$in_string = false;
				}
			} elseif ( '"' === $char ) {
				$in_string = true;
			}
		}

		return $out;
	}

	/** Keep the payload template readable while stripping control characters. */
	private static function sanitize_payload_template( $payload ) {
		$payload = (string) $payload;
		$payload = wp_check_invalid_utf8( $payload );
		$payload = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $payload );
		return trim( (string) $payload );
	}

	public static function sanitize_segmentation_type( $raw, $fallback_id = '' ) {
		if ( ! is_array( $raw ) ) {
			return null;
		}
		$id = self::sanitize_seg_type_id( $raw['id'] ?? $fallback_id );
		if ( '' === $id ) {
			$id = substr( md5( wp_json_encode( $raw ) . microtime() ), 0, 8 );
		}
		$name = sanitize_text_field( (string) ( $raw['name'] ?? '' ) );
		if ( '' === $name ) {
			return null;
		}
		$desc = wp_kses_post( (string) ( $raw['description'] ?? '' ) );
		$url  = esc_url_raw( trim( (string) ( $raw['url'] ?? '' ) ) );
		$auth = trim( (string) ( $raw['authorization'] ?? $raw['auth'] ?? '' ) );

		// Legacy types stored only max_voxels/max_triangles and used the fixed
		// "url/run" and "url/status/<job>" paths. Turn those into explicit
		// templates so the generic cloud integration keeps working.
		$legacy_vox = max( 0, (int) ( $raw['max_voxels'] ?? $raw['max-voxels'] ?? 0 ) );
		$legacy_tri = max( 0, (int) ( $raw['max_triangles'] ?? $raw['max-triangles'] ?? 0 ) );
		$has_payload = isset( $raw['payload'] ) && '' !== trim( (string) $raw['payload'] );
		$payload     = $has_payload
			? self::sanitize_payload_template( (string) $raw['payload'] )
			: self::default_segmentation_payload( $legacy_vox, $legacy_tri );

		$run_url    = sanitize_text_field( (string) ( $raw['run_url'] ?? $raw['run-url'] ?? '' ) );
		$status_url = sanitize_text_field( (string) ( $raw['status_url'] ?? $raw['status-url'] ?? '' ) );
		if ( ! $has_payload ) {
			if ( '' === $run_url && '' !== $url ) {
				$run_url = trailingslashit( $url ) . 'run';
			}
			if ( '' === $status_url && '' !== $url ) {
				$status_url = trailingslashit( $url ) . 'status/{{job_id}}';
			}
		}

		$cost    = max( 0, (int) ( $raw['cost'] ?? $raw['seg_cost'] ?? 0 ) );
		$enabled = isset( $raw['enabled'] ) ? (bool) $raw['enabled'] : true;
		return array(
			'id'            => $id,
			'name'          => $name,
			'description'   => $desc,
			'url'           => $url,
			'run_url'       => $run_url,
			'status_url'    => $status_url,
			'authorization' => $auth,
			'payload'       => $payload,
			'cost'          => $cost,
			'enabled'       => $enabled,
		);
	}

	private static function strip_seg_secrets( $types ) {
		$out = array();
		foreach ( (array) $types as $t ) {
			if ( ! is_array( $t ) ) { continue; }
			$copy = $t;
			unset( $copy['authorization'] );
			unset( $copy['url'] );
			unset( $copy['run_url'] );
			unset( $copy['status_url'] );
			unset( $copy['payload'] );
			$out[] = $copy;
		}
		return $out;
	}

	public static function get_segmentation_types( $with_secret = false ) {
		$raw = get_option( self::OPTION_SEG_TYPES, null );
		if ( is_array( $raw ) && ! empty( $raw ) ) {
			$out = array();
			$seen = array();
			foreach ( $raw as $item ) {
				$san = self::sanitize_segmentation_type( $item );
				if ( ! $san ) { continue; }
				if ( isset( $seen[ $san['id'] ] ) ) { continue; }
				$seen[ $san['id'] ] = true;
				$out[] = $san;
			}
			return $with_secret ? $out : self::strip_seg_secrets( $out );
		}
		$legacy = get_option( 'v_dicom_runpod', null );
		$cost   = self::segmentation_cost();
		if ( is_array( $legacy ) && ( ! empty( $legacy['url'] ) || ! empty( $legacy['authorization'] ) ) ) {
			$migrated = self::sanitize_segmentation_type( array(
				'id'            => 'default',
				'name'          => __( 'Padrão', 'v-dicom' ),
				'description'   => __( 'Tipo migrado automaticamente da configuração anterior.', 'v-dicom' ),
				'url'           => $legacy['url'] ?? '',
				'authorization' => $legacy['authorization'] ?? '',
				'max_voxels'    => $legacy['max_voxels'] ?? 0,
				'max_triangles' => $legacy['max_triangles'] ?? 0,
				'cost'          => $cost,
				'enabled'       => true,
			), 'default' );
			if ( $migrated ) {
				update_option( self::OPTION_SEG_TYPES, array( $migrated ) );
				return $with_secret ? array( $migrated ) : self::strip_seg_secrets( array( $migrated ) );
			}
		}
		return array();
	}

	public static function get_public_segmentation_types() {
		$types = self::get_segmentation_types( false );
		$pub = array();
		foreach ( $types as $t ) {
			if ( empty( $t['enabled'] ) ) { continue; }
			$pub[] = array(
				'id'          => $t['id'],
				'name'        => $t['name'],
				'description' => $t['description'],
				'cost'        => (int) $t['cost'],
				'enabled'     => true,
			);
		}
		return $pub;
	}

	public static function get_segmentation_type( $type_id, $with_secret = false ) {
		$type_id = self::sanitize_seg_type_id( $type_id );
		if ( '' === $type_id ) { return null; }
		$types = self::get_segmentation_types( $with_secret );
		foreach ( $types as $t ) {
			if ( $t['id'] === $type_id ) { return $t; }
		}
		return null;
	}

	public static function set_segmentation_types( $types ) {
		$out = array();
		$seen = array();
		foreach ( (array) $types as $item ) {
			$san = self::sanitize_segmentation_type( $item );
			if ( ! $san ) { continue; }
			if ( isset( $seen[ $san['id'] ] ) ) { continue; }
			$seen[ $san['id'] ] = true;
			$out[] = $san;
		}
		update_option( self::OPTION_SEG_TYPES, array_values( $out ) );
		return array_values( $out );
	}

	/**
	 * Regras padrão de cor por nome de malha (STL/PLY/OBJ). Usadas quando o
	 * administrador ainda não personalizou a lista no painel.
	 */
	public static function default_mesh_colors() {
		return array(
			array( 'name' => 'maxila e cranio superior', 'color' => '#FFF3B0', 'match' => 'exact' ),
			array( 'name' => 'mandibula', 'color' => '#FFF3B0', 'match' => 'exact' ),
			array( 'name' => 'dentes superiores', 'color' => '#FFFFFF', 'match' => 'exact' ),
			array( 'name' => 'dentes inferiores', 'color' => '#FFFFFF', 'match' => 'exact' ),
			array( 'name' => 'canal mandibular', 'color' => '#FF0000', 'match' => 'exact' ),
		);
	}

	/**
	 * Sanitiza uma regra de cor. Retorna null quando o nome ou a cor são
	 * inválidos (a regra é descartada). `match` aceita 'exact' (padrão),
	 * 'contains' ou 'regex'. Em 'regex', o nome é tratado como expressão
	 * regular; padrões inválidos são descartados.
	 */
	public static function sanitize_mesh_color_rule( $raw ) {
		if ( ! is_array( $raw ) ) {
			return null;
		}
		$raw_match = isset( $raw['match'] ) ? (string) $raw['match'] : 'exact';
		$match     = in_array( $raw_match, array( 'exact', 'contains', 'regex' ), true ) ? $raw_match : 'exact';
		if ( 'regex' === $match ) {
			// Não passar por sanitize_text_field: preserva metacaracteres e
			// grupos nomeados; removemos só controle/nulos e limitamos o tamanho.
			$name = trim( (string) ( $raw['name'] ?? '' ) );
			$name = (string) preg_replace( '/[\x00-\x1F\x7F]/', '', $name );
			$name = substr( $name, 0, 200 );
			if ( '' === $name || ! self::is_valid_regex( $name ) ) {
				return null;
			}
		} else {
			$name = sanitize_text_field( (string) ( $raw['name'] ?? '' ) );
			if ( '' === trim( $name ) ) {
				return null;
			}
		}
		$hex = sanitize_hex_color( (string) ( $raw['color'] ?? '' ) );
		if ( ! $hex ) {
			return null;
		}
		return array(
			'name'  => $name,
			'color' => strtoupper( $hex ),
			'match' => $match,
		);
	}

	/** Valida um padrão regex para uso com delimitador próprio (sem guardar). */
	private static function is_valid_regex( $pattern ) {
		if ( '' === $pattern ) {
			return false;
		}
		$delim   = '~';
		$escaped = str_replace( $delim, '\\' . $delim, $pattern );
		return false !== @preg_match( $delim . $escaped . $delim . 'i', '' );
	}

	/**
	 * Lista de regras ativas. Quando a opção nunca foi salva, devolve os
	 * padrões; quando foi salva (mesmo vazia), devolve exatamente o que o
	 * administrador definiu.
	 */
	public static function get_mesh_colors() {
		$raw = get_option( self::OPTION_MESH_COLORS, null );
		if ( ! is_array( $raw ) ) {
			return self::default_mesh_colors();
		}
		$out = array();
		foreach ( $raw as $item ) {
			$san = self::sanitize_mesh_color_rule( $item );
			if ( $san ) {
				$out[] = $san;
			}
		}
		return array_values( $out );
	}

	public static function set_mesh_colors( $rules ) {
		$out = array();
		foreach ( (array) $rules as $item ) {
			$san = self::sanitize_mesh_color_rule( $item );
			if ( $san ) {
				$out[] = $san;
			}
		}
		update_option( self::OPTION_MESH_COLORS, array_values( $out ) );
		return array_values( $out );
	}

	public static function get_segmentations( $key ) {
		$key  = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( ! $post ) { return array(); }
		$map = get_post_meta( $post->ID, self::META_SEGMENTATIONS, true );
		if ( ! is_array( $map ) ) { $map = array(); }
		if ( empty( $map ) ) {
			$has_legacy = get_post_meta( $post->ID, self::SEGMENTATION_KEY, true ) || get_post_meta( $post->ID, self::JOB_ID_KEY, true ) || get_post_meta( $post->ID, self::JOB_STATUS_KEY, true );
			if ( $has_legacy ) {
				$entry = array(
					'used'             => (bool) get_post_meta( $post->ID, self::SEGMENTATION_KEY, true ),
					'job_id'           => (string) get_post_meta( $post->ID, self::JOB_ID_KEY, true ),
					'status'           => (string) get_post_meta( $post->ID, self::JOB_STATUS_KEY, true ),
					'upload_url'       => (string) get_post_meta( $post->ID, self::UPLOAD_URL_KEY, true ),
					'download_url'     => (string) get_post_meta( $post->ID, self::DOWNLOAD_URL_KEY, true ),
					'cost'             => get_post_meta( $post->ID, self::SEG_COST_KEY, true ),
					'started_at'       => get_post_meta( $post->ID, self::SEG_STARTED_AT_KEY, true ),
					'finished_at'      => get_post_meta( $post->ID, self::SEG_FINISHED_AT_KEY, true ),
					'run_debug'        => get_post_meta( $post->ID, self::RUN_DEBUG_KEY, true ),
					'run_debug_time'   => get_post_meta( $post->ID, self::RUN_DEBUG_TIME_KEY, true ),
					'run_response'     => get_post_meta( $post->ID, '_v_dicom_runpod_run_response', true ),
					'last_status_debug'=> get_post_meta( $post->ID, self::LAST_STATUS_DEBUG_KEY, true ),
					'last_status_time' => get_post_meta( $post->ID, self::LAST_STATUS_TIME_KEY, true ),
					'last_callback'    => get_post_meta( $post->ID, self::LAST_CALLBACK_KEY, true ),
					'last_callback_time'=> get_post_meta( $post->ID, self::LAST_CALLBACK_TIME_KEY, true ),
					'last_error'       => get_post_meta( $post->ID, '_v_dicom_runpod_last_error', true ),
					'last_output'      => get_post_meta( $post->ID, '_v_dicom_runpod_last_output', true ),
					'returncode'       => get_post_meta( $post->ID, '_v_dicom_runpod_returncode', true ),
					'credit_refunded'  => get_post_meta( $post->ID, '_v_dicom_credit_refunded', true ),
					'email_sent'       => get_post_meta( $post->ID, '_v_dicom_seg_email_sent', true ),
					'email_last_error' => get_post_meta( $post->ID, '_v_dicom_seg_email_last_error', true ),
				);
				$filtered = array();
				foreach ( $entry as $k => $v ) {
					if ( '' !== $v && null !== $v && array() !== $v ) { $filtered[ $k ] = $v; }
				}
				if ( ! empty( $filtered['job_id'] ) || ! empty( $filtered['status'] ) || ! empty( $filtered['used'] ) ) {
					if ( empty( $filtered['status'] ) && ! empty( $filtered['used'] ) ) { $filtered['status'] = 'IN_QUEUE'; }
					if ( ! isset( $filtered['used'] ) ) { $filtered['used'] = true; }
					$map['default'] = $filtered;
					update_post_meta( $post->ID, self::META_SEGMENTATIONS, $map );
				}
			}
		}
		$clean = array();
		foreach ( $map as $tid => $entry ) {
			$tid = self::sanitize_seg_type_id( $tid );
			if ( '' === $tid || ! is_array( $entry ) ) { continue; }
			$clean[ $tid ] = $entry;
		}
		return $clean;
	}

	public static function get_segmentation( $key, $type_id ) {
		$type_id = self::sanitize_seg_type_id( $type_id );
		$map = self::get_segmentations( $key );
		return $map[ $type_id ] ?? null;
	}

	public static function set_segmentation( $key, $type_id, $data ) {
		$key     = self::sanitize_key( $key );
		$type_id = self::sanitize_seg_type_id( $type_id );
		if ( '' === $key || '' === $type_id ) { return false; }
		$post = self::find_scene( $key );
		if ( ! $post ) { return false; }
		$map = self::get_segmentations( $key );
		$prev = isset( $map[ $type_id ] ) && is_array( $map[ $type_id ] ) ? $map[ $type_id ] : array();
		if ( null === $data ) {
			unset( $map[ $type_id ] );
		} else {
			$map[ $type_id ] = array_merge( $prev, (array) $data );
		}
		update_post_meta( $post->ID, self::META_SEGMENTATIONS, $map );
		return true;
	}

	public static function isSegmentationUsedForType( $key, $type_id ) {
		$seg = self::get_segmentation( $key, $type_id );
		return ! empty( $seg['used'] );
	}

	public static function getJobIdForType( $key, $type_id ) {
		$seg = self::get_segmentation( $key, $type_id );
		return $seg ? (string) ( $seg['job_id'] ?? '' ) : '';
	}

	public static function getJobStatusForType( $key, $type_id ) {
		$seg = self::get_segmentation( $key, $type_id );
		return $seg ? (string) ( $seg['status'] ?? '' ) : '';
	}

	public static function setJobStatusForType( $key, $type_id, $status ) {
		return self::set_segmentation( $key, $type_id, array( 'status' => (string) $status, 'used' => true ) );
	}

	public static function setJobIdForType( $key, $type_id, $job_id ) {
		return self::set_segmentation( $key, $type_id, array( 'job_id' => (string) $job_id, 'used' => true ) );
	}

	public static function resetSegmentationForType( $key, $type_id ) {
		return self::set_segmentation( $key, $type_id, null );
	}

	public static function getKeyCallbackUrlForType( $key, $type_id ) {
		$key     = self::sanitize_key( $key );
		$type_id = self::sanitize_seg_type_id( $type_id );
		$url = rest_url( V_Dicom_REST::NS . '/scenes/' . $key . '/segmentation-status' ) . '?apikey=' . rawurlencode( self::api_key() );
		if ( '' !== $type_id ) { $url .= '&type=' . rawurlencode( $type_id ); }
		return $url;
	}

	/**
	 * Apply defaults to a newly registered user.
	 * Idempotent: only sets values when the user has none yet.
	 */
	public static function apply_new_user_defaults( $user_id ) {
		$user_id = (int) $user_id;
		if ( ! $user_id ) {
			return;
		}
		if ( '' === get_user_meta( $user_id, self::META_LIMIT, true ) ) {
			update_user_meta( $user_id, self::META_LIMIT, self::default_new_user_storage_mb() );
		}
		if ( '' === get_user_meta( $user_id, self::OPTION_CREDIT, true ) ) {
			update_user_meta( $user_id, self::OPTION_CREDIT, self::default_new_user_credit() );
		}
	}

	/** Persist the configured API key (empty disables key access). */
	public static function set_api_key( $key ) {
		update_option( self::OPTION_API_KEY, trim( (string) $key ) );
	}

	/** Créditos de processamento do usuário (inteiro). */
	public static function user_credit( $user_id ) {
		return (int) get_user_meta( (int) $user_id, self::OPTION_CREDIT, true );
	}

	/** Definir créditos do usuário. */
	public static function set_user_credit( $user_id, $credits ) {
		update_user_meta( (int) $user_id, self::OPTION_CREDIT, max( 0, (int) $credits ) );
	}

	/**
	 * Todos os planos de armazenamento de um usuário, na ordem em que foram
	 * comprados. Cada plano: mb, months, granted_at, expires_at, order_id.
	 */
	public static function user_plans( $user_id ) {
		$plans = get_user_meta( (int) $user_id, self::META_PLANS, true );
		return is_array( $plans ) ? array_values( $plans ) : array();
	}

	/** Soma dos MB dos planos ainda ativos (não expirados). */
	public static function active_plans_mb( $user_id ) {
		$total = 0;
		$now   = time();
		foreach ( self::user_plans( $user_id ) as $plan ) {
			if ( ! is_array( $plan ) || empty( $plan['expires_at'] ) ) {
				continue;
			}
			if ( (int) $plan['expires_at'] > $now ) {
				$total += max( 0, (int) $plan['mb'] );
			}
		}
		return $total;
	}

	/**
	 * Adiciona um plano de armazenamento à conta do usuário.
	 *
	 * @param int $user_id  Usuário.
	 * @param int $mb       MegaBytes oferecidos pelo plano.
	 * @param int $months   Duração do plano em meses.
	 * @param int $order_id Referência opcional de origem (ex.: pedido de uma loja).
	 * @return bool True quando o plano foi gravado.
	 */
	public static function add_user_plan( $user_id, $mb, $months, $order_id = 0 ) {
		$user_id = (int) $user_id;
		$mb      = max( 1, (int) $mb );
		$months  = max( 1, (int) $months );
		if ( ! $user_id ) {
			return false;
		}
		$plans   = self::user_plans( $user_id );
		$now     = time();
		$plans[] = array(
			'mb'         => $mb,
			'months'     => $months,
			'granted_at' => $now,
			'expires_at' => (int) strtotime( '+' . $months . ' months', $now ),
			'order_id'   => (int) $order_id,
		);
		update_user_meta( $user_id, self::META_PLANS, $plans );
		return true;
	}

	/**
	 * Remove os planos expirados de um usuário.
	 *
	 * @return bool True quando algum plano expirado foi removido.
	 */
	public static function prune_expired_plans( $user_id ) {
		$user_id = (int) $user_id;
		if ( ! $user_id ) {
			return false;
		}
		$plans    = self::user_plans( $user_id );
		$now      = time();
		$kept     = array();
		$pruned   = false;
		foreach ( $plans as $plan ) {
			if ( is_array( $plan ) && ! empty( $plan['expires_at'] ) && (int) $plan['expires_at'] > $now ) {
				$kept[] = $plan;
			} else {
				$pruned = true;
			}
		}
		if ( $pruned ) {
			if ( $kept ) {
				update_user_meta( $user_id, self::META_PLANS, $kept );
			} else {
				delete_user_meta( $user_id, self::META_PLANS );
			}
		}
		return $pruned;
	}

	/**
	 * Aplica o limite atual: enquanto o uso ultrapassar o limite, remove as
	 * cenas mais antigas primeiro até o uso caber no limite.
	 */
	public static function enforce_quota( $user_id ) {
		$user_id = (int) $user_id;
		if ( ! $user_id ) {
			return;
		}
		$limit = self::user_limit_bytes( $user_id );
		$total = self::used_bytes( $user_id );
		if ( $total <= $limit ) {
			return;
		}
		// Cenas do usuário da mais antiga para a mais recente.
		$scenes = get_posts(
			array(
				'post_type'   => V_DICOM_CPT,
				'post_status' => 'any',
				'numberposts' => -1,
				'author'      => $user_id,
				'orderby'     => 'date',
				'order'       => 'ASC',
			)
		);
		foreach ( $scenes as $post ) {
			if ( $total <= $limit ) {
				break;
			}
			$key   = self::sanitize_key( get_post_meta( $post->ID, self::META_KEY, true ) );
			$size  = $key ? self::dir_size( self::base_dir() . '/' . $key ) : 0;
			self::delete_scene( $post );
			$total -= $size;
		}
	}

	/**
	 * Rotina agendada (cron): remove planos vencidos de todos os usuários e
	 * exclui o excedente de quem ficou acima do novo limite.
	 */
	public static function cron_prune_and_enforce() {
		$users = get_users(
			array(
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- users that own a storage plan
				'meta_key' => self::META_PLANS,
				'fields'   => 'ID',
				'number'   => -1,
			)
		);
		foreach ( $users as $uid ) {
			if ( self::prune_expired_plans( (int) $uid ) ) {
				self::enforce_quota( (int) $uid );
			}
		}
	}

	/** Find a scene post by its public key. */
	public static function find_scene( $key ) {
		$key = self::sanitize_key( $key );
		if ( '' === $key ) {
			return null;
		}
		$posts = get_posts(
			array(
				'post_type'        => V_DICOM_CPT,
				'post_status'      => 'any',
				'numberposts'      => 1,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- lookup scene by public key
				'meta_key'         => self::META_KEY,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- lookup scene by public key
				'meta_value'       => $key,
				'suppress_filters' => false,
			)
		);
		return $posts ? $posts[0] : null;
	}

	/**
	 * True when the current user may write into a scene: the owner or any user
	 * with edit_others_posts (editors/admins). API-key requests bypass this.
	 */
	public static function user_can_write_scene( $post ) {
		if ( ! $post ) {
			return false;
		}
		$is_owner = (int) $post->post_author === get_current_user_id();
		return $is_owner || current_user_can( 'edit_others_posts' );
	}

	public static function sanitize_key( $key ) {
		return preg_replace( '/[^a-z0-9]/', '', strtolower( (string) $key ) );
	}

	public static function create_scene( $title, $key = '', $files = array(), $settings = array(), $annotations = array(), $urls = array() ) {
		$key     = self::sanitize_key( $key );
		if ( '' === $key ) {
			$key = self::generate_key();
		}
		$post_id = wp_insert_post(
			array(
				'post_type'   => V_DICOM_CPT,
				'post_status' => 'publish',
				'post_title'  => $title ? $title : __( 'Cena DICOM', 'v-dicom' ),
				'post_author' => get_current_user_id(),
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}
		update_post_meta( $post_id, self::META_KEY, $key );
		update_post_meta( $post_id, self::META_FILES, is_array( $files ) ? array_values( $files ) : array() );
		// Store urls array (new format) - also keep backward compatibility with legacy 'url' field
		if ( is_array( $urls ) ) {
			update_post_meta( $post_id, '_v_dicom_urls', array_values( $urls ) );
		} elseif ( isset( $settings['url'] ) ) {
			// Legacy: convert single url string to array
			update_post_meta( $post_id, '_v_dicom_urls', array( $settings['url'] ) );
			// Remove the legacy url from settings to avoid duplication
			unset( $settings['url'] );
		}
		if ( ! empty( $settings ) ) {
			update_post_meta( $post_id, self::META_SETTINGS, $settings );
		}
		if ( ! empty( $annotations ) ) {
			update_post_meta( $post_id, self::META_ANNOTATIONS, array_values( $annotations ) );
		}
		self::ensure_upload_dir( $key );
		return array(
			'id'  => (int) $post_id,
			'key' => $key,
		);
	}

	/**
	 * Validate the file list sent when creating a scene: every URL must point
	 * to a file that really exists inside this scene/session folder.
	 */
	public static function sanitize_files( $key, $raw ) {
		$key  = self::sanitize_key( $key );
		$out  = array();
		$dir  = self::base_dir() . '/' . $key;
		$base = self::base_url() . '/' . $key . '/';
		foreach ( (array) $raw as $item ) {
			if ( ! is_array( $item ) || empty( $item['url'] ) ) {
				continue;
			}
			$url = esc_url_raw( (string) $item['url'] );
			if ( 0 !== strpos( $url, $base ) ) {
				continue;
			}
			$file = wp_basename( $url );
			if ( ! $file || ! file_exists( $dir . '/' . $file ) ) {
				continue;
			}
			$name  = isset( $item['name'] ) ? sanitize_text_field( (string) $item['name'] ) : $file;
			$out[] = array(
				'name' => $name,
				'url'  => $base . $file,
				'kind' => preg_match( '/\.(stl|ply|obj|mtl|png|jpe?g)$/i', $name ) ? 'mesh' : 'dicom',
				'size' => (int) filesize( $dir . '/' . $file ),
			);
		}
		return $out;
	}

	/**
	 * Store one uploaded file inside the scene folder.
	 *
	 * @param string $key         Scene key.
	 * @param array  $file        Entry from $_FILES.
	 * @param bool   $via_apikey  True when authorized by the admin API key
	 *                            (the per-user quota is not enforced).
	 * @return array|WP_Error   File descriptor used by the viewer.
	 */
	public static function store_file( $key, $file, $via_apikey = false ) {
		$key = self::sanitize_key( $key );

		$bytes = isset( $file['size'] ) ? (int) $file['size'] : 0;
		if ( ! $bytes && ! empty( $file['tmp_name'] ) && is_file( $file['tmp_name'] ) ) {
			$bytes = (int) @filesize( $file['tmp_name'] );
		}

		$original = isset( $file['name'] ) ? wp_basename( (string) $file['name'] ) : __( 'arquivo', 'v-dicom' );
		$original = str_replace( array( "\0", '..' ), '', $original );

		// Detectar padrão de chunk: nome.1of3part
		$chunk_info = self::parse_chunk_name( $original );
		if ( $chunk_info ) {
			return self::store_chunk( $key, $file, $chunk_info, $via_apikey );
		}

		if ( ! $via_apikey ) {
			$post = self::find_scene( $key );
			// A logged-in user may only write into scenes they own (or manage).
			if ( $post && ! self::user_can_write_scene( $post ) ) {
				return new WP_Error(
					'v_dicom_forbidden',
					__( 'Esta cena pertence a outro usuário.', 'v-dicom' ),
					array( 'status' => rest_authorization_required_code() )
				);
			}
			$extra = $post ? 0 : self::dir_size( self::base_dir() . '/' . $key );
			$quota = self::check_quota( get_current_user_id(), $bytes, $extra );
			if ( is_wp_error( $quota ) ) {
				return $quota;
			}
		}

		$dir = self::ensure_upload_dir( $key );

		$safe = sanitize_file_name( $original );
		if ( '' === $safe ) {
			$safe = __( 'arquivo', 'v-dicom' );
		}

		$ext = strtolower( (string) pathinfo( $safe, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, self::SAFE_EXT, true ) ) {
			// DICOM series often ship without an extension; store them as .bin.
			$safe = pathinfo( $safe, PATHINFO_FILENAME ) . '.bin';
		}

		$target = $dir . '/' . wp_unique_filename( $dir, $safe );

		if ( empty( $file['tmp_name'] ) || ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Upload inválido.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		// phpcs:ignore Generic.PHP.ForbiddenFunctions.Found -- temp file validated with is_uploaded_file()
		if ( ! @move_uploaded_file( $file['tmp_name'], $target ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Não foi possível gravar o arquivo.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		$fs = self::init_filesystem();
		if ( $fs ) {
			$fs->chmod( $target, 0644 );
		}

		$descriptor = array(
			'name' => $original,
			'url'  => self::base_url() . '/' . $key . '/' . wp_basename( $target ),
			'kind' => preg_match( '/\.(stl|ply|obj|mtl|png|jpe?g)$/i', $original ) ? 'mesh' : 'dicom',
			'size' => (int) filesize( $target ),
		);

		$post = self::find_scene( $key );
		if ( $post ) {
			$files   = get_post_meta( $post->ID, self::META_FILES, true );
			$files   = is_array( $files ) ? $files : array();
			$files[] = $descriptor;
			update_post_meta( $post->ID, self::META_FILES, $files );
		}

		return $descriptor;
	}

	/**
	 * Detecta padrão de chunk no nome: base.NofMpart
	 * Retorna null se não for chunk, ou array com baseName, part, total.
	 */
	private static function parse_chunk_name( $filename ) {
		// Remove path e extensão antes do padrão .NofMpart
		if ( ! preg_match( '/^(.+\.)(\d+)of(\d+)part$/i', $filename, $m ) ) {
			return null;
		}
		$baseName = $m[1];  // "dicom.zip."
		$part     = (int) $m[2];
		$total    = (int) $m[3];
		if ( $part < 1 || $part > $total || $total < 2 ) {
			return null;
		}
		return compact( 'baseName', 'part', 'total' );
	}

	/**
	 * Armazena um chunk de arquivo e, se for o último, junta todos os chunks.
	 */
	private static function store_chunk( $key, $file, $chunk_info, $via_apikey ) {
		$bytes = isset( $file['size'] ) ? (int) $file['size'] : 0;
		if ( ! $bytes && ! empty( $file['tmp_name'] ) && is_file( $file['tmp_name'] ) ) {
			$bytes = (int) @filesize( $file['tmp_name'] );
		}

		if ( ! $via_apikey ) {
			$post     = self::find_scene( $key );
			$extra    = $post ? 0 : self::dir_size( self::base_dir() . '/' . $key );
			$quota    = self::check_quota( get_current_user_id(), $bytes, $extra );
			if ( is_wp_error( $quota ) ) {
				return $quota;
			}
		}

		$dir = self::ensure_upload_dir( $key );
		$tmp = $file['tmp_name'] ?? '';

		if ( empty( $tmp ) || ! is_uploaded_file( $tmp ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Upload inválido.', 'v-dicom' ), array( 'status' => 400 ) );
		}

		$partNum  = $chunk_info['part'];
		$totalNum = $chunk_info['total'];
		$baseName = $chunk_info['baseName'];

		// Chunk identificado pelo hash do nome base — evita colisão entre
		// diferentes arquivos sendo divididos em paralelo na mesma pasta.
		$chunkTag = substr( md5( $baseName ), 0, 12 );
		$chunkPath = $dir . '/.chunk-' . $chunkTag . '.' . $partNum;
		// phpcs:ignore Generic.PHP.ForbiddenFunctions.Found -- temp file validated with is_uploaded_file()
		if ( ! @move_uploaded_file( $tmp, $chunkPath ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Não foi possível gravar o chunk.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		$fs = self::init_filesystem();
		if ( $fs ) {
			$fs->chmod( $chunkPath, 0644 );
		}

		// Se não for o último chunk, retornar info parcial
		if ( $partNum < $totalNum ) {
			return array(
				'name'      => $baseName,
				'url'       => self::base_url() . '/' . $key . '/.chunk-' . $chunkTag . '.' . $partNum,
				'kind'      => 'chunk',
				'size'      => $bytes,
				'chunk'     => true,
				'part'      => $partNum,
				'total'     => $totalNum,
				'finalName' => rtrim( $baseName, '.' ),
			);
		}

		// Última parte — verificar se todas as partes estão presentes.
		// O frontend envia os chunks em ordem, então o último só chega após
		// todos os anteriores já estarem gravados.
		$parts = array();
		for ( $i = 1; $i <= $totalNum; $i++ ) {
			$part_file = $dir . '/.chunk-' . $chunkTag . '.' . $i;
			if ( ! is_file( $part_file ) ) {
				return new WP_Error(
					'v_dicom_chunk',
					/* translators: %1$d: chunk number, %2$d: total chunks */
					sprintf( __( 'Chunk %1$d de %2$d não encontrado.', 'v-dicom' ), $i, $totalNum ),
					array( 'status' => 500 )
				);
			}
			$parts[ $i ] = $part_file;
		}

		// Montar o arquivo final
		$finalName = rtrim( $baseName, '.' );
		$safe      = sanitize_file_name( $finalName );
		if ( '' === $safe ) {
			$safe = __( 'arquivo', 'v-dicom' );
		}
		$ext = strtolower( (string) pathinfo( $safe, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, self::SAFE_EXT, true ) ) {
			$safe = pathinfo( $safe, PATHINFO_FILENAME ) . '.bin';
		}
		$target = $dir . '/' . wp_unique_filename( $dir, $safe );

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- requires binary streaming of chunk files
		$out = fopen( $target, 'wb' );
		if ( ! $out ) {
			return new WP_Error( 'v_dicom_upload', __( 'Não foi possível criar o arquivo final.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		for ( $i = 1; $i <= $totalNum; $i++ ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- requires binary streaming of chunk files
			$in = fopen( $parts[ $i ], 'rb' );
			if ( ! $in ) {
				// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- requires binary streaming of chunk files
				fclose( $out );
				return new WP_Error( 'v_dicom_upload', __( 'Erro ao ler chunk.', 'v-dicom' ), array( 'status' => 500 ) );
			}
			while ( ! feof( $in ) ) {
				// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite, WordPress.WP.AlternativeFunctions.file_system_operations_fread -- requires binary streaming of chunk files
				fwrite( $out, fread( $in, 65536 ) );
			}
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- requires binary streaming of chunk files
			fclose( $in );
			wp_delete_file( $parts[ $i ] ); // Limpar chunk após usar
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- requires binary streaming of chunk files
		fclose( $out );
		$fs = self::init_filesystem();
		if ( $fs ) {
			$fs->chmod( $target, 0644 );
		}

		$descriptor = array(
			'name' => $finalName,
			'url'  => self::base_url() . '/' . $key . '/' . wp_basename( $target ),
			'kind' => preg_match( '/\.(stl|ply|obj|mtl|png|jpe?g)$/i', $finalName ) ? 'mesh' : 'dicom',
			'size' => (int) filesize( $target ),
		);

		$post = self::find_scene( $key );
		if ( $post ) {
			$files   = get_post_meta( $post->ID, self::META_FILES, true );
			$files   = is_array( $files ) ? $files : array();
			$files[] = $descriptor;
			update_post_meta( $post->ID, self::META_FILES, $files );
		}

		return $descriptor;
	}

	/** Public representation of a scene consumed by the React viewer. */
	public static function scene_payload( $post ) {
		$files    = get_post_meta( $post->ID, self::META_FILES, true );
		$settings = get_post_meta( $post->ID, self::META_SETTINGS, true );
		$anns     = get_post_meta( $post->ID, self::META_ANNOTATIONS, true );
		$urls     = get_post_meta( $post->ID, '_v_dicom_urls', true );
		$urls     = is_array( $urls ) ? $urls : array();
		return array(
			'key'         => (string) get_post_meta( $post->ID, self::META_KEY, true ),
			'title'       => get_the_title( $post ),
			'settings'    => is_array( $settings ) ? $settings : null,
			'files'       => is_array( $files ) ? array_values( $files ) : array(),
			'urls'        => array_values( $urls ),
			'annotations' => is_array( $anns ) ? array_values( $anns ) : array(),
		);
	}

	/** Recursively delete a scene folder and its post. */
	public static function delete_scene( $post ) {
		$key = self::sanitize_key( get_post_meta( $post->ID, self::META_KEY, true ) );
		if ( $key ) {
			$dir = self::base_dir() . '/' . $key;
			if ( is_dir( $dir ) ) {
				foreach ( (array) glob( $dir . '/*' ) as $file ) {
					if ( is_file( $file ) ) {
						wp_delete_file( $file );
					}
				}
				$fs = self::init_filesystem();
				if ( $fs ) {
					$fs->rmdir( $dir );
				}
			}
		}
		wp_delete_post( $post->ID, true );
	}

	/**
	 * Remove files from the scene directory that are no longer referenced
	 * by the scene's files meta or mesh settings.
	 *
	 * @param string $key       Scene key.
	 * @param array  $settings  Sanitized settings array (may contain 'meshes').
	 */
	public static function cleanup_orphaned_files( $key, $settings ) {
		$key  = self::sanitize_key( $key );
		if ( '' === $key ) {
			error_log( "[v-dicom] cleanup_orphaned_files: empty key" );
			return 0;
		}

		$post = self::find_scene( $key );
		if ( ! $post ) {
			error_log( "[v-dicom] cleanup_orphaned_files: post not found for key=$key" );
			return 0;
		}

		$dir = self::base_dir() . '/' . $key;
		if ( ! is_dir( $dir ) ) {
			error_log( "[v-dicom] cleanup_orphaned_files: directory not found: $dir" );
			return 0;
		}

		// Collect all referenced filenames (basenames only)
		$referenced = array();

		// 1. Files explicitly tracked in _v_dicom_files meta
		$files_meta = get_post_meta( $post->ID, self::META_FILES, true );
		error_log( "[v-dicom] cleanup_orphaned_files: files_meta count=" . count( is_array( $files_meta ) ? $files_meta : array() ) );
		
		// Collect mesh names from settings for STL filtering
		$mesh_names = array();
		if ( isset( $settings['meshes'] ) && is_array( $settings['meshes'] ) ) {
			error_log( "[v-dicom] cleanup_orphaned_files: settings.meshes count=" . count( $settings['meshes'] ) );
			foreach ( $settings['meshes'] as $mesh ) {
				if ( isset( $mesh['name'] ) ) {
					$mesh_names[] = sanitize_file_name( $mesh['name'] );
				}
			}
		} else {
			error_log( "[v-dicom] cleanup_orphaned_files: settings.meshes not set or not array" );
		}
		
		if ( is_array( $files_meta ) ) {
			foreach ( $files_meta as $f ) {
				if ( isset( $f['url'] ) ) {
					$basename = wp_basename( $f['url'] );
					// For STL files, only include if still referenced in settings.meshes
					// DICOM and other files are always included
					$is_stl = ( strtolower( pathinfo( $basename, PATHINFO_EXTENSION ) ) === 'stl' );
					if ( $is_stl ) {
						if ( in_array( $basename, $mesh_names, true ) ) {
							$referenced[] = $basename;
						} else {
							error_log( "[v-dicom] cleanup_orphaned_files: excluding STL not in settings.meshes: $basename" );
						}
					} else {
						$referenced[] = $basename;
					}
				}
			}
		}

		// 2. Mesh files referenced in settings.meshes (already added via mesh_names above)
		// Also add to referenced to ensure any mesh not in files_meta is still tracked
		foreach ( $mesh_names as $name ) {
			$referenced[] = $name;
		}

		// 3. Annotation PNGs referenced in annotations meta
		$annotations = get_post_meta( $post->ID, self::META_ANNOTATIONS, true );
		if ( is_array( $annotations ) ) {
			foreach ( $annotations as $ann ) {
				if ( isset( $ann['png'] ) ) {
					$referenced[] = wp_basename( $ann['png'] );
				}
			}
		}

		// Normalize and deduplicate
		$referenced = array_unique( array_filter( $referenced ) );
		error_log( "[v-dicom] cleanup_orphaned_files: referenced files: " . implode( ', ', $referenced ) );

		// Scan directory for actual files
		$all_files = array();
		foreach ( (array) glob( $dir . '/*' ) as $file ) {
			if ( is_file( $file ) ) {
				$all_files[] = wp_basename( $file );
			}
		}
		error_log( "[v-dicom] cleanup_orphaned_files: directory files: " . implode( ', ', $all_files ) );

		$deleted_count = 0;
		$deleted_files = array();
		foreach ( $all_files as $name ) {
			$file = $dir . '/' . $name;

			// Skip hidden/temp files (chunks, .htaccess, index.php)
			if ( str_starts_with( $name, '.' ) || str_starts_with( $name, 'index.php' ) ) {
				continue;
			}

			// If file not in referenced list, delete it
			if ( ! in_array( $name, $referenced, true ) ) {
				error_log( "[v-dicom] cleanup_orphaned_files: deleting orphaned file: $name" );
				wp_delete_file( $file );
				$deleted_files[] = $name;
				$deleted_count++;
			}
		}

		// Update _v_dicom_files meta to remove entries for deleted files
		if ( ! empty( $deleted_files ) && is_array( $files_meta ) ) {
			$files_meta = array_filter( $files_meta, function( $f ) use ( $deleted_files ) {
				if ( ! isset( $f['url'] ) ) {
					return true;
				}
				$basename = wp_basename( $f['url'] );
				return ! in_array( $basename, $deleted_files, true );
			} );
			update_post_meta( $post->ID, self::META_FILES, array_values( $files_meta ) );
			error_log( "[v-dicom] cleanup_orphaned_files: updated files_meta, removed " . count( $deleted_files ) . " entries" );
		}

		error_log( "[v-dicom] cleanup_orphaned_files: deleted $deleted_count files" );
		return $deleted_count;
	}

	/**
	 * Storage limit of a user in MB: the admin-defined base limit plus the MB
	 * of every purchased plan that has not expired yet. The base limit alone
	 * being 0 blocks the user only while no plans are active.
	 */
	public static function user_limit_mb( $user_id ) {
		$user_id = (int) $user_id;
		if ( ! $user_id ) {
			return 0;
		}
		$base = max( 0, (int) get_user_meta( $user_id, self::META_LIMIT, true ) );
		return $base + self::active_plans_mb( $user_id );
	}

	/** Storage limit in bytes; 0 means the user cannot upload anything. */
	public static function user_limit_bytes( $user_id ) {
		return self::user_limit_mb( $user_id ) * 1024 * 1024;
	}

	/** Total bytes used by the user, summing every scene folder. */
	public static function used_bytes( $user_id ) {
		$user_id = (int) $user_id;
		$total   = 0;
		foreach ( self::scenes_for_user( $user_id ) as $post ) {
			$key = self::sanitize_key( get_post_meta( $post->ID, self::META_KEY, true ) );
			if ( $key ) {
				$total += self::dir_size( self::base_dir() . '/' . $key );
			}
		}
		return $total;
	}

	/** Available bytes, considering the limit. 0 when the limit is 0. */
	public static function available_bytes( $user_id ) {
		$limit = self::user_limit_bytes( $user_id );
		if ( ! $limit ) {
			return 0;
		}
		return max( 0, $limit - self::used_bytes( $user_id ) );
	}

	/**
	 * Check whether a user may store $bytes. Returns true or a WP_Error.
	 *
	 * @param int $user_id User id.
	 * @param int $bytes   Bytes the new upload will occupy.
	 * @param int $extra   Bytes already written to a key that is not yet a scene
	 *                     (an open upload session), avoiding overshoot.
	 */
	public static function check_quota( $user_id, $bytes, $extra = 0 ) {
		$user_id = (int) $user_id;
		$limit   = self::user_limit_bytes( $user_id );
		$bytes   = max( 0, (int) $bytes );
		$extra   = max( 0, (int) $extra );

		if ( 0 === $limit ) {
			return new WP_Error(
				'v_dicom_quota',
				__( 'Seu limite de armazenamento é zero. Peça ao administrador para definir um limite antes de enviar estudos.', 'v-dicom' ),
				array( 'status' => 403 )
			);
		}
		if ( self::used_bytes( $user_id ) + $extra + $bytes > $limit ) {
			return new WP_Error(
				'v_dicom_quota',
				__( 'Limite de armazenamento atingido. Exclua uma cena em "Minhas cenas" ou peça mais espaço ao administrador.', 'v-dicom' ),
				array( 'status' => 413 )
			);
		}
		return true;
	}

	/** All scenes authored by a user, newest first. */
	public static function scenes_for_user( $user_id ) {
		$user_id = (int) $user_id;
		if ( ! $user_id ) {
			return array();
		}
		return get_posts(
			array(
				'post_type'   => V_DICOM_CPT,
				'post_status' => 'any',
				'numberposts' => 500,
				'author'      => $user_id,
				'orderby'     => 'date',
				'order'       => 'DESC',
			)
		);
	}

	/** Recursive size in bytes of a directory. */
	public static function dir_size( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return 0;
		}
		$total = 0;
		foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) ) as $entry ) {
			if ( $entry->isFile() ) {
				$total += (int) $entry->getSize();
			}
		}
		return $total;
	}

	/**
	 * Validate a single plane state (origin + u/v/n vectors) into a clean
	 * array of three-element float arrays.
	 */
	private static function sanitize_plane_state( $raw ) {
		$ps = array(
			'origin' => array( 0, 0, 0 ),
			'u'      => array( 1, 0, 0 ),
			'v'      => array( 0, 1, 0 ),
			'n'      => array( 0, 0, 1 ),
		);
		foreach ( $ps as $ax => $default ) {
			$arr = isset( $raw[ $ax ] ) && is_array( $raw[ $ax ] ) ? array_values( $raw[ $ax ] ) : array();
			$cur = array();
			foreach ( array_slice( $arr, 0, 3 ) as $val ) {
				$cur[] = (float) $val;
			}
			if ( count( $cur ) === 3 ) {
				$ps[ $ax ] = $cur;
			}
		}
		return $ps;
	}

	/**
	 * Validate annotations sent by the viewer. Only known fields are kept and
	 * PNG URLs must point inside this scene/session folder.
	 */
	public static function sanitize_annotations( $key, $raw ) {
		$key  = self::sanitize_key( $key );
		$base = self::base_url() . '/' . $key . '/';
		$out  = array();
		foreach ( (array) $raw as $a ) {
			if ( ! is_array( $a ) ) {
				continue;
			}
			$id   = sanitize_key( (string) ( $a['id'] ?? '' ) );
			$kind = in_array( ( $a['kind'] ?? '' ), array( 'text', 'mark', 'measure', 'arrow', 'draw' ), true ) ? $a['kind'] : 'mark';
			$plane = in_array( ( $a['plane'] ?? '' ), array( 'axial', 'coronal', 'sagittal' ), true ) ? $a['plane'] : 'axial';
			if ( '' === $id ) {
				continue;
			}

			$points = array();
			foreach ( (array) ( $a['points'] ?? array() ) as $p ) {
				if ( is_array( $p ) && isset( $p['x'], $p['y'] ) ) {
					$points[] = array(
						'x' => max( 0, min( 1, (float) $p['x'] ) ),
						'y' => max( 0, min( 1, (float) $p['y'] ) ),
					);
					if ( count( $points ) >= 4000 ) {
						break;
					}
				}
			}
			if ( ! $points ) {
				continue;
			}

			$png = isset( $a['png'] ) ? esc_url_raw( (string) $a['png'] ) : '';
			if ( $png && 0 !== strpos( $png, $base ) ) {
				$png = '';
			}

			$ps = self::sanitize_plane_state( $a['planeState'] ?? array() );

			$allPlaneStates = null;
			if ( isset( $a['allPlaneStates'] ) && is_array( $a['allPlaneStates'] ) ) {
				$allPlaneStates = array();
				foreach ( array( 'axial', 'coronal', 'sagittal' ) as $pln ) {
					if ( isset( $a['allPlaneStates'][ $pln ] ) && is_array( $a['allPlaneStates'][ $pln ] ) ) {
						$allPlaneStates[ $pln ] = self::sanitize_plane_state( $a['allPlaneStates'][ $pln ] );
					}
				}
			}

			$color = sanitize_hex_color( (string) ( $a['color'] ?? '' ) );
			if ( empty( $a['color'] ) || ! $color ) {
				$color = '#ff5d73';
			}
			$measure = null;
			if ( isset( $a['measure']['lengthMm'] ) && is_numeric( $a['measure']['lengthMm'] ) ) {
				$measure = array( 'lengthMm' => max( 0, (float) $a['measure']['lengthMm'] ) );
			}

			$out[] = array(
				'id'             => $id,
				'kind'           => $kind,
				'plane'          => $plane,
				'label'          => sanitize_text_field( (string) ( $a['label'] ?? '' ) ),
				'text'           => sanitize_textarea_field( (string) ( $a['text'] ?? '' ) ),
				'color'          => $color,
				'points'         => $points,
				'measure'        => $measure,
				'png'            => $png,
				'hidden'         => ! empty( $a['hidden'] ),
				'planeState'     => $ps,
				'allPlaneStates' => $allPlaneStates,
				'created'        => sanitize_text_field( (string) ( $a['created'] ?? '' ) ),
			);
			if ( count( $out ) >= 300 ) {
				break;
			}
		}
		return $out;
	}

	/** Store one annotation PNG inside the scene/session folder. */
	public static function store_annotation_png( $key, $file ) {
		$key = self::sanitize_key( $key );
		if ( '' === $key ) {
			return new WP_Error( 'v_dicom_upload', __( 'Chave inválida.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		if ( empty( $file['tmp_name'] ) || ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Upload inválido.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		$bytes = isset( $file['size'] ) ? (int) $file['size'] : (int) @filesize( $file['tmp_name'] );
		$post  = self::find_scene( $key );
		if ( $post && ! self::user_can_write_scene( $post ) ) {
			return new WP_Error(
				'v_dicom_forbidden',
				__( 'Esta cena pertence a outro usuário.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		$extra = $post ? 0 : self::dir_size( self::base_dir() . '/' . $key );
		$quota = self::check_quota( get_current_user_id(), $bytes, $extra );
		if ( is_wp_error( $quota ) ) {
			return $quota;
		}
		$dir    = self::ensure_upload_dir( $key );
		$name   = 'anno-' . substr( md5( wp_generate_password( 8, false, false ) . microtime() ), 0, 12 ) . '.png';
		$target = $dir . '/' . $name;
		// phpcs:ignore Generic.PHP.ForbiddenFunctions.Found -- temp file validated with is_uploaded_file()
		if ( ! @move_uploaded_file( $file['tmp_name'], $target ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Não foi possível gravar o arquivo.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		$fs = self::init_filesystem();
		if ( $fs ) {
			$fs->chmod( $target, 0644 );
		}
		return array( 'url' => self::base_url() . '/' . $key . '/' . $name );
	}

	/** Whitelist + clamp the settings object sent by the viewer. */
	public static function sanitize_settings( $raw ) {
		$raw = is_array( $raw ) ? $raw : array();
		$out = array();

		if ( isset( $raw['wc'] ) ) {
			$out['wc'] = max( -5000, min( 5000, (float) $raw['wc'] ) );
		}
		if ( isset( $raw['ww'] ) ) {
			$out['ww'] = max( 1, min( 10000, (float) $raw['ww'] ) );
		}
		if ( isset( $raw['invert'] ) ) {
			$out['invert'] = (bool) $raw['invert'];
		}
		if ( isset( $raw['flip'] ) && is_array( $raw['flip'] ) ) {
			$out['flip'] = array(
				'x' => ! empty( $raw['flip']['x'] ),
				'y' => ! empty( $raw['flip']['y'] ),
				'z' => ! empty( $raw['flip']['z'] ),
			);
		}
		if ( isset( $raw['threshold'] ) ) {
			$out['threshold'] = max( 0, min( 1, (float) $raw['threshold'] ) );
		}
		if ( isset( $raw['opacity'] ) ) {
			$out['opacity'] = max( 0, min( 1, (float) $raw['opacity'] ) );
		}
		if ( isset( $raw['showVolume'] ) ) {
			$out['showVolume'] = (bool) $raw['showVolume'];
		}
		if ( isset( $raw['meshRas'] ) ) {
			$out['meshRas'] = (bool) $raw['meshRas'];
		}
		$legacy_ras = isset( $raw['meshRas'] ) ? (bool) $raw['meshRas'] : true;
		if ( isset( $raw['cross'] ) && is_array( $raw['cross'] ) ) {
			$out['cross'] = array(
				'x' => max( 0, min( 1, (float) ( $raw['cross']['x'] ?? 0.5 ) ) ),
				'y' => max( 0, min( 1, (float) ( $raw['cross']['y'] ?? 0.5 ) ) ),
				'z' => max( 0, min( 1, (float) ( $raw['cross']['z'] ?? 0.5 ) ) ),
			);
		}
		if ( isset( $raw['showPlanes'] ) && is_array( $raw['showPlanes'] ) ) {
			$out['showPlanes'] = array(
				'axial'    => ! empty( $raw['showPlanes']['axial'] ),
				'coronal'  => ! empty( $raw['showPlanes']['coronal'] ),
				'sagittal' => ! empty( $raw['showPlanes']['sagittal'] ),
			);
		}
		if ( isset( $raw['meshes'] ) && is_array( $raw['meshes'] ) ) {
			$meshes = array();
			foreach ( array_slice( $raw['meshes'], 0, 100 ) as $mesh ) {
				if ( ! is_array( $mesh ) || empty( $mesh['name'] ) ) {
					continue;
				}
				$color = isset( $mesh['color'] ) ? sanitize_hex_color( (string) $mesh['color'] ) : null;
				$cs    = isset( $mesh['coordSystem'] ) ? strtolower( (string) $mesh['coordSystem'] ) : '';
				if ( 'lps' !== $cs && 'ras' !== $cs ) {
					$cs = $legacy_ras ? 'ras' : 'lps';
				}
				$meshes[] = array(
					'name'        => sanitize_text_field( (string) $mesh['name'] ),
					'color'       => $color ? $color : '#9fd9ff',
					'visible'     => ! empty( $mesh['visible'] ),
					'opacity'     => max( 0, min( 1, (float) ( $mesh['opacity'] ?? 1 ) ) ),
					'coordSystem' => $cs,
				);
			}
			$out['meshes'] = $meshes;
		}
		// URLs da cena (novo formato: array, ou legado: string única)
		if ( isset( $raw['urls'] ) && is_array( $raw['urls'] ) ) {
			$out['urls'] = array_map( 'esc_url_raw', $raw['urls'] );
		} elseif ( isset( $raw['urls'] ) && is_string( $raw['urls'] ) ) {
			// Legado: converter string única para array
			$out['urls'] = array( esc_url_raw( $raw['urls'] ) );
		}

		return $out;
	}

	/** Check if segmentation was already used for this scene */
	public static function isSegmentationUsed( $key ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( ! $post ) {
			return false;
		}
		return (bool) get_post_meta( $post->ID, self::SEGMENTATION_KEY, true );
	}

	/** Set segmentation used flag */
	public static function setSegmentationUsed( $key, $used = true ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			update_post_meta( $post->ID, self::SEGMENTATION_KEY, $used );
		}
	}

	/** Set the segmentation job ID. */
	public static function setJobId( $key, $jobId ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			update_post_meta( $post->ID, self::JOB_ID_KEY, $jobId );
		}
	}

	/** Get the segmentation job ID. */
	public static function getJobId( $key ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			return get_post_meta( $post->ID, self::JOB_ID_KEY, true );
		}
		return null;
	}

	/** Set the segmentation job status. */
	public static function setJobStatus( $key, $status ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			update_post_meta( $post->ID, self::JOB_STATUS_KEY, $status );
		}
	}

	/** Get the segmentation job status. */
	public static function getJobStatus( $key ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			return get_post_meta( $post->ID, self::JOB_STATUS_KEY, true );
		}
		return null;
	}

	/** Set the upload and download URLs used by a segmentation job. */
	public static function setSegmentationUrls( $key, $uploadUrl, $downloadUrl ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			update_post_meta( $post->ID, self::UPLOAD_URL_KEY, $uploadUrl );
			update_post_meta( $post->ID, self::DOWNLOAD_URL_KEY, $downloadUrl );
		}
	}

	/** Get the upload URL used by a segmentation job. */
	public static function getSegmentationUploadUrl( $key ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			return get_post_meta( $post->ID, self::UPLOAD_URL_KEY, true );
		}
		return '';
	}

	/** Get the download URL used by a segmentation job. */
	public static function getSegmentationDownloadUrl( $key ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			return get_post_meta( $post->ID, self::DOWNLOAD_URL_KEY, true );
		}
		return '';
	}

	/** Reset segmentation metadata */
	public static function resetSegmentation( $key ) {
		$key = self::sanitize_key( $key );
		$post = self::find_scene( $key );
		if ( $post ) {
			delete_post_meta( $post->ID, self::SEGMENTATION_KEY );
			delete_post_meta( $post->ID, self::JOB_ID_KEY );
			delete_post_meta( $post->ID, self::JOB_STATUS_KEY );
			delete_post_meta( $post->ID, self::UPLOAD_URL_KEY );
			delete_post_meta( $post->ID, self::DOWNLOAD_URL_KEY );
			delete_post_meta( $post->ID, self::RUN_DEBUG_KEY );
			delete_post_meta( $post->ID, self::RUN_DEBUG_TIME_KEY );
			delete_post_meta( $post->ID, '_v_dicom_runpod_run_response' );
			delete_post_meta( $post->ID, self::LAST_STATUS_DEBUG_KEY );
			delete_post_meta( $post->ID, self::LAST_STATUS_TIME_KEY );
			delete_post_meta( $post->ID, self::LAST_CALLBACK_KEY );
			delete_post_meta( $post->ID, self::LAST_CALLBACK_TIME_KEY );
			delete_post_meta( $post->ID, '_v_dicom_runpod_last_error' );
			delete_post_meta( $post->ID, '_v_dicom_runpod_last_output' );
			delete_post_meta( $post->ID, '_v_dicom_runpod_returncode' );
			delete_post_meta( $post->ID, self::SEG_COST_KEY );
			delete_post_meta( $post->ID, self::SEG_STARTED_AT_KEY );
			delete_post_meta( $post->ID, self::SEG_FINISHED_AT_KEY );
			delete_post_meta( $post->ID, '_v_dicom_seg_email_sent' );
			delete_post_meta( $post->ID, '_v_dicom_seg_email_last_error' );
			delete_post_meta( $post->ID, '_v_dicom_credit_refunded' );
		}
	}

	/** Get URL for uploading scene files */
	public static function getKeyUploadUrl( $key ) {
		$key = self::sanitize_key( $key );
		return rest_url( V_Dicom_REST::NS . '/uploads/' . $key . '/files' ) . '?apikey=' . rawurlencode( self::api_key() );
	}

	/** Get URL for downloading scene ZIP */
	public static function getKeyDownloadUrl( $key ) {
		$key = self::sanitize_key( $key );
		return rest_url( V_Dicom_REST::NS . '/download/' . $key . '/zip' ) . '?apikey=' . rawurlencode( self::api_key() );
	}

	/** Get callback URL for segmentation status (serverless service webhook). */
	public static function getKeyCallbackUrl( $key ) {
		$key = self::sanitize_key( $key );
		return rest_url( V_Dicom_REST::NS . '/scenes/' . $key . '/segmentation-status' ) . '?apikey=' . rawurlencode( self::api_key() );
	}

	/**
	 * Record that the current user has accessed a scene.
	 * Stores the scene key and timestamp in user meta.
	 */
	public static function record_scene_access( $key ) {
		$key = self::sanitize_key( $key );
		if ( '' === $key ) {
			return false;
		}
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return false;
		}
		$recent = (array) get_user_meta( $user_id, self::OPTION_RECENT_SCENES, true );
		
		// Keep only valid entries.
		$recent = array_values(
			array_filter( $recent, function( $item ) {
				return is_array( $item ) && ! empty( $item['key'] );
			} )
		);
		
		// Remove if already exists to move to top
		$recent = array_filter( $recent, function( $item ) use ( $key ) {
			return $item['key'] !== $key;
		} );
		
		// Add to beginning with current timestamp
		array_unshift( $recent, array(
			'key' => $key,
			'timestamp' => time(),
		) );
		
		// Limit to MAX_RECENT_SCENES
		$recent = array_slice( $recent, 0, self::MAX_RECENT_SCENES );
		
		update_user_meta( $user_id, self::OPTION_RECENT_SCENES, array_values( $recent ) );
		return true;
	}

	/**
	 * Get recently accessed scenes for the current user.
	 * Returns array of scene keys ordered by most recent first.
	 */
	public static function get_recent_scenes( $user_id = 0 ) {
		$user_id = $user_id ?: get_current_user_id();
		if ( ! $user_id ) {
			return array();
		}
		$recent = (array) get_user_meta( $user_id, self::OPTION_RECENT_SCENES, true );
		return array_map(
			function( $item ) { return is_array( $item ) ? (string) $item['key'] : ''; },
			$recent
		);
	}

	/**
	 * Get full recent scene data for the current user.
	 * Returns array of scene objects with key, title, etc.
	 */
	public static function get_recent_scenes_data( $user_id = 0 ) {
		$user_id = $user_id ?: get_current_user_id();
		if ( ! $user_id ) {
			return array();
		}
		$recent = (array) get_user_meta( $user_id, self::OPTION_RECENT_SCENES, true );
		$scenes = array();
		
		foreach ( $recent as $item ) {
			if ( ! is_array( $item ) || empty( $item['key'] ) ) {
				continue;
			}
			$key = self::sanitize_key( $item['key'] );
			if ( '' === $key ) {
				continue;
			}
			$post = self::find_scene( $key );
			if ( ! $post ) {
				continue;
			}
			$files = get_post_meta( $post->ID, self::META_FILES, true );
			$files = is_array( $files ) ? $files : array();
			$segs    = self::get_segmentations( $key );
			$seg_map = array();
			foreach ( $segs as $tid => $seg ) { $seg_map[ $tid ] = (string) ( $seg['status'] ?? 'UNKNOWN' ); }
			$scenes[] = array(
				'key'                => $key,
				'title'              => get_the_title( $post ),
				'fileCount'          => count( $files ),
				'bytes'              => self::dir_size( self::base_dir() . '/' . $key ),
				'created'            => get_the_date( 'c', $post ),
				'segmentationUsed'   => self::isSegmentationUsed( $key ) || ! empty( $segs ),
				'segmentationStatus' => self::getJobStatus( $key ) ?: ( $seg_map ? reset( $seg_map ) : '' ),
				'segmentations'      => $seg_map,
				'isOwn'              => (int) $post->post_author === $user_id,
				'accessedAt'         => $item['timestamp'],
			);
		}
		return $scenes;
	}
}
