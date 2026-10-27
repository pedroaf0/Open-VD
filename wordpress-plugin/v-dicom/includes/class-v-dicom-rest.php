<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * REST API consumed by the React viewer (see src/lib/wp.ts).
 *
 * GET  /v-dicom/v1/scenes/<key>           read a shared scene (public link)
 * POST /v-dicom/v1/scenes                 create a scene           (logged-in)
 * POST /v-dicom/v1/scenes/<key>/files     upload one study file    (owner)
 * POST /v-dicom/v1/scenes/<key>/settings  save viewer settings     (owner)
 * DELETE /v-dicom/v1/scenes/<key>         delete a scene           (owner)
 */
class V_Dicom_REST {

	const NS = 'v-dicom/v1';
	const DEBUG_SEGMENTATION = false; // set to true to include debug info in REST responses (for development)
	private $last_segmentation_debug = null;

	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	public function routes() {
		register_rest_route(
			self::NS,
			'/uploads',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'start_upload' ),
				'permission_callback' => array( $this, 'can_upload' ),
			)
		);

		register_rest_route(
			self::NS,
			'/uploads/(?P<key>[a-z0-9]+)/files',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'upload_session_file' ),
				'permission_callback' => array( $this, 'can_upload_or_apikey' ),
			)
		);

		register_rest_route(
			self::NS,
			'/download/(?P<key>[a-z0-9]+)/zip',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'download_zip' ),
				'permission_callback' => array( $this, 'can_download_zip' ),
			)
		);

		register_rest_route(
			self::NS,
			'/me',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'me' ),
				'permission_callback' => 'is_user_logged_in',
			)
		);

		register_rest_route(
			self::NS,
			'/uploads/(?P<key>[a-z0-9]+)/annotations',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'upload_session_annotation' ),
				'permission_callback' => array( $this, 'can_upload' ),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'create_scene' ),
				'permission_callback' => array( $this, 'can_upload' ),
				'args'                => array(
					'title' => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes/(?P<key>[a-z0-9]+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_scene' ),
					'permission_callback' => '__return_true',
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => array( $this, 'delete_scene' ),
					'permission_callback' => array( $this, 'can_upload' ),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes/(?P<key>[a-z0-9]+)/files',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'upload_file' ),
				'permission_callback' => array( $this, 'can_upload' ),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes/(?P<key>[a-z0-9]+)/settings',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'save_settings' ),
				'permission_callback' => array( $this, 'can_upload' ),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes/(?P<key>[a-z0-9]+)/annotations',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'upload_scene_annotation' ),
				'permission_callback' => array( $this, 'can_upload' ),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes/(?P<key>[a-z0-9]+)/run',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'run_segmentation' ),
				'permission_callback' => array( $this, 'can_run_segmentation' ),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes/(?P<key>[a-z0-9]+)/segmentation-status',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'check_segmentation_status' ),
					'permission_callback' => array( $this, 'can_view_scene' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'segmentation_callback' ),
					'permission_callback' => array( $this, 'can_view_scene' ),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/scenes/(?P<key>[a-z0-9]+)/access',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'mark_scene_accessed' ),
				'permission_callback' => 'is_user_logged_in',
			)
		);

		register_rest_route(
			self::NS,
			'/me/recent-scenes',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_recent_scenes' ),
				'permission_callback' => 'is_user_logged_in',
			)
		);

		// Authorize URL endpoint - consumes 1 credit
		register_rest_route(
			self::NS,
			'/authorized-url',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'authorize_url' ),
				'permission_callback' => array( $this, 'can_upload' ),
			)
		);
	}

	public function can_upload() {
		if ( ! v_dicom_can_upload() ) {
			return new WP_Error(
				'v_dicom_forbidden',
				__( 'Você não tem permissão para salvar cenas.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		return true;
	}

	/** Verify user has credit and scene hasn't been segmented before. */
	public function can_run_segmentation( WP_REST_Request $request ) {
		// Admin API-key requests bypass the ownership check.
		if ( $this->api_key_is_valid( $request ) ) {
			return true;
		}
		$check = $this->can_upload();
		if ( true !== $check ) {
			return $check;
		}
		$post = V_Dicom_Storage::find_scene( $request['key'] );
		if ( ! $post || (int) $post->post_author !== get_current_user_id() ) {
			return new WP_Error(
				'v_dicom_forbidden',
				__( 'Apenas o dono da cena pode solicitar a segmentação.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		return true;
	}

	/** Scene owner (or editor) may view segmentation status — or any caller with a valid admin API key. */
	public function can_view_scene( WP_REST_Request $request ) {
		if ( $this->api_key_is_valid( $request ) ) {
			return true;
		}
		$post = V_Dicom_Storage::find_scene( $request['key'] );
		if ( ! $post ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		if ( ! V_Dicom_Storage::user_can_write_scene( $post ) ) {
			return new WP_Error(
				'v_dicom_forbidden',
				__( 'Esta cena pertence a outro usuário.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		return true;
	}

	/** Execute automatic segmentation using an external serverless cloud service. */
	public function run_segmentation( WP_REST_Request $request ) {
		$key = V_Dicom_Storage::sanitize_key( $request['key'] );
		if ( '' === $key ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		$post = V_Dicom_Storage::find_scene( $key );
		if ( ! $post ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		$via_apikey = $this->api_key_is_valid( $request );
		if ( ! $via_apikey && (int) $post->post_author !== get_current_user_id() ) {
			return new WP_Error( 'v_dicom_forbidden', __( 'Apenas o dono da cena pode solicitar a segmentação.', 'v-dicom' ), array( 'status' => rest_authorization_required_code() ) );
		}
		$type_param = $request->get_param( 'type' );
		if ( null === $type_param ) { $type_param = $request->get_param( 'type_id' ); }
		$type_id = V_Dicom_Storage::sanitize_seg_type_id( $type_param ?? '' );
		$all_with_secret = V_Dicom_Storage::get_segmentation_types( true );
		if ( '' === $type_id ) {
			$enabled = array_values( array_filter( $all_with_secret, function( $t ) { return ! empty( $t['enabled'] ); } ) );
			if ( count( $enabled ) === 1 ) {
				$type_id = $enabled[0]['id'];
			} elseif ( count( $enabled ) > 1 ) {
				return new WP_Error( 'type_required', __( 'Informe o tipo de segmentação (type).', 'v-dicom' ), array( 'status' => 400 ) );
			} else {
				$legacy = get_option( 'v_dicom_runpod' ) ?: array();
				if ( ! empty( $legacy['url'] ) ) {
					$tmp = V_Dicom_Storage::sanitize_segmentation_type( array(
						'id'            => 'default',
						'name'          => __( 'Padrão', 'v-dicom' ),
						'url'           => $legacy['url'] ?? '',
						'authorization' => $legacy['authorization'] ?? '',
						'max_voxels'    => $legacy['max_voxels'] ?? 0,
						'max_triangles' => $legacy['max_triangles'] ?? 0,
						'cost'          => V_Dicom_Storage::segmentation_cost(),
						'enabled'       => true,
					), 'default' );
					if ( $tmp ) { $type_id = 'default'; $all_with_secret = array( $tmp ); }
				}
				if ( '' === $type_id ) {
					return new WP_Error( 'segmentation_config_missing', __( 'Nenhum tipo de segmentação configurado.', 'v-dicom' ), array( 'status' => 500 ) );
				}
			}
		}
		$seg_type = null;
		foreach ( $all_with_secret as $t ) { if ( $t['id'] === $type_id ) { $seg_type = $t; break; } }
		if ( ! $seg_type ) {
			return new WP_Error( 'type_not_found', __( 'Tipo de segmentação não encontrado.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		if ( empty( $seg_type['enabled'] ) ) {
			return new WP_Error( 'type_disabled', __( 'Este tipo de segmentação está desabilitado.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		if ( empty( $seg_type['url'] ) && empty( $seg_type['run_url'] ) ) {
			return new WP_Error( 'segmentation_config_missing', __( 'Configuração do serviço de segmentação ausente para este tipo.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		$existing = V_Dicom_Storage::get_segmentation( $key, $type_id );
		if ( $existing && ! empty( $existing['used'] ) ) {
			$prev_status = (string) ( $existing['status'] ?? '' );
			if ( 'FAILED' === $prev_status ) {
				V_Dicom_Storage::resetSegmentationForType( $key, $type_id );
			} else {
				return new WP_Error( 'duplicate_segmentation', __( 'Já foi feita uma segmentação deste tipo para esta cena.', 'v-dicom' ), array( 'status' => 400 ) );
			}
		}
		$user_id = (int) $post->post_author;
		if ( ! $user_id ) { $user_id = get_current_user_id(); }
		if ( ! $user_id ) {
			return new WP_Error( 'no_logged_in_user', __( 'É necessário estar logado.', 'v-dicom' ), array( 'status' => 401 ) );
		}

		// Build the download, upload and callback values that feed the template.
		$explicit_download = $request->get_param( 'download-url' );
		if ( null !== $explicit_download ) {
			$download_url_value = is_array( $explicit_download ) ? array_map( 'esc_url_raw', $explicit_download ) : esc_url_raw( (string) $explicit_download );
		} else {
			$zip_url   = V_Dicom_Storage::getKeyDownloadUrl( $key );
			$scene_urls = get_post_meta( $post->ID, '_v_dicom_urls', true );
			$scene_urls = is_array( $scene_urls ) ? array_values( array_filter( array_map( 'esc_url_raw', $scene_urls ) ) ) : array();
			if ( $scene_urls ) {
				$proxy_apikey = V_Dicom_Storage::api_key();
				$proxied = array_map( function( $u ) use ( $proxy_apikey ) { return V_DICOM_URL . 'includes/download.php?url=' . rawurlencode( $u ) . '&apikey=' . rawurlencode( $proxy_apikey ); }, $scene_urls );
				$download_url_value = array_merge( array( $zip_url ), $proxied );
			} else {
				$download_url_value = $zip_url;
			}
		}
		$download_urls = is_array( $download_url_value ) ? array_values( array_filter( $download_url_value ) ) : array( $download_url_value );
		$download_url  = (string) ( $download_urls[0] ?? '' );
		$upload_url    = esc_url_raw( (string) ( $request->get_param( 'upload-url' ) ?? V_Dicom_Storage::getKeyUploadUrl( $key ) ) );
		$callback_url  = esc_url_raw( (string) ( $request->get_param( 'callback-url' ) ?? V_Dicom_Storage::getKeyCallbackUrlForType( $key, $type_id ) ) );

		$template_vars = array(
			'download_url'  => $download_url,
			'download_urls' => $download_urls,
			'upload_url'    => $upload_url,
			'callback_url'  => $callback_url,
			'url'           => untrailingslashit( (string) ( $seg_type['url'] ?? '' ) ),
			'scene_key'     => $key,
			'type_id'       => $type_id,
			'type_name'     => (string) ( $seg_type['name'] ?? '' ),
			'job_id'        => '',
			'site_url'      => home_url( '/' ),
			'timestamp'     => time(),
		);

		$payload_template = (string) ( $seg_type['payload'] ?? '' );
		if ( '' === trim( $payload_template ) ) {
			$payload_template = V_Dicom_Storage::default_segmentation_payload();
		}
		$payload = trim( V_Dicom_Storage::render_segmentation_template( $payload_template, $template_vars ) );
		if ( '' === $payload ) {
			return new WP_Error( 'segmentation_payload_empty', __( 'O payload da segmentação está vazio.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		$first_char = substr( ltrim( $payload ), 0, 1 );
		if ( '{' === $first_char || '[' === $first_char ) {
			json_decode( $payload, true );
			if ( JSON_ERROR_NONE !== json_last_error() ) {
				return new WP_Error( 'segmentation_payload_invalid', __( 'O payload renderizado não é um JSON válido.', 'v-dicom' ), array( 'status' => 500 ) );
			}
		}

		$run_template = trim( (string) ( $seg_type['run_url'] ?? '' ) );
		if ( '' === $run_template ) {
			$run_template = '{{url}}/run';
		}
		$run_url = esc_url_raw( V_Dicom_Storage::render_segmentation_template( $run_template, $template_vars, 'raw' ) );
		if ( '' === $run_url ) {
			return new WP_Error( 'segmentation_config_missing', __( 'Endereço de execução do serviço de segmentação ausente.', 'v-dicom' ), array( 'status' => 500 ) );
		}

		$seg_cost = max( 0, (int) $seg_type['cost'] );
		$credits  = V_Dicom_Storage::user_credit( $user_id );
		if ( $seg_cost > 0 ) {
			if ( $credits < $seg_cost ) {
				/* translators: %d: cost in credits */
				return new WP_Error( 'no_credit', sprintf( __( 'Crédito insuficiente para segmentar. Custo: %d créditos.', 'v-dicom' ), $seg_cost ), array( 'status' => 403 ) );
			}
			V_Dicom_Storage::set_user_credit( $user_id, $credits - $seg_cost );
		}

		$response = $this->make_segmentation_request( $run_url, (string) ( $seg_type['authorization'] ?? '' ), $payload, $payload_template, $template_vars );
		$now_dbg = time();
		V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'run_debug' => $this->last_segmentation_debug, 'run_debug_time' => $now_dbg, 'run_response' => is_wp_error( $response ) ? null : $response ) );
		if ( is_wp_error( $response ) ) {
			if ( $seg_cost > 0 ) { V_Dicom_Storage::set_user_credit( $user_id, $credits ); }
			return $response;
		}
		$job_id = $this->extract_segmentation_job_id( $response );
		if ( '' === $job_id ) {
			if ( $seg_cost > 0 ) { V_Dicom_Storage::set_user_credit( $user_id, $credits ); }
			$err = new WP_Error( 'segmentation_invalid_response', __( 'O serviço de segmentação não retornou um identificador de job.', 'v-dicom' ), array( 'status' => 500 ) );
			if ( self::DEBUG_SEGMENTATION && $this->last_segmentation_debug ) {
				$err->add_data( array( 'debug' => $this->last_segmentation_debug ), 'segmentation_invalid_response' );
			}
			return $err;
		}
		$raw_status     = $this->extract_segmentation_status( $response );
		$initial_status = '' === $raw_status ? 'IN_QUEUE' : $this->normalize_segmentation_status( $raw_status );
		V_Dicom_Storage::set_segmentation( $key, $type_id, array(
			'used' => true, 'job_id' => $job_id, 'status' => $initial_status, 'upload_url' => $upload_url, 'download_url' => $download_url, 'cost' => $seg_cost, 'started_at' => $now_dbg, 'finished_at' => '', 'credit_refunded' => '', 'email_sent' => ''
		) );
		delete_post_meta( $post->ID, V_Dicom_Storage::SEG_FINISHED_AT_KEY );
		$payload = array( 'job_id' => $job_id, 'status' => $initial_status, 'type' => $type_id );
		if ( self::DEBUG_SEGMENTATION && $this->last_segmentation_debug ) { $payload['debug'] = $this->last_segmentation_debug; $payload['segmentation_response_raw'] = $response; }
		return rest_ensure_response( $payload );
	}

	/** Helper: POST the rendered payload to the configured run endpoint. */
	private function make_segmentation_request( $url, $auth_header, $payload, $template, $vars ) {
		$headers = array( 'Content-Type' => 'application/json' );
		if ( '' !== trim( (string) $auth_header ) ) {
			$headers['Authorization'] = $auth_header;
		}
		$debug_headers = $headers;
		if ( isset( $debug_headers['Authorization'] ) ) {
			$debug_headers['Authorization'] = '***';
		}

		$response = wp_remote_post(
			$url,
			array(
				'headers'   => $headers,
				'timeout'   => 60,
				'sslverify' => true,
				'body'      => $payload,
			)
		);

		$debug_base = array(
			'service_url_config' => (string) ( $vars['url'] ?? '' ),
			'request_url'        => $url,
			'request_method'     => 'POST',
			'request_headers'    => $debug_headers,
			'request_body'       => $payload,
			'payload_template'   => $template,
			'placeholders'       => $vars,
			'timestamp'          => time(),
		);

		if ( is_wp_error( $response ) ) {
			$this->last_segmentation_debug = array_merge( $debug_base, array(
				'wp_error'      => $response->get_error_message(),
				'wp_error_code' => $response->get_error_code(),
			) );
			error_log( sprintf( '[v-dicom-segmentation] RUN request ERROR: url=%s error=%s code=%s', $url, $response->get_error_message(), $response->get_error_code() ) );
			$err = new WP_Error( 'segmentation_request_failed', $response->get_error_message(), array( 'status' => 500 ) );
			if ( self::DEBUG_SEGMENTATION ) {
				$err->add_data( array( 'debug' => $this->last_segmentation_debug ), 'segmentation_request_failed' );
			}
			return $err;
		}

		$status_code  = wp_remote_retrieve_response_code( $response );
		$body         = wp_remote_retrieve_body( $response );
		$resp_headers = wp_remote_retrieve_headers( $response );
		$data         = json_decode( $body, true );

		$this->last_segmentation_debug = array_merge( $debug_base, array(
			'response_code'     => $status_code,
			'response_headers'  => is_object( $resp_headers ) ? $resp_headers->getAll() : (array) $resp_headers,
			'response_body_raw' => $body,
			'response_json'     => $data,
		) );

		error_log( sprintf( '[v-dicom-segmentation] RUN request: url=%s code=%d body=%s', $url, $status_code, substr( $body, 0, 2000 ) ) );

		if ( $status_code < 200 || $status_code >= 300 ) {
			/* translators: %d: HTTP status code */
			$err = new WP_Error( 'segmentation_request_failed', sprintf( __( 'O serviço de segmentação respondeu com HTTP %d.', 'v-dicom' ), $status_code ), array( 'status' => $status_code ) );
			if ( self::DEBUG_SEGMENTATION ) {
				$err->add_data( array( 'debug' => $this->last_segmentation_debug ), 'segmentation_request_failed' );
			}
			return $err;
		}

		if ( is_null( $data ) ) {
			$err = new WP_Error( 'segmentation_invalid_response', __( 'Resposta inválida do serviço de segmentação.', 'v-dicom' ), array( 'status' => 500 ) );
			if ( self::DEBUG_SEGMENTATION ) {
				$err->add_data( array( 'debug' => $this->last_segmentation_debug ), 'segmentation_invalid_response' );
			}
			return $err;
		}

		return $data;
	}

	/** Extract a job id from common serverless response shapes. */
	private function extract_segmentation_job_id( $data ) {
		if ( ! is_array( $data ) ) {
			return '';
		}
		$paths = array(
			array( 'id' ),
			array( 'job_id' ),
			array( 'jobId' ),
			array( 'request_id' ),
			array( 'requestId' ),
			array( 'task_id' ),
			array( 'taskId' ),
			array( 'execution_id' ),
			array( 'executionId' ),
			array( 'uid' ),
			array( 'data', 'id' ),
			array( 'data', 'job_id' ),
			array( 'data', 'jobId' ),
			array( 'data', 'request_id' ),
			array( 'data', 'task_id' ),
			array( 'result', 'id' ),
			array( 'result', 'job_id' ),
			array( 'output', 'id' ),
			array( 'output', 'job_id' ),
		);
		foreach ( $paths as $path ) {
			$value = $data;
			foreach ( $path as $part ) {
				if ( ! is_array( $value ) || ! isset( $value[ $part ] ) ) {
					continue 2;
				}
				$value = $value[ $part ];
			}
			if ( is_string( $value ) || is_int( $value ) ) {
				$value = trim( (string) $value );
				if ( '' !== $value ) {
					return $value;
				}
			}
		}
		return '';
	}

	/** Read the status field from common serverless response shapes. */
	private function extract_segmentation_status( $data ) {
		if ( ! is_array( $data ) ) {
			return '';
		}
		$paths = array(
			array( 'status' ),
			array( 'state' ),
			array( 'job_status' ),
			array( 'jobStatus' ),
			array( 'data', 'status' ),
			array( 'data', 'state' ),
			array( 'result', 'status' ),
			array( 'output', 'status' ),
		);
		foreach ( $paths as $path ) {
			$value = $data;
			foreach ( $path as $part ) {
				if ( ! is_array( $value ) || ! isset( $value[ $part ] ) ) {
					continue 2;
				}
				$value = $value[ $part ];
			}
			if ( is_string( $value ) && '' !== trim( $value ) ) {
				return trim( $value );
			}
		}
		return '';
	}

	/** Check the segmentation job status at the configured status URL. */
	public function check_segmentation_status( WP_REST_Request $request ) {
		$key = V_Dicom_Storage::sanitize_key( $request['key'] );
		if ( '' === $key ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		$type_id = V_Dicom_Storage::sanitize_seg_type_id( $request->get_param( 'type' ) ?? $request->get_param( 'type_id' ) ?? '' );
		$segmentations = V_Dicom_Storage::get_segmentations( $key );
		if ( '' === $type_id ) {
			if ( ! empty( $segmentations ) ) {
				if ( count( $segmentations ) === 1 ) {
					$type_id = array_keys( $segmentations )[0];
				} else {
					$map = array();
					foreach ( $segmentations as $tid => $seg ) { $map[ $tid ] = (string) ( $seg['status'] ?? 'UNKNOWN' ); }
					return rest_ensure_response( array( 'segmentations' => $map, 'status' => $map[ array_keys( $map )[0] ] ?? 'UNKNOWN' ) );
				}
			}
			if ( '' === $type_id ) {
				$legacy_job = V_Dicom_Storage::getJobId( $key );
				if ( '' !== (string) $legacy_job ) { $type_id = 'default'; }
			}
			if ( '' === $type_id ) {
				return new WP_Error( 'no_job_id', __( 'Nenhum job de segmentação encontrado para esta cena.', 'v-dicom' ), array( 'status' => 404 ) );
			}
		}
		$seg = V_Dicom_Storage::get_segmentation( $key, $type_id );
		if ( ! $seg && empty( $segmentations ) ) {
			$legacy_job = V_Dicom_Storage::getJobId( $key );
			if ( '' !== (string) $legacy_job ) {
				V_Dicom_Storage::get_segmentations( $key );
				$seg = V_Dicom_Storage::get_segmentation( $key, $type_id );
			}
		}
		if ( ! $seg || empty( $seg['job_id'] ) ) {
			return new WP_Error( 'no_job_id', __( 'Nenhum job de segmentação encontrado para este tipo nesta cena.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		$job_id = (string) $seg['job_id'];
		$all_types = V_Dicom_Storage::get_segmentation_types( true );
		$seg_config = null;
		foreach ( $all_types as $t ) { if ( $t['id'] === $type_id ) { $seg_config = $t; break; } }
		if ( ! $seg_config ) {
			$legacy = get_option( 'v_dicom_runpod' ) ?: array();
			if ( 'default' === $type_id && ! empty( $legacy['url'] ) ) {
				$seg_config = V_Dicom_Storage::sanitize_segmentation_type( array(
					'id'            => 'default',
					'name'          => __( 'Padrão', 'v-dicom' ),
					'url'           => $legacy['url'] ?? '',
					'authorization' => $legacy['authorization'] ?? '',
					'max_voxels'    => $legacy['max_voxels'] ?? 0,
					'max_triangles' => $legacy['max_triangles'] ?? 0,
					'cost'          => V_Dicom_Storage::segmentation_cost(),
					'enabled'       => true,
				), 'default' );
			}
		}
		if ( ! $seg_config ) {
			return new WP_Error( 'segmentation_config_missing', __( 'Configuração do serviço de segmentação ausente para este tipo.', 'v-dicom' ), array( 'status' => 500 ) );
		}

		$template_vars = array(
			'download_url'  => '',
			'download_urls' => array(),
			'upload_url'    => '',
			'callback_url'  => '',
			'url'           => untrailingslashit( (string) ( $seg_config['url'] ?? '' ) ),
			'scene_key'     => $key,
			'type_id'       => $type_id,
			'type_name'     => (string) ( $seg_config['name'] ?? '' ),
			'job_id'        => $job_id,
			'site_url'      => home_url( '/' ),
			'timestamp'     => time(),
		);
		$status_template = trim( (string) ( $seg_config['status_url'] ?? '' ) );
		if ( '' === $status_template ) {
			$status_template = '{{url}}/status/{{job_id}}';
		}
		$status_url = esc_url_raw( V_Dicom_Storage::render_segmentation_template( $status_template, $template_vars, 'raw' ) );
		if ( '' === $status_url ) {
			return new WP_Error( 'segmentation_config_missing', __( 'Endereço de status do serviço de segmentação ausente.', 'v-dicom' ), array( 'status' => 500 ) );
		}

		$headers = array( 'Content-Type' => 'application/json' );
		$auth    = trim( (string) ( $seg_config['authorization'] ?? '' ) );
		if ( '' !== $auth ) {
			$headers['Authorization'] = $auth;
		}
		$debug_headers = $headers;
		if ( isset( $debug_headers['Authorization'] ) ) {
			$debug_headers['Authorization'] = '***';
		}

		$response = wp_remote_get( $status_url, array( 'timeout' => 60, 'sslverify' => true, 'headers' => $headers ) );
		$scene_post = V_Dicom_Storage::find_scene( $key );
		$debug_base = array(
			'service_url_config' => $template_vars['url'],
			'request_url'        => $status_url,
			'request_method'     => 'GET',
			'request_headers'    => $debug_headers,
			'job_id'             => $job_id,
			'timestamp'          => time(),
			'type'               => $type_id,
		);

		if ( is_wp_error( $response ) ) {
			$tmp = array_merge( $debug_base, array(
				'wp_error'      => $response->get_error_message(),
				'wp_error_code' => $response->get_error_code(),
			) );
			if ( $scene_post ) { V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'last_status_debug' => $tmp, 'last_status_time' => time() ) ); }
			error_log( sprintf( '[v-dicom-segmentation] POLL ERROR: key=%s type=%s job=%s url=%s error=%s code=%s', $key, $type_id, $job_id, $status_url, $response->get_error_message(), $response->get_error_code() ) );
			$err = new WP_Error( 'segmentation_status_error', $response->get_error_message(), array( 'status' => 500 ) );
			if ( self::DEBUG_SEGMENTATION ) { $err->add_data( array( 'debug' => $tmp ), 'segmentation_status_error' ); }
			return $err;
		}
		$status_code  = wp_remote_retrieve_response_code( $response );
		$body         = wp_remote_retrieve_body( $response );
		$resp_headers = wp_remote_retrieve_headers( $response );
		$data         = json_decode( $body, true );
		$debug_status = array_merge( $debug_base, array(
			'response_code'     => $status_code,
			'response_headers'  => is_object( $resp_headers ) ? $resp_headers->getAll() : (array) $resp_headers,
			'response_body_raw' => $body,
			'response_json'     => $data,
		) );
		if ( $scene_post ) { V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'last_status_debug' => $debug_status, 'last_status_time' => time() ) ); }
		error_log( sprintf( '[v-dicom-segmentation] POLL key=%s type=%s job=%s url=%s code=%d status=%s body=%s', $key, $type_id, $job_id, $status_url, $status_code, $raw_status, substr( $body, 0, 2000 ) ) );
		if ( $status_code < 200 || $status_code >= 300 ) {
			/* translators: %d: HTTP status code */
			$err = new WP_Error( 'segmentation_status_error', sprintf( __( 'O serviço de segmentação respondeu com HTTP %d.', 'v-dicom' ), $status_code ), array( 'status' => $status_code ) );
			if ( self::DEBUG_SEGMENTATION ) { $err->add_data( array( 'debug' => $debug_status ), 'segmentation_status_error' ); }
			return $err;
		}
		if ( is_null( $data ) ) {
			$err = new WP_Error( 'segmentation_invalid_response', __( 'Resposta inválida do serviço de segmentação.', 'v-dicom' ), array( 'status' => 500 ) );
			if ( self::DEBUG_SEGMENTATION ) { $err->add_data( array( 'debug' => $debug_status ), 'segmentation_invalid_response' ); }
			return $err;
		}
		$raw_status = $this->extract_segmentation_status( $data );
		$status     = '' === $raw_status ? 'UNKNOWN' : $this->normalize_segmentation_status( $raw_status );
		V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'status' => $status ) );
		if ( in_array( $status, array( 'COMPLETED', 'FAILED' ), true ) ) {
			$cur = V_Dicom_Storage::get_segmentation( $key, $type_id );
			if ( empty( $cur['finished_at'] ) ) { V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'finished_at' => time() ) ); }
			$sp = $scene_post ? $scene_post : V_Dicom_Storage::find_scene( $key );
			if ( $sp ) { $this->maybe_notify_segmentation_done( $sp, $status, $type_id ); }
		}
		if ( 'FAILED' === $status ) {
			$post = V_Dicom_Storage::find_scene( $key );
			$owner = $post ? (int) $post->post_author : get_current_user_id();
			$cur = $post ? V_Dicom_Storage::get_segmentation( $key, $type_id ) : null;
			$refunded = $cur ? ! empty( $cur['credit_refunded'] ) : true;
			if ( ! $refunded && $owner ) {
				$raw = $cur ? $cur['cost'] ?? '' : '';
				$refund = ( '' === $raw || null === $raw ) ? V_Dicom_Storage::segmentation_cost() : max( 0, (int) $raw );
				if ( $refund > 0 ) { $credits = V_Dicom_Storage::user_credit( $owner ); V_Dicom_Storage::set_user_credit( $owner, $credits + $refund ); }
				V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'credit_refunded' => 1 ) );
			}
		}
		$payload = array( 'status' => $status, 'type' => $type_id );
		if ( self::DEBUG_SEGMENTATION ) { $payload['debug'] = $debug_status; $payload['segmentation_response_raw'] = $data; }
		return rest_ensure_response( $payload );
	}

	/** Serverless service callback: POST application/json to the callback URL sent in the payload. */
	public function segmentation_callback( WP_REST_Request $request ) {
		$key = V_Dicom_Storage::sanitize_key( $request['key'] );
		if ( '' === $key ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		$post = V_Dicom_Storage::find_scene( $key );
		if ( ! $post ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		$type_id = V_Dicom_Storage::sanitize_seg_type_id( $request->get_param( 'type' ) ?? $request->get_param( 'type_id' ) ?? '' );
		$params = $request->get_json_params();
		if ( ! is_array( $params ) || empty( $params ) ) { $params = $request->get_params(); }
		$raw_status = '';
		if ( isset( $params['status'] ) ) {
			$raw_status = trim( (string) $params['status'] );
		} elseif ( isset( $params['state'] ) ) {
			$raw_status = trim( (string) $params['state'] );
		}
		if ( '' === $raw_status ) {
			return new WP_Error( 'v_dicom_bad_request', __( 'Campo status ausente.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		$status = $this->normalize_segmentation_status( $raw_status );
		if ( '' === $type_id ) {
			$map = V_Dicom_Storage::get_segmentations( $key );
			if ( count( $map ) === 1 ) { $type_id = array_keys( $map )[0]; }
			elseif ( ! empty( $params['job_id'] ) && is_string( $params['job_id'] ) ) {
				foreach ( $map as $tid => $seg ) { if ( ( $seg['job_id'] ?? '' ) === $params['job_id'] ) { $type_id = $tid; break; } }
			}
			if ( '' === $type_id ) { $type_id = array_keys( $map )[0] ?? 'default'; }
		}
		$callback_debug = array( 'timestamp' => time(), 'headers' => function_exists( 'getallheaders' ) ? getallheaders() : array(), 'query_apikey' => substr( (string) $request->get_param( 'apikey' ), 0, 8 ) . '…', 'body_params' => $params, 'raw_body' => $request->get_body(), 'mapped_status' => $status, 'type' => $type_id );
		V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'last_callback' => $callback_debug, 'last_callback_time' => time() ) );
		error_log( sprintf( '[v-dicom-segmentation] CALLBACK key=%s type=%s job=%s status=%s raw_status=%s params=%s', $key, $type_id, ( $params['job_id'] ?? '' ), $status, $raw_status, wp_json_encode( $params ) ) );
		if ( ! empty( $params['job_id'] ) && is_string( $params['job_id'] ) ) {
			$cur = V_Dicom_Storage::get_segmentation( $key, $type_id );
			if ( empty( $cur['job_id'] ) ) { V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'job_id' => sanitize_text_field( $params['job_id'] ), 'used' => true ) ); }
		}
		V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'status' => $status, 'used' => true ) );
		if ( in_array( $status, array( 'COMPLETED', 'FAILED' ), true ) ) {
			$cur2 = V_Dicom_Storage::get_segmentation( $key, $type_id );
			if ( empty( $cur2['finished_at'] ) ) { V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'finished_at' => time() ) ); }
			$this->maybe_notify_segmentation_done( $post, $status, $type_id );
		}
		if ( isset( $params['error'] ) || isset( $params['output'] ) ) {
			$err = isset( $params['error'] ) ? substr( (string) $params['error'], 0, 4000 ) : '';
			$out = isset( $params['output'] ) ? substr( (string) $params['output'], 0, 8000 ) : '';
			V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'last_error' => sanitize_textarea_field( $err ), 'last_output' => sanitize_textarea_field( $out ) ) );
			if ( isset( $params['returncode'] ) ) { V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'returncode' => (int) $params['returncode'] ) ); }
		}
		if ( 'FAILED' === $status ) {
			$owner = (int) $post->post_author;
			$cur = V_Dicom_Storage::get_segmentation( $key, $type_id );
			$refunded = $cur ? ! empty( $cur['credit_refunded'] ) : true;
			if ( ! $refunded && $owner ) {
				$raw = $cur ? $cur['cost'] ?? '' : '';
				$refund = ( '' === $raw || null === $raw ) ? V_Dicom_Storage::segmentation_cost() : max( 0, (int) $raw );
				if ( $refund > 0 ) { $credits = V_Dicom_Storage::user_credit( $owner ); V_Dicom_Storage::set_user_credit( $owner, $credits + $refund ); }
				V_Dicom_Storage::set_segmentation( $key, $type_id, array( 'credit_refunded' => 1 ) );
			}
		}
		return rest_ensure_response( array( 'status' => $status, 'key' => $key, 'type' => $type_id ) );
	}

	/** Permission callback shared by the API-key flows: a valid ?apikey= matches
	 * the key configured by the admin, otherwise the normal login check runs.
	 */
	public function can_upload_or_apikey( $request ) {
		if ( $this->api_key_is_valid( $request ) ) {
			return true;
		}
		return $this->can_upload();
	}

	/** The zip download is only reachable with a valid admin API key. */
	public function can_download_zip( $request ) {
		if ( $this->api_key_is_valid( $request ) ) {
			return true;
		}
		return new WP_Error(
			'v_dicom_forbidden',
			__( 'Chave de API inválida.', 'v-dicom' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	private function maybe_notify_segmentation_done( $post, $status, $type_id = '' ) {
		if ( ! $post || ! in_array( $status, array( 'COMPLETED', 'FAILED' ), true ) ) {
			return;
		}
		$type_id = V_Dicom_Storage::sanitize_seg_type_id( $type_id );
		if ( '' !== $type_id ) {
			$cur = V_Dicom_Storage::get_segmentation( V_Dicom_Storage::sanitize_key( get_post_meta( $post->ID, V_Dicom_Storage::META_KEY, true ) ), $type_id );
			if ( ! empty( $cur['email_sent'] ) ) { return; }
		} else {
			if ( get_post_meta( $post->ID, '_v_dicom_seg_email_sent', true ) ) { return; }
		}
		$owner_id = (int) $post->post_author;
		$user     = $owner_id ? get_userdata( $owner_id ) : null;
		$email    = $user ? (string) $user->user_email : '';
		if ( '' === $email || ! is_email( $email ) ) {
			return;
		}
		$key   = (string) get_post_meta( $post->ID, V_Dicom_Storage::META_KEY, true );
		$title = get_the_title( $post );
		$url   = class_exists( 'V_Dicom_Page' ) ? V_Dicom_Page::url( $key ) : home_url( '/v-dicom/' . $key . '/' );
		$started  = (int) get_post_meta( $post->ID, V_Dicom_Storage::SEG_STARTED_AT_KEY, true );
		$finished = (int) get_post_meta( $post->ID, V_Dicom_Storage::SEG_FINISHED_AT_KEY, true );
		$dur_str  = '';
		if ( $started && $finished && $finished >= $started ) {
			$sec = $finished - $started;
			if ( $sec < 60 ) { $dur_str = $sec . 's'; }
			elseif ( $sec < 3600 ) { $dur_str = floor( $sec / 60 ) . 'm ' . ( $sec % 60 ) . 's'; }
			else { $dur_str = floor( $sec / 3600 ) . 'h ' . floor( ( $sec % 3600 ) / 60 ) . 'm ' . ( $sec % 60 ) . 's'; }
		}
		$ok      = 'COMPLETED' === $status;
		$subject = $ok
			/* translators: %s: scene title or key */
			? sprintf( __( 'Segmentação concluída — %s', 'v-dicom' ), $title ?: $key )
			/* translators: %s: scene title or key */
			: sprintf( __( 'Segmentação falhou — %s', 'v-dicom' ), $title ?: $key );
		$body  = $ok
			/* translators: %1$s: scene title or key, %2$s: duration string, %3$s: line break, %4$s: scene URL */
			? sprintf( __( 'Sua segmentação da cena "%1$s" foi concluída%2$s.%3$sAbra a cena: %4$s', 'v-dicom' ), $title ?: $key, $dur_str ? " em $dur_str" : '', "\n\n", $url )
			/* translators: %1$s: scene title or key, %2$s: line break, %3$s: line break, %4$s: scene URL */
			: sprintf( __( 'A segmentação da cena "%1$s" falhou.%2$sO crédito foi estornado. Tente novamente ou contate o suporte.%3$sCena: %4$s', 'v-dicom' ), $title ?: $key, "\n\n", "\n\n", $url );
		$headers = array( 'Content-Type: text/plain; charset=UTF-8' );
		if ( '' !== $type_id ) {
			$started  = (int) ( V_Dicom_Storage::get_segmentation( V_Dicom_Storage::sanitize_key( $key ), $type_id )['started_at'] ?? 0 );
			$finished = (int) ( V_Dicom_Storage::get_segmentation( V_Dicom_Storage::sanitize_key( $key ), $type_id )['finished_at'] ?? 0 );
			$dur_str = '';
			if ( $started && $finished && $finished >= $started ) {
				$sec = $finished - $started;
				if ( $sec < 60 ) { $dur_str = $sec . 's'; } elseif ( $sec < 3600 ) { $dur_str = floor( $sec / 60 ) . 'm ' . ( $sec % 60 ) . 's'; } else { $dur_str = floor( $sec / 3600 ) . 'h ' . floor( ( $sec % 3600 ) / 60 ) . 'm ' . ( $sec % 60 ) . 's'; }
			}
			/* translators: %1$s: segmentation type, %2$s: scene title or key, %3$s: duration string, %4$s: line break, %5$s: scene URL */
			$body  = $ok ? sprintf( __( 'Sua segmentação (%1$s) da cena "%2$s" foi concluída%3$s.%4$sAbra a cena: %5$s', 'v-dicom' ), $type_id, $title ?: $key, $dur_str ? " em $dur_str" : '', "\n\n", $url ) : sprintf( __( 'A segmentação (%1$s) da cena "%2$s" falhou.%3$sO crédito foi estornado. Tente novamente ou contate o suporte.%4$sCena: %5$s', 'v-dicom' ), $type_id, $title ?: $key, "\n\n", "\n\n", $url );
		}
		$sent = wp_mail( $email, $subject, $body, $headers );
		if ( $sent ) {
			if ( '' !== $type_id ) { V_Dicom_Storage::set_segmentation( V_Dicom_Storage::sanitize_key( $key ), $type_id, array( 'email_sent' => time() ) ); } else { update_post_meta( $post->ID, '_v_dicom_seg_email_sent', time() ); }
		} else {
			if ( '' !== $type_id ) { V_Dicom_Storage::set_segmentation( V_Dicom_Storage::sanitize_key( $key ), $type_id, array( 'email_last_error' => time() ) ); } else { update_post_meta( $post->ID, '_v_dicom_seg_email_last_error', time() ); }
		}
	}

	/** Constant-time check of the ?apikey= query param against the stored key. */
	private function api_key_is_valid( WP_REST_Request $request ) {
		$provided = (string) $request->get_param( 'apikey' );
		$stored   = V_Dicom_Storage::api_key();
		if ( '' === $provided || '' === $stored ) {
			return false;
		}
		return hash_equals( $stored, $provided );
	}

	/** Normalise job status values returned by serverless providers. Unknown
	 * values fall back to 'UNKNOWN' so no arbitrary third-party text reaches output. */
	private function normalize_segmentation_status( $raw ) {
		$status = strtoupper( trim( (string) $raw ) );
		$status = str_replace( array( '-', ' ' ), '_', $status );
		$map    = array(
			'SUCCESS'      => 'COMPLETED',
			'SUCCEEDED'    => 'COMPLETED',
			'SUCCESSFUL'   => 'COMPLETED',
			'COMPLETE'     => 'COMPLETED',
			'COMPLETED'    => 'COMPLETED',
			'DONE'         => 'COMPLETED',
			'FINISHED'     => 'COMPLETED',
			'OK'           => 'COMPLETED',
			'FAIL'         => 'FAILED',
			'FAILURE'      => 'FAILED',
			'ERROR'        => 'FAILED',
			'ERRORED'      => 'FAILED',
			'TIMEOUT'      => 'FAILED',
			'TIMED_OUT'    => 'FAILED',
			'CANCELED'     => 'CANCELLED',
			'CANCELLED'    => 'CANCELLED',
			'QUEUED'       => 'IN_QUEUE',
			'QUEUE'        => 'IN_QUEUE',
			'PENDING'      => 'PENDING',
			'WAITING'      => 'IN_QUEUE',
			'CREATED'      => 'IN_QUEUE',
			'SUBMITTED'    => 'IN_QUEUE',
			'RUNNING'      => 'RUNNING',
			'PROCESSING'   => 'IN_PROGRESS',
			'IN_PROGRESS'  => 'IN_PROGRESS',
			'INPROGRESS'   => 'IN_PROGRESS',
			'STARTED'      => 'IN_PROGRESS',
			'EXECUTING'    => 'IN_PROGRESS',
			'IN_QUEUE'     => 'IN_QUEUE',
			'UNKNOWN'      => 'UNKNOWN',
		);
		$normalized = $map[ $status ] ?? $status;
		$allowed    = array( 'IN_QUEUE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN' );
		return in_array( $normalized, $allowed, true ) ? $normalized : 'UNKNOWN';
	}

	/** The scene must exist and belong to the current user (or an editor). */
	private function scene_for_write( $key ) {
		$post = V_Dicom_Storage::find_scene( $key );
		if ( ! $post ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		if ( ! V_Dicom_Storage::user_can_write_scene( $post ) ) {
			return new WP_Error(
				'v_dicom_forbidden',
				__( 'Esta cena pertence a outro usuário.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		return $post;
	}

	/** Open an upload session: a folder that later becomes the scene. */
	public function start_upload() {
		$quota = V_Dicom_Storage::check_quota( get_current_user_id(), 1 );
		if ( is_wp_error( $quota ) ) {
			return $quota;
		}
		$token = V_Dicom_Storage::generate_key();
		V_Dicom_Storage::ensure_upload_dir( $token );
		set_transient( 'v_dicom_up_' . $token, get_current_user_id(), DAY_IN_SECONDS );
		return rest_ensure_response( array( 'token' => $token ) );
	}

	private function owns_session( $token, WP_REST_Request $request ) {
		// An admin-issued API key grants access to any upload folder.
		if ( $this->api_key_is_valid( $request ) ) {
			return true;
		}
		$owner = get_transient( 'v_dicom_up_' . $token );
		if ( false === $owner || (int) $owner !== get_current_user_id() ) {
			return new WP_Error(
				'v_dicom_forbidden',
				__( 'Sessão de upload inválida ou expirada.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		return true;
	}

	/** Upload one file into the session folder and return its public link. */
	public function upload_session_file( WP_REST_Request $request ) {
		$token = V_Dicom_Storage::sanitize_key( $request['key'] );
		$owned = $this->owns_session( $token, $request );
		if ( is_wp_error( $owned ) ) {
			return $owned;
		}
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Nenhum arquivo recebido.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		$via_apikey = $this->api_key_is_valid( $request );
		$stored     = V_Dicom_Storage::store_file( $token, $files['file'], $via_apikey );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		return rest_ensure_response( $stored );
	}

	/** Own panel: storage usage plus the list of the user's scenes. */
	public function me() {
		$user  = wp_get_current_user();
		$uid   = (int) $user->ID;

		// Planos vencidos saem da conta antes de qualquer cálculo; se algo
		// venceu agora, o excesso é removido (mais antigas primeiro).
		if ( V_Dicom_Storage::prune_expired_plans( $uid ) ) {
			V_Dicom_Storage::enforce_quota( $uid );
		}

		$limit = V_Dicom_Storage::user_limit_bytes( $uid );
		$used  = V_Dicom_Storage::used_bytes( $uid );

		$scenes = array();
		foreach ( V_Dicom_Storage::scenes_for_user( $uid ) as $post ) {
			$key   = (string) get_post_meta( $post->ID, V_Dicom_Storage::META_KEY, true );
			$files = get_post_meta( $post->ID, V_Dicom_Storage::META_FILES, true );
			$files = is_array( $files ) ? $files : array();
			$segs  = V_Dicom_Storage::get_segmentations( $key );
			$seg_map = array();
			foreach ( $segs as $tid => $seg ) { $seg_map[ $tid ] = (string) ( $seg['status'] ?? 'UNKNOWN' ); }
			$scenes[] = array(
				'key'                => $key,
				'title'              => get_the_title( $post ),
				'fileCount'          => count( $files ),
				'bytes'              => V_Dicom_Storage::dir_size( V_Dicom_Storage::base_dir() . '/' . $key ),
				'created'            => get_the_date( 'c', $post ),
				'segmentationUsed'   => V_Dicom_Storage::isSegmentationUsed( $key ) || ! empty( $segs ),
				'segmentationStatus' => V_Dicom_Storage::getJobStatus( $key ) ?: ( $seg_map ? reset( $seg_map ) : '' ),
				'segmentations'      => $seg_map,
				'accessedAt'         => get_post_meta( $post->ID, '_v_dicom_last_accessed', true ) ?: 0,
			);
		}

		$plans = array();
		foreach ( V_Dicom_Storage::user_plans( $uid ) as $plan ) {
			if ( ! is_array( $plan ) || empty( $plan['expires_at'] ) || (int) $plan['expires_at'] <= time() ) {
				continue;
			}
			$plans[] = array(
				'mb'        => (int) $plan['mb'],
				'months'    => (int) $plan['months'],
				'grantedAt' => (int) $plan['granted_at'],
				'expiresAt' => (int) $plan['expires_at'],
			);
		}

		return rest_ensure_response(
			array(
				'isLoggedIn'  => true,
				'displayName' => $user->display_name,
				'isAdmin'     => current_user_can( 'edit_users' ),
				'credits'     => V_Dicom_Storage::user_credit( $uid ),
				'storage'     => array(
					'limitBytes'     => $limit,
					'usedBytes'      => $used,
					'availableBytes' => 0 === $limit ? 0 : max( 0, $limit - $used ),
					'blocked'        => 0 === $limit,
				),
				'scenes'      => $scenes,
				'storagePlans' => $plans,
			)
		);
	}

	/**
	 * Get recently accessed scenes for the current user.
	 * Returns recent scenes with access timestamps and metadata.
	 */
	public function get_recent_scenes() {
		$user  = wp_get_current_user();
		$uid   = (int) $user->ID;

		$recent = V_Dicom_Storage::get_recent_scenes_data( $uid );
		return rest_ensure_response( $recent );
	}

	/**
	 * Mark a scene as accessed by the current user.
	 * Any logged-in user may record access (including scenes opened via
	 * share links from other users) so they show up as recently accessed.
	 */
	public function mark_scene_accessed( WP_REST_Request $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'v_dicom_unauthorized',
				__( 'Você precisa estar logado para acessar este recurso.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		$key = V_Dicom_Storage::sanitize_key( $request['key'] );
		if ( '' === $key ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}

		$post = V_Dicom_Storage::find_scene( $key );
		if ( ! $post ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}

		// Last-accessed timestamp stored on the scene itself.
		update_post_meta( $post->ID, '_v_dicom_last_accessed', time() );

		// Record in the user's recent scenes list (user meta).
		V_Dicom_Storage::record_scene_access( $key );

		return rest_ensure_response( array( 'success' => true ) );
	}

	public function create_scene( WP_REST_Request $request ) {
		$token = V_Dicom_Storage::sanitize_key( (string) $request->get_param( 'token' ) );
		$files = array();
		if ( $token ) {
			$owned = $this->owns_session( $token, $request );
			if ( is_wp_error( $owned ) ) {
				return $owned;
			}
			$files = V_Dicom_Storage::sanitize_files( $token, $request->get_param( 'files' ) );
		}
$settings = V_Dicom_Storage::sanitize_settings( $request->get_param( 'settings' ) );
		// Extract urls from request (new format inside settings, or top-level, or legacy 'url' field)
		$urls = array();
		// Check top-level urls first
		if ( array_key_exists( 'urls', $request->get_params() ) && is_array( $request->get_params()['urls'] ) ) {
			$urls = array_map( 'esc_url_raw', $request->get_params()['urls'] );
		} elseif ( array_key_exists( 'urls', $settings ) && is_array( $settings['urls'] ) ) {
			// URLs inside settings (novo formato)
			$urls = array_map( 'esc_url_raw', $settings['urls'] );
			// Remove urls from settings to avoid duplication (já serão salvos separadamente)
			unset( $settings['urls'] );
		} elseif ( array_key_exists( 'url', $settings ) ) {
			// Legado: converter string única para array
			$urls = array( $settings['url'] );
			unset( $settings['url'] );
		}
		$anns     = $token ? V_Dicom_Storage::sanitize_annotations( $token, $request->get_param( 'annotations' ) ) : array();
		$created  = V_Dicom_Storage::create_scene(
			(string) $request->get_param( 'title' ),
			$token,
			$files,
			$settings,
			$anns,
			$urls
		);
		if ( is_wp_error( $created ) ) {
			return $created;
		}
		if ( $token ) {
			delete_transient( 'v_dicom_up_' . $token );
		}
		return rest_ensure_response( $created );
	}

	public function get_scene( WP_REST_Request $request ) {
		$post = V_Dicom_Storage::find_scene( $request['key'] );
		if ( ! $post ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Cena não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		return rest_ensure_response( V_Dicom_Storage::scene_payload( $post ) );
	}

	/**
	 * Zip the folder behind {key} and stream it to the client. Reachable only
	 * with a valid admin API key: /v-dicom/v1/download/{key}/zip?apikey=…
	 */
	public function download_zip( WP_REST_Request $request ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return new WP_Error( 'v_dicom_zip', __( 'A extensão ZIP não está disponível no servidor.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		$key = V_Dicom_Storage::sanitize_key( $request['key'] );
		if ( '' === $key ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Pasta não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}
		$dir = V_Dicom_Storage::base_dir() . '/' . $key;
		if ( ! is_dir( $dir ) ) {
			return new WP_Error( 'v_dicom_not_found', __( 'Pasta não encontrada.', 'v-dicom' ), array( 'status' => 404 ) );
		}

		$tmp = wp_tempnam( $key . '.zip' );
		if ( ! $tmp ) {
			return new WP_Error( 'v_dicom_zip', __( 'Não foi possível criar o arquivo ZIP.', 'v-dicom' ), array( 'status' => 500 ) );
		}

		$zip = new ZipArchive();
		if ( true !== $zip->open( $tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
			return new WP_Error( 'v_dicom_zip', __( 'Não foi possível criar o arquivo ZIP.', 'v-dicom' ), array( 'status' => 500 ) );
		}
		$base_len = strlen( $dir ) + 1;
		$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
		foreach ( $iterator as $entry ) {
			if ( ! $entry->isFile() || ! $entry->isReadable() ) {
				continue;
			}
			$local = str_replace( '\\', '/', substr( $entry->getPathname(), $base_len ) );
			$zip->addFile( $entry->getPathname(), $local );
		}
		$zip->close();

		if ( ! file_exists( $tmp ) ) {
			return new WP_Error( 'v_dicom_zip', __( 'Não foi possível gerar o arquivo ZIP.', 'v-dicom' ), array( 'status' => 500 ) );
		}

		nocache_headers();
		header( 'Content-Type: application/zip' );
		header( 'Content-Disposition: attachment; filename="' . $key . '.zip"' );
		header( 'Content-Length: ' . (int) filesize( $tmp ) );
		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- streams file to browser
		readfile( $tmp );
		wp_delete_file( $tmp );
		exit;
	}

	public function upload_file( WP_REST_Request $request ) {
		$post = $this->scene_for_write( $request['key'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Nenhum arquivo recebido.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		$stored = V_Dicom_Storage::store_file( $request['key'], $files['file'] );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		return rest_ensure_response( $stored );
	}

	/** Upload one annotation PNG into an existing scene folder and return its URL. */
	public function upload_scene_annotation( WP_REST_Request $request ) {
		$post = $this->scene_for_write( $request['key'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Nenhum arquivo recebido.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		$stored = V_Dicom_Storage::store_annotation_png( $request['key'], $files['file'] );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		return rest_ensure_response( $stored );
	}

	public function save_settings( WP_REST_Request $request ) {
		$post = $this->scene_for_write( $request['key'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$raw_settings = $request->get_param( 'settings' );
		error_log( "[v-dicom] save_settings: raw meshes count=" . ( isset( $raw_settings['meshes'] ) ? count( $raw_settings['meshes'] ) : 'not set' ) );
		$settings = V_Dicom_Storage::sanitize_settings( $raw_settings );
		error_log( "[v-dicom] save_settings: sanitized meshes count=" . ( isset( $settings['meshes'] ) ? count( $settings['meshes'] ) : 'not set' ) );
		// Save urls array if present, maintaining backward compatibility
		if ( array_key_exists( 'urls', $request->get_params() ) && is_array( $request->get_params()['urls'] ) ) {
			update_post_meta( $post->ID, '_v_dicom_urls', array_map( 'esc_url_raw', $request->get_params()['urls'] ) );
		} elseif ( array_key_exists( 'url', $settings ) ) {
			// Legacy: convert single url to array
			update_post_meta( $post->ID, '_v_dicom_urls', array( esc_url_raw( $settings['url'] ) ) );
			// Remove legacy url from settings
			unset( $settings['url'] );
		}
		update_post_meta( $post->ID, V_Dicom_Storage::META_SETTINGS, $settings );

		if ( $request->get_param( 'annotations' ) !== null ) {
			$anns = V_Dicom_Storage::sanitize_annotations( $request['key'], $request->get_param( 'annotations' ) );
			if ( $anns ) {
				update_post_meta( $post->ID, V_Dicom_Storage::META_ANNOTATIONS, $anns );
			} else {
				delete_post_meta( $post->ID, V_Dicom_Storage::META_ANNOTATIONS );
			}
		}

		$title = $request->get_param( 'title' );
		if ( is_string( $title ) && '' !== trim( $title ) ) {
			wp_update_post(
				array(
					'ID'         => $post->ID,
					'post_title' => sanitize_text_field( $title ),
				)
			);
		}

		// Clean up orphaned files in the scene directory
		$key = V_Dicom_Storage::sanitize_key( $request['key'] );
		if ( $key ) {
			error_log( "[v-dicom] save_settings: calling cleanup_orphaned_files for key=$key" );
			$deleted = V_Dicom_Storage::cleanup_orphaned_files( $key, $settings );
			error_log( "[v-dicom] save_settings: cleanup_orphaned_files returned deleted_count=$deleted" );
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/** Store the PNG of an annotation linked to an open upload session. */
	public function upload_session_annotation( WP_REST_Request $request ) {
		$token = V_Dicom_Storage::sanitize_key( $request['key'] );
		$owned = $this->owns_session( $token, $request );
		if ( is_wp_error( $owned ) ) {
			return $owned;
		}
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) ) {
			return new WP_Error( 'v_dicom_upload', __( 'Nenhum arquivo recebido.', 'v-dicom' ), array( 'status' => 400 ) );
		}
		$stored = V_Dicom_Storage::store_annotation_png( $token, $files['file'] );
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		return rest_ensure_response( $stored );
	}

	/** Authorize a URL for download - consumes 1 credit.
	 * If URL already authorized, no credit consumed.
	 * Returns credit balance and authorization status.
	 * Pass dry_run=true to check without consuming a credit.
	 */
	public function authorize_url( WP_REST_Request $request ) {
		// Check if user is logged in
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'v_dicom_unauthorized',
				__( 'Você precisa estar logado.', 'v-dicom' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		
		$url = esc_url_raw( $request->get_param( 'url' ) );
		if ( empty( $url ) ) {
			return new WP_Error(
				'v_dicom_invalid_url',
				__( 'URL inválida.', 'v-dicom' ),
				array( 'status' => 400 )
			);
		}

		$dryRun = (bool) $request->get_param( 'dry_run' );
		
		global $wpdb;
		$authorized_urls_table = $wpdb->prefix . 'v_dicom_authorized_urls';

		// Ensure the table exists (idempotent — activation hook may have been broken)
		V_Dicom_Storage::ensure_authorized_urls_table();
		
		// Normalizar URL para comparação
		$normalizedUrl = strtolower( trailingslashit( wp_parse_url( $url, PHP_URL_SCHEME ) . '://' . wp_parse_url( $url, PHP_URL_HOST ) . wp_parse_url( $url, PHP_URL_PATH ) ) );
		
		// Verificar se URL já está autorizada
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, PluginCheck.Security.DirectDB.UnescapedDBParameter -- custom table lookup
		$result = $wpdb->get_var(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name built from $wpdb->prefix
				"SELECT times_accessed FROM $authorized_urls_table WHERE url = %s",
				$normalizedUrl
			)
		);
		
		if ( $result !== null ) {
			// URL já autorizada - incrementar contador
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- custom table update
			$wpdb->update(
				$authorized_urls_table,
				array( 'times_accessed' => $result + 1 ),
				array( 'url' => $normalizedUrl )
			);
			
			// Retornar saldo e status de autorização
			$user_id = get_current_user_id();
			$current_credits = V_Dicom_Storage::user_credit( $user_id );
			$storage = V_Dicom_Storage::user_limit_bytes( $user_id );
			$used = V_Dicom_Storage::used_bytes( $user_id );
			$storage_available = max( 0, $storage - $used );
			
			return rest_ensure_response( array(
				'authorized' => true,
				'already_authorized' => true,
				'will_consume_credit' => false,
				'credits_available' => $current_credits,
				'credits_used_total' => $current_credits,
				'storage_available' => $storage_available,
			) );
		}
		
		// Verificar se usuário tem crédito para autorizar
		$user_id = get_current_user_id();
		$has_credit = V_Dicom_Storage::user_credit( $user_id ) >= 1;
		
		if ( ! $has_credit ) {
			$shop_url_val = v_dicom_shop_url();
			
			return rest_ensure_response( array(
				'authorized' => false,
				'already_authorized' => false,
				'has_credit' => false,
				'shop_url' => $shop_url_val,
				'current_credits' => V_Dicom_Storage::user_credit( $user_id ),
				'message' => __( 'Você não tem créditos para autorizar URLs. Compre créditos na loja.', 'v-dicom' ),
			) );
		}
		
		// Consumir 1 crédito (exceto em dry_run)
		if ( ! $dryRun ) {
			V_Dicom_Storage::set_user_credit( $user_id, V_Dicom_Storage::user_credit( $user_id ) - 1 );
		}
		
		// Autorizar URL (exceto em dry_run)
		if ( ! $dryRun ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- custom table insert
			$wpdb->insert(
				$authorized_urls_table,
				array( 'url' => $normalizedUrl, 'times_accessed' => 1 )
			);
		}
		
		// Retornar saldo e status
		$credits_after = V_Dicom_Storage::user_credit( $user_id );
		$storage = V_Dicom_Storage::user_limit_bytes( $user_id );
		$used = V_Dicom_Storage::used_bytes( $user_id );
		$storage_available = max( 0, $storage - $used );
		
		return rest_ensure_response( array(
			'authorized' => true,
			'already_authorized' => false,
			'will_consume_credit' => ! $dryRun,
			'credits_after' => $credits_after,
			'credits_available' => $credits_after,
			'storage_available' => $storage_available,
			'message' => $dryRun
				? __( 'URL autorizará com 1 crédito. Confirme para prosseguir.', 'v-dicom' )
				: __( 'URL autorizada com sucesso! 1 crédito consumido.', 'v-dicom' ),
		) );
	}

	public function delete_scene( WP_REST_Request $request ) {
		$post = $this->scene_for_write( $request['key'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		V_Dicom_Storage::delete_scene( $post );
		return rest_ensure_response( array( 'ok' => true ) );
	}
}
