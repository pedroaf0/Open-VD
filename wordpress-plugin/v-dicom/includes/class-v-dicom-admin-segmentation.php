<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin submenu: segmentation types configuration.
 */
class V_Dicom_Admin_Segmentation {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_v_dicom_seg_types', array( $this, 'handle_seg_types' ) );
		add_action( 'admin_post_v_dicom_seg_export', array( $this, 'handle_seg_export' ) );
		add_action( 'admin_post_v_dicom_seg_import', array( $this, 'handle_seg_import' ) );
	}

	public function menu() {
		add_submenu_page(
			'v-dicom',
			__( 'Segmentação automática', 'v-dicom' ),
			__( 'Segmentação', 'v-dicom' ),
			'edit_users',
			'v-dicom-segmentation',
			array( $this, 'page' )
		);
	}

	public function handle_seg_types() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_seg_types' );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each item is sanitized via V_Dicom_Storage::sanitize_segmentation_type().
		$raw = isset( $_POST['v_dicom_seg_types'] ) && is_array( $_POST['v_dicom_seg_types'] ) ? wp_unslash( $_POST['v_dicom_seg_types'] ) : array();
		$out = array();
		$seen = array();
		foreach ( $raw as $item ) {
			if ( ! is_array( $item ) ) { continue; }
			if ( ! empty( $item['_delete'] ) ) { continue; }
			$id_raw = isset( $item['id'] ) ? (string) $item['id'] : '';
			$id = V_Dicom_Storage::sanitize_seg_type_id( $id_raw );
			if ( '' === $id ) {
				$id = substr( md5( ( $item['name'] ?? '' ) . microtime() . wp_rand() ), 0, 8 );
			}
			if ( isset( $seen[ $id ] ) ) { continue; }
			$seen[ $id ] = true;
			$san = V_Dicom_Storage::sanitize_segmentation_type( array(
				'id'            => $id,
				'name'          => $item['name'] ?? '',
				'description'   => $item['description'] ?? '',
				'url'           => $item['url'] ?? '',
				'run_url'       => $item['run_url'] ?? '',
				'status_url'    => $item['status_url'] ?? '',
				'authorization' => $item['authorization'] ?? '',
				'payload'       => $item['payload'] ?? '',
				'cost'          => $item['cost'] ?? 0,
				'enabled'       => ! empty( $item['enabled'] ),
			), $id );
			if ( ! $san ) { continue; }
			$out[] = $san;
		}
		update_option( V_Dicom_Storage::OPTION_SEG_TYPES, array_values( $out ) );
		wp_safe_redirect( add_query_arg( 'segtypessaved', 1, admin_url( 'admin.php?page=v-dicom-segmentation' ) ) );
		exit;
	}

	/**
	 * Export segmentation types as JSON file.
	 */
	public function handle_seg_export() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_seg_export' );

		$seg_types = V_Dicom_Storage::get_segmentation_types( true );
		$export_data = array(
			'version'      => 1,
			'exported_at'  => gmdate( 'c' ),
			'seg_types'    => $seg_types,
		);

		$filename = 'v-dicom-segmentation-types-' . gmdate( 'Y-m-d' ) . '.json';
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Pragma: no-cache' );
		echo wp_json_encode( $export_data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		exit;
	}

	/**
	 * Import segmentation types from uploaded JSON file.
	 */
	public function handle_seg_import() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_seg_import' );

		if ( empty( $_FILES['v_dicom_seg_import_file']['tmp_name'] ) ) {
			wp_safe_redirect( add_query_arg( 'segimporterror', 'no_file', admin_url( 'admin.php?page=v-dicom-segmentation' ) ) );
			exit;
		}

		$file = $_FILES['v_dicom_seg_import_file'];
		if ( $file['error'] !== UPLOAD_ERR_OK ) {
			wp_safe_redirect( add_query_arg( 'segimporterror', 'upload_error', admin_url( 'admin.php?page=v-dicom-segmentation' ) ) );
			exit;
		}

		// Read and validate JSON.
		$json = file_get_contents( $file['tmp_name'] );
		if ( false === $json ) {
			wp_safe_redirect( add_query_arg( 'segimporterror', 'read_error', admin_url( 'admin.php?page=v-dicom-segmentation' ) ) );
			exit;
		}

		$data = json_decode( $json, true );
		if ( json_last_error() !== JSON_ERROR_NONE ) {
			wp_safe_redirect( add_query_arg( 'segimporterror', 'invalid_json', admin_url( 'admin.php?page=v-dicom-segmentation' ) ) );
			exit;
		}

		if ( ! isset( $data['seg_types'] ) || ! is_array( $data['seg_types'] ) ) {
			wp_safe_redirect( add_query_arg( 'segimporterror', 'invalid_structure', admin_url( 'admin.php?page=v-dicom-segmentation' ) ) );
			exit;
		}

		// Sanitize each type.
		$out = array();
		$seen = array();
		foreach ( $data['seg_types'] as $item ) {
			if ( ! is_array( $item ) ) { continue; }
			$id_raw = isset( $item['id'] ) ? (string) $item['id'] : '';
			$id = V_Dicom_Storage::sanitize_seg_type_id( $id_raw );
			if ( '' === $id ) {
				$id = substr( md5( ( $item['name'] ?? '' ) . microtime() . wp_rand() ), 0, 8 );
			}
			if ( isset( $seen[ $id ] ) ) { continue; }
			$seen[ $id ] = true;

			$san = V_Dicom_Storage::sanitize_segmentation_type( array(
				'id'            => $id,
				'name'          => $item['name'] ?? '',
				'description'   => $item['description'] ?? '',
				'url'           => $item['url'] ?? '',
				'run_url'       => $item['run_url'] ?? '',
				'status_url'    => $item['status_url'] ?? '',
				'authorization' => $item['authorization'] ?? '',
				'payload'       => $item['payload'] ?? '',
				'cost'          => $item['cost'] ?? 0,
				'enabled'       => ! empty( $item['enabled'] ),
			), $id );
			if ( ! $san ) { continue; }
			$out[] = $san;
		}

		update_option( V_Dicom_Storage::OPTION_SEG_TYPES, array_values( $out ) );

		$imported_count = count( $out );
		wp_safe_redirect( add_query_arg( 'segimported', $imported_count, admin_url( 'admin.php?page=v-dicom-segmentation' ) ) );
		exit;
	}

	public function page() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		$seg_types       = V_Dicom_Storage::get_segmentation_types( true );
		$default_payload = V_Dicom_Storage::default_segmentation_payload();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Segmentação automática', 'v-dicom' ); ?></h1>
			<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
			<?php if ( isset( $_GET['segtypessaved'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Tipos de segmentação atualizados.', 'v-dicom' ); ?></p></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['segimported'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p>
					<?php
					/* translators: %d: number of imported segmentation types */
					printf( esc_html__( '%d tipo(s) de segmentação importado(s).', 'v-dicom' ), (int) $_GET['segimported'] );
					?>
				</p></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['segimporterror'] ) ) : ?>
				<div class="notice notice-error is-dismissible"><p>
					<?php
					$err = sanitize_text_field( wp_unslash( $_GET['segimporterror'] ) );
					switch ( $err ) {
						case 'no_file':
							esc_html_e( 'Nenhum arquivo enviado.', 'v-dicom' );
							break;
						case 'upload_error':
							esc_html_e( 'Erro no upload do arquivo.', 'v-dicom' );
							break;
						case 'read_error':
							esc_html_e( 'Não foi possível ler o arquivo.', 'v-dicom' );
							break;
						case 'invalid_json':
							esc_html_e( 'Arquivo JSON inválido.', 'v-dicom' );
							break;
						case 'invalid_structure':
							esc_html_e( 'Estrutura do arquivo inválida. Esperado objeto com chave "seg_types".', 'v-dicom' );
							break;
						default:
							esc_html_e( 'Erro desconhecido na importação.', 'v-dicom' );
					}
					?>
				</p></div>
			<?php endif; ?>
			<p class="description" style="max-width:960px">
				<?php esc_html_e( 'Cada tipo representa um serviço de nuvem serverless. A URL de execução recebe o payload, a URL de status é consultada durante o processamento e o callback informa a conclusão. Desmarque "Ativo" para desabilitar um tipo sem excluí-lo. A mesma cena pode usar vários tipos.', 'v-dicom' ); ?>
			</p>

			<div style="display:flex;gap:10px;align-items:center;margin:14px 0;flex-wrap:wrap;">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
					<input type="hidden" name="action" value="v_dicom_seg_export" />
					<?php wp_nonce_field( 'v_dicom_seg_export' ); ?>
					<button type="submit" class="button"><?php esc_html_e( 'Exportar configurações', 'v-dicom' ); ?></button>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" style="display:inline;">
					<input type="hidden" name="action" value="v_dicom_seg_import" />
					<?php wp_nonce_field( 'v_dicom_seg_import' ); ?>
					<input type="file" name="v_dicom_seg_import_file" accept=".json" style="display:inline-block;width:auto;margin-right:8px;" required />
					<button type="submit" class="button"><?php esc_html_e( 'Importar configurações', 'v-dicom' ); ?></button>
				</form>
				<span class="description" style="font-size:12px;"><?php esc_html_e( 'Exporta/importa todos os tipos de segmentação como JSON. O arquivo inclui payloads, URLs, autorização e descrições.', 'v-dicom' ); ?></span>
			</div>

			<details style="max-width:960px;margin:14px 0;padding:10px 12px;background:#fff;border:1px solid #ccd0d4;">
				<summary style="cursor:pointer;font-weight:600;"><?php esc_html_e( 'Placeholders disponíveis', 'v-dicom' ); ?></summary>
				<table class="widefat striped" style="margin-top:10px;max-width:920px;">
					<thead>
						<tr>
							<th style="width:230px"><?php esc_html_e( 'Placeholder', 'v-dicom' ); ?></th>
							<th><?php esc_html_e( 'Valor enviado', 'v-dicom' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<tr><td><code>{{download_url}}</code></td><td><?php esc_html_e( 'URL do ZIP da cena (texto).', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{download_urls}}</code></td><td><?php esc_html_e( 'Lista de URLs de download da cena (array JSON).', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{upload_url}}</code></td><td><?php esc_html_e( 'URL para o serviço enviar os modelos STL gerados.', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{callback_url}}</code></td><td><?php esc_html_e( 'URL de callback para o serviço informar o status.', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{url}}</code></td><td><?php esc_html_e( 'URL base do serviço.', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{scene_key}}</code></td><td><?php esc_html_e( 'Chave da cena.', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{type_id}}</code></td><td><?php esc_html_e( 'Identificador deste tipo de segmentação.', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{type_name}}</code></td><td><?php esc_html_e( 'Nome deste tipo de segmentação.', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{job_id}}</code></td><td><?php esc_html_e( 'Identificador do job (disponível na URL de status e no callback).', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{site_url}}</code></td><td><?php esc_html_e( 'URL do site WordPress.', 'v-dicom' ); ?></td></tr>
						<tr><td><code>{{timestamp}}</code></td><td><?php esc_html_e( 'Timestamp Unix do envio.', 'v-dicom' ); ?></td></tr>
					</tbody>
				</table>
				<p class="description" style="margin-top:10px;">
					<?php esc_html_e( 'Também aceita os apelidos {{uploadlink}}, {{downloadlink}} e {{callbacklink}}.', 'v-dicom' ); ?>
				</p>
				<p class="description" style="margin-top:10px;">
					<?php esc_html_e( 'Fora de aspas o placeholder vira um valor JSON (texto com aspas, número ou array). Dentro de aspas ele vira texto já escapado. Exemplo de payload:', 'v-dicom' ); ?>
				</p>
				<pre style="white-space:pre-wrap;background:#f6f7f7;border:1px solid #dcdcde;padding:10px;overflow:auto;"><?php echo esc_html( $default_payload ); ?></pre>
			</details>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="v_dicom_seg_types" />
				<?php wp_nonce_field( 'v_dicom_seg_types' ); ?>
				<div id="vd-seg-types-wrap">
					<?php foreach ( $seg_types as $idx => $t ) : ?>
						<div class="vd-seg-type-box" style="border:1px solid #ccd0d4;padding:16px;margin-bottom:16px;background:#fff;max-width:1040px;">
							<input type="hidden" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][id]" value="<?php echo esc_attr( $t['id'] ); ?>" />
							<div style="display:grid;grid-template-columns:1.1fr 1.4fr 1.1fr 80px 60px 60px;gap:10px;align-items:end;">
								<div>
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Nome*', 'v-dicom' ); ?></label>
									<input type="text" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][name]" value="<?php echo esc_attr( $t['name'] ); ?>" class="regular-text" style="width:100%" required placeholder="<?php esc_attr_e( 'Ex.: Ossos', 'v-dicom' ); ?>" />
								</div>
								<div>
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'URL base do serviço', 'v-dicom' ); ?></label>
									<input type="url" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][url]" value="<?php echo esc_attr( $t['url'] ); ?>" class="regular-text code" style="width:100%" placeholder="https://api.exemplo.com/v1" />
								</div>
								<div>
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Authorization (opcional)', 'v-dicom' ); ?></label>
									<input type="password" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][authorization]" value="<?php echo esc_attr( $t['authorization'] ); ?>" class="regular-text code" style="width:100%" autocomplete="off" placeholder="Bearer ..." />
								</div>
								<div>
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Custo', 'v-dicom' ); ?></label>
									<input type="number" min="0" step="1" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][cost]" value="<?php echo (int) $t['cost']; ?>" class="small-text" style="width:100%" />
								</div>
								<div style="text-align:center">
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Ativo', 'v-dicom' ); ?></label>
									<input type="checkbox" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][enabled]" value="1" <?php checked( ! empty( $t['enabled'] ) ); ?> />
								</div>
								<div style="text-align:center">
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Excluir', 'v-dicom' ); ?></label>
									<input type="checkbox" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][_delete]" value="1" />
								</div>
							</div>
							<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
								<div>
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'URL de execução (opcional)', 'v-dicom' ); ?></label>
									<input type="text" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][run_url]" value="<?php echo esc_attr( $t['run_url'] ); ?>" class="regular-text code" style="width:100%" placeholder="{{url}}/run" />
									<p class="description"><?php esc_html_e( 'Se ficar vazia, o plugin usa {{url}}/run.', 'v-dicom' ); ?></p>
								</div>
								<div>
									<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'URL de status (opcional)', 'v-dicom' ); ?></label>
									<input type="text" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][status_url]" value="<?php echo esc_attr( $t['status_url'] ); ?>" class="regular-text code" style="width:100%" placeholder="{{url}}/status/{{job_id}}" />
									<p class="description"><?php esc_html_e( 'Se ficar vazia, o plugin usa {{url}}/status/{{job_id}}.', 'v-dicom' ); ?></p>
								</div>
							</div>
							<div style="margin-top:14px;">
								<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
									<label for="v_dicom_seg_payload_<?php echo (int) $idx; ?>" style="font-weight:600;"><?php esc_html_e( 'Payload (template)', 'v-dicom' ); ?></label>
									<button type="button" class="button button-small vd-seg-default-payload" data-target="v_dicom_seg_payload_<?php echo (int) $idx; ?>"><?php esc_html_e( 'Usar payload padrão', 'v-dicom' ); ?></button>
								</div>
								<textarea id="v_dicom_seg_payload_<?php echo (int) $idx; ?>" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][payload]" rows="10" class="large-text code" style="width:100%;font-family:Menlo,Consolas,monospace;font-size:12px;"><?php echo esc_textarea( $t['payload'] ); ?></textarea>
								<p class="description"><?php esc_html_e( 'Corpo enviado na requisição de execução. Use os placeholders acima para montar o formato esperado pelo serviço.', 'v-dicom' ); ?></p>
							</div>
							<div style="margin-top:14px;">
								<label style="font-weight:600;display:block;margin-bottom:6px;"><?php esc_html_e( 'Descrição (texto rico — exibida no painel de segmentação)', 'v-dicom' ); ?></label>
								<?php
								wp_editor(
									$t['description'],
									'v_dicom_seg_desc_' . (int) $idx,
									array(
										'textarea_name' => 'v_dicom_seg_types[' . (int) $idx . '][description]',
										'textarea_rows' => 6,
										'media_buttons' => false,
										'teeny'         => false,
										'quicktags'     => true,
										'tinymce'       => array(
											'toolbar1' => 'bold,italic,underline,bullist,numlist,link,unlink,forecolor,formatselect',
											'toolbar2' => 'outdent,indent,removeformat,undo,redo',
										),
									)
								);
								?>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
				<p>
					<button type="button" class="button" id="vd-add-seg-type"><?php esc_html_e( 'Adicionar tipo', 'v-dicom' ); ?></button>
					<span class="description" style="margin-left:8px"><?php esc_html_e( 'Novo tipo ganha editor rico após salvar.', 'v-dicom' ); ?></span>
				</p>
				<?php submit_button( __( 'Salvar tipos de segmentação', 'v-dicom' ) ); ?>
			</form>

			<template id="vd-seg-type-template">
				<div class="vd-seg-type-box" style="border:1px solid #ccd0d4;padding:16px;margin-bottom:16px;background:#fff;max-width:1040px;">
					<input type="hidden" name="v_dicom_seg_types[__IDX__][id]" value="" />
					<div style="display:grid;grid-template-columns:1.1fr 1.4fr 1.1fr 80px 60px 60px;gap:10px;align-items:end;">
						<div>
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Nome*', 'v-dicom' ); ?></label>
							<input type="text" name="v_dicom_seg_types[__IDX__][name]" class="regular-text" style="width:100%" required placeholder="<?php esc_attr_e( 'Ex.: Ossos', 'v-dicom' ); ?>" />
						</div>
						<div>
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'URL base do serviço', 'v-dicom' ); ?></label>
							<input type="url" name="v_dicom_seg_types[__IDX__][url]" class="regular-text code" style="width:100%" placeholder="https://api.exemplo.com/v1" />
						</div>
						<div>
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Authorization (opcional)', 'v-dicom' ); ?></label>
							<input type="password" name="v_dicom_seg_types[__IDX__][authorization]" class="regular-text code" style="width:100%" autocomplete="off" placeholder="Bearer ..." />
						</div>
						<div>
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Custo', 'v-dicom' ); ?></label>
							<input type="number" min="0" step="1" name="v_dicom_seg_types[__IDX__][cost]" value="1" class="small-text" style="width:100%" />
						</div>
						<div style="text-align:center">
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Ativo', 'v-dicom' ); ?></label>
							<input type="checkbox" name="v_dicom_seg_types[__IDX__][enabled]" value="1" checked />
						</div>
						<div style="text-align:center">
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Excluir', 'v-dicom' ); ?></label>
							<input type="checkbox" name="v_dicom_seg_types[__IDX__][_delete]" value="1" />
						</div>
					</div>
					<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
						<div>
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'URL de execução (opcional)', 'v-dicom' ); ?></label>
							<input type="text" name="v_dicom_seg_types[__IDX__][run_url]" class="regular-text code" style="width:100%" placeholder="{{url}}/run" />
							<p class="description"><?php esc_html_e( 'Se ficar vazia, o plugin usa {{url}}/run.', 'v-dicom' ); ?></p>
						</div>
						<div>
							<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'URL de status (opcional)', 'v-dicom' ); ?></label>
							<input type="text" name="v_dicom_seg_types[__IDX__][status_url]" class="regular-text code" style="width:100%" placeholder="{{url}}/status/{{job_id}}" />
							<p class="description"><?php esc_html_e( 'Se ficar vazia, o plugin usa {{url}}/status/{{job_id}}.', 'v-dicom' ); ?></p>
						</div>
					</div>
					<div style="margin-top:14px;">
						<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
							<label for="v_dicom_seg_payload___IDX__" style="font-weight:600;"><?php esc_html_e( 'Payload (template)', 'v-dicom' ); ?></label>
							<button type="button" class="button button-small vd-seg-default-payload" data-target="v_dicom_seg_payload___IDX__"><?php esc_html_e( 'Usar payload padrão', 'v-dicom' ); ?></button>
						</div>
						<textarea id="v_dicom_seg_payload___IDX__" name="v_dicom_seg_types[__IDX__][payload]" rows="10" class="large-text code" style="width:100%;font-family:Menlo,Consolas,monospace;font-size:12px;"></textarea>
						<p class="description"><?php esc_html_e( 'Corpo enviado na requisição de execução. Use os placeholders acima para montar o formato esperado pelo serviço.', 'v-dicom' ); ?></p>
					</div>
					<div style="margin-top:14px;">
						<label style="font-weight:600;display:block;margin-bottom:6px;"><?php esc_html_e( 'Descrição (texto rico)', 'v-dicom' ); ?></label>
						<textarea name="v_dicom_seg_types[__IDX__][description]" rows="6" class="large-text" style="width:100%" placeholder="<?php esc_attr_e( 'Descrição com formatação — após salvar vira editor rico', 'v-dicom' ); ?>"></textarea>
						<p class="description"><?php esc_html_e( 'Após salvar, este campo virará editor visual com formatação.', 'v-dicom' ); ?></p>
					</div>
				</div>
			</template>

			<script>
			var vdSegDefaultPayload = <?php echo wp_json_encode( $default_payload ); ?>;
			(function () {
				var wrap = document.getElementById('vd-seg-types-wrap');
				var add = document.getElementById('vd-add-seg-type');
				var tpl = document.getElementById('vd-seg-type-template');
				if (!wrap || !add || !tpl) {
					return;
				}
				add.addEventListener('click', function () {
					var idx = wrap.querySelectorAll('.vd-seg-type-box').length;
					var host = document.createElement('div');
					host.innerHTML = tpl.innerHTML.replace(/__IDX__/g, String(idx)).trim();
					var box = host.firstElementChild;
					if (!box) {
						return;
					}
					wrap.appendChild(box);
					box.scrollIntoView({ behavior: 'smooth', block: 'center' });
				});
				wrap.addEventListener('click', function (event) {
					var button = event.target && event.target.closest ? event.target.closest('.vd-seg-default-payload') : null;
					if (!button) {
						return;
					}
					var target = document.getElementById(button.getAttribute('data-target') || '');
					if (target) {
						target.value = vdSegDefaultPayload;
					}
				});
			})();
			</script>
		</div>
		<?php
	}
}