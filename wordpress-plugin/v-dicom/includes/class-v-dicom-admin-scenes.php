<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin submenu: scene listing, segmentation debug, delete.
 */
class V_Dicom_Admin_Scenes {

	/** Rows per page in the scenes list. */
	const PER_PAGE = 20;

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_v_dicom_delete', array( $this, 'handle_delete' ) );
	}

	public function menu() {
		add_submenu_page(
			'v-dicom',
			__( 'Cenas salvas', 'v-dicom' ),
			__( 'Cenas', 'v-dicom' ),
			'upload_files',
			'v-dicom-scenes',
			array( $this, 'page' )
		);
	}

	/**
	 * Paginated scene list with an optional search over the title, the scene
	 * key and the owner (display name, login or e-mail). Returns the posts of
	 * the current page plus the total number of matches.
	 */
	private function query_scenes( $search, $paged, $per_page ) {
		global $wpdb;

		$paged    = max( 1, (int) $paged );
		$per_page = max( 1, (int) $per_page );

		$where  = array( 'p.post_type = %s', "p.post_status NOT IN ('trash','auto-draft')" );
		$params = array( V_DICOM_CPT );

		if ( ! current_user_can( 'edit_others_posts' ) ) {
			$where[]  = 'p.post_author = %d';
			$params[] = get_current_user_id();
		}

		$joins       = " LEFT JOIN {$wpdb->postmeta} km ON km.post_id = p.ID AND km.meta_key = %s"
			. " LEFT JOIN {$wpdb->users} u ON u.ID = p.post_author";
		$join_params = array( V_Dicom_Storage::META_KEY );

		if ( '' !== $search ) {
			$like    = '%' . $wpdb->esc_like( $search ) . '%';
			$where[] = '( p.post_title LIKE %s OR km.meta_value LIKE %s OR u.display_name LIKE %s OR u.user_login LIKE %s OR u.user_email LIKE %s )';
			array_push( $params, $like, $like, $like, $like, $like );
		}

		$where_sql = implode( ' AND ', $where );

		$count_sql = "SELECT COUNT(DISTINCT p.ID) FROM {$wpdb->posts} p{$joins} WHERE {$where_sql}";
		$total     = (int) $wpdb->get_var( $wpdb->prepare( $count_sql, array_merge( $join_params, $params ) ) );

		$posts = array();
		if ( $total > 0 ) {
			$list_sql = "SELECT p.ID FROM {$wpdb->posts} p{$joins} WHERE {$where_sql} ORDER BY p.post_date DESC LIMIT %d OFFSET %d";
			$args     = array_merge( $join_params, $params, array( $per_page, ( $paged - 1 ) * $per_page ) );
			$ids      = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( $list_sql, $args ) ) );
			if ( $ids ) {
				$posts = get_posts(
					array(
						'post_type'        => V_DICOM_CPT,
						'post_status'      => 'any',
						'post__in'         => $ids,
						'orderby'          => 'post__in',
						'numberposts'      => count( $ids ),
						'suppress_filters' => false,
					)
				);
			}
		}

		return array(
			'posts' => $posts,
			'total' => $total,
		);
	}

	public function handle_delete() {
		if ( ! v_dicom_can_upload() ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		$key = isset( $_GET['key'] ) ? V_Dicom_Storage::sanitize_key( sanitize_key( wp_unslash( $_GET['key'] ) ) ) : '';
		check_admin_referer( 'v_dicom_delete_' . $key );

		$post = V_Dicom_Storage::find_scene( $key );
		if ( $post ) {
			$is_owner = (int) $post->post_author === get_current_user_id();
			if ( $is_owner || current_user_can( 'edit_others_posts' ) ) {
				V_Dicom_Storage::delete_scene( $post );
			}
		}
		wp_safe_redirect( admin_url( 'admin.php?page=v-dicom-scenes&deleted=1' ) );
		exit;
	}

	/** This admin screen's URL with the given query args (null/'' values are dropped). */
	private static function list_url( array $args = array() ) {
		$args = array_merge( array( 'page' => 'v-dicom-scenes' ), $args );
		$args = array_filter(
			$args,
			static function ( $v ) {
				return null !== $v && '' !== $v;
			}
		);
		return admin_url( 'admin.php' ) . '?' . http_build_query( $args );
	}

	/**
	 * Same as list_url() but leaves an unencoded %#% placeholder where
	 * paginate_links() expects the page number.
	 */
	private static function list_url_paged( $page_arg, array $args = array() ) {
		$args = array_merge( $args, array( 'page' => 'v-dicom-scenes', $page_arg => '__VD_PAGE__' ) );
		$args = array_filter(
			$args,
			static function ( $v ) {
				return null !== $v && '' !== $v;
			}
		);
		return str_replace( '__VD_PAGE__', '%#%', admin_url( 'admin.php' ) . '?' . http_build_query( $args ) );
	}

	/**
	 * Renders the search box for the scenes list.
	 */
	private function render_list_search( $name, $search, array $keep, $placeholder, $total ) {
		?>
		<form method="get" action="<?php echo esc_url( admin_url( 'admin.php' ) ); ?>" style="margin:8px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
			<input type="hidden" name="page" value="v-dicom-scenes" />
			<?php foreach ( $keep as $k => $v ) : ?>
				<?php if ( null === $v || '' === $v ) { continue; } ?>
				<input type="hidden" name="<?php echo esc_attr( $k ); ?>" value="<?php echo esc_attr( $v ); ?>" />
			<?php endforeach; ?>
			<input type="search" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $search ); ?>" class="regular-text" placeholder="<?php echo esc_attr( $placeholder ); ?>" />
			<button type="submit" class="button"><?php esc_html_e( 'Buscar', 'v-dicom' ); ?></button>
			<?php if ( '' !== $search ) : ?>
				<a class="button" href="<?php echo esc_url( self::list_url( $keep ) ); ?>"><?php esc_html_e( 'Limpar', 'v-dicom' ); ?></a>
			<?php endif; ?>
			<?php if ( $total > 0 ) : ?>
				<span class="description" style="margin-left:auto;">
					<?php
					echo esc_html(
						sprintf(
							/* translators: %s: number of rows found. */
							__( '%s resultado(s)', 'v-dicom' ),
							number_format_i18n( $total )
						)
					);
					?>
				</span>
			<?php endif; ?>
		</form>
		<?php
	}

	/**
	 * Renders the pagination links for the scenes list.
	 */
	private function render_list_pages( $name, $page_arg, $search, $total, $per_page, array $keep, $current ) {
		$pages = max( 1, (int) ceil( $total / max( 1, $per_page ) ) );
		if ( $pages < 2 ) {
			return;
		}
		$current = max( 1, min( $pages, (int) $current ) );
		$query   = array_merge( $keep, array( $name => '' !== $search ? $search : null ) );
		$links   = paginate_links(
			array(
				'base'      => self::list_url_paged( $page_arg, $query ),
				'format'    => '',
				'current'   => $current,
				'total'     => $pages,
				'prev_text' => '‹',
				'next_text' => '›',
			)
		);
		if ( $links ) {
			echo '<div class="tablenav"><div class="tablenav-pages">' . wp_kses_post( $links ) . '</div></div>';
		}
	}

	public function page() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$search = isset( $_GET['sq'] ) ? sanitize_text_field( wp_unslash( $_GET['sq'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$paged  = isset( $_GET['spage'] ) ? max( 1, absint( wp_unslash( $_GET['spage'] ) ) ) : 1;

		$scenes_result = $this->query_scenes( $search, $paged, self::PER_PAGE );
		$scenes        = $scenes_result['posts'];
		$scenes_total  = (int) $scenes_result['total'];

		$search_args = array(
			'sq'    => '' !== $search ? $search : null,
			'spage' => $paged > 1 ? $paged : null,
		);

		$viewer = v_dicom_viewer_url();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Cenas salvas', 'v-dicom' ); ?></h1>
			<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
			<?php if ( isset( $_GET['deleted'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Cena removida.', 'v-dicom' ); ?></p></div>
			<?php endif; ?>

			<p><?php esc_html_e( 'Lista de cenas salvas pelos usuários. Cada cena contém os arquivos do estudo, anotações e configurações.', 'v-dicom' ); ?></p>

			<?php $this->render_list_search( 'sq', $search, array(), __( 'Buscar por título, chave ou dono…', 'v-dicom' ), $scenes_total ); ?>
			<table class="widefat striped">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Título', 'v-dicom' ); ?></th>
						<th><?php esc_html_e( 'Dono', 'v-dicom' ); ?></th>
						<th><?php esc_html_e( 'Arquivos', 'v-dicom' ); ?></th>
						<th><?php esc_html_e( 'Criada em', 'v-dicom' ); ?></th>
						<th><?php esc_html_e( 'Link de compartilhamento', 'v-dicom' ); ?></th>
						<th style="width:180px"><?php esc_html_e( 'Segmentação', 'v-dicom' ); ?></th>
						<th></th>
					</tr>
				</thead>
				<tbody>
				<?php if ( ! $scenes ) : ?>
					<tr><td colspan="7"><?php echo esc_html( '' !== $search ? __( 'Nenhuma cena encontrada para a busca.', 'v-dicom' ) : __( 'Nenhuma cena salva ainda.', 'v-dicom' ) ); ?></td></tr>
				<?php endif; ?>
				<?php
				$seg_types_all = V_Dicom_Storage::get_segmentation_types( true );
				$seg_types_enabled = array_values( array_filter( $seg_types_all, function( $t ) { return ! empty( $t['enabled'] ); } ) );
				foreach ( $scenes as $scene ) :
					$key      = (string) get_post_meta( $scene->ID, V_Dicom_Storage::META_KEY, true );
					$files    = get_post_meta( $scene->ID, V_Dicom_Storage::META_FILES, true );
					$files    = is_array( $files ) ? $files : array();
					$link     = add_query_arg( 'scene', $key, $viewer );
					$del      = wp_nonce_url(
						admin_url( 'admin-post.php?action=v_dicom_delete&key=' . $key ),
						'v_dicom_delete_' . $key
					);
					$segs_map = V_Dicom_Storage::get_segmentations( $key );
					$seg_used = ! empty( $segs_map ) || V_Dicom_Storage::isSegmentationUsed( $key );
					$seg_job  = '';
					if ( ! empty( $segs_map ) ) { $first_seg = reset( $segs_map ); $seg_job = (string) ( $first_seg['status'] ?? '' ); } else { $seg_job = (string) V_Dicom_Storage::getJobStatus( $key ); }
					$seg_started = 0; $seg_finished = 0; $seg_duration_str = '';
					if ( ! empty( $segs_map ) ) {
						$max_start = 0; $max_finish = 0;
						foreach ( $segs_map as $sv ) { if ( ! empty( $sv['started_at'] ) ) $max_start = max( $max_start, (int) $sv['started_at'] ); if ( ! empty( $sv['finished_at'] ) ) $max_finish = max( $max_finish, (int) $sv['finished_at'] ); }
						$seg_started = $max_start; $seg_finished = $max_finish;
					} else {
						$seg_started = $seg_used ? (int) get_post_meta( $scene->ID, V_Dicom_Storage::SEG_STARTED_AT_KEY, true ) : 0;
						$seg_finished = $seg_used ? (int) get_post_meta( $scene->ID, V_Dicom_Storage::SEG_FINISHED_AT_KEY, true ) : 0;
					}
					$seg_duration = 0;
					if ( $seg_started && $seg_finished && $seg_finished >= $seg_started ) { $seg_duration = $seg_finished - $seg_started; }
					elseif ( $seg_started && ! $seg_finished ) { $seg_duration = time() - $seg_started; }
					if ( $seg_started ) {
						if ( $seg_duration < 60 ) { $seg_duration_str = $seg_duration . 's'; }
						elseif ( $seg_duration < 3600 ) { $seg_duration_str = floor( $seg_duration / 60 ) . 'm ' . ( $seg_duration % 60 ) . 's'; }
						else { $seg_duration_str = floor( $seg_duration / 3600 ) . 'h ' . floor( ( $seg_duration % 3600 ) / 60 ) . 'm ' . ( $seg_duration % 60 ) . 's'; }
						if ( ! $seg_finished ) { $seg_duration_str .= ' ' . __( '(em andamento)', 'v-dicom' ); }
					}
					$has_dbg = false;
					if ( current_user_can( 'edit_users' ) ) {
						$has_dbg = $seg_started ? true : false;
						if ( ! $has_dbg ) {
							foreach ( $segs_map as $sv ) { if ( ! empty( $sv['run_debug'] ) || ! empty( $sv['last_status_debug'] ) || ! empty( $sv['last_callback'] ) ) { $has_dbg = true; break; } }
						}
						if ( ! $has_dbg ) { $has_dbg = get_post_meta( $scene->ID, V_Dicom_Storage::RUN_DEBUG_KEY, true ) || get_post_meta( $scene->ID, V_Dicom_Storage::LAST_STATUS_DEBUG_KEY, true ) || get_post_meta( $scene->ID, V_Dicom_Storage::LAST_CALLBACK_KEY, true ); }
					}
					$run_dbg = null; $run_time = null; $run_resp = null; $stat_dbg = null; $stat_time = null; $cb_dbg = null; $cb_time = null; $cb_err = ''; $cb_out = '';
					if ( current_user_can( 'edit_users' ) ) {
						if ( ! empty( $segs_map ) ) {
							$first_key = array_keys( $segs_map )[0];
							$fv = $segs_map[ $first_key ];
							$run_dbg = $fv['run_debug'] ?? null; $run_time = $fv['run_debug_time'] ?? null; $run_resp = $fv['run_response'] ?? null;
							$stat_dbg = $fv['last_status_debug'] ?? null; $stat_time = $fv['last_status_time'] ?? null;
							$cb_dbg = $fv['last_callback'] ?? null; $cb_time = $fv['last_callback_time'] ?? null;
							$cb_err = $fv['last_error'] ?? ''; $cb_out = $fv['last_output'] ?? '';
						} else {
							$run_dbg = get_post_meta( $scene->ID, V_Dicom_Storage::RUN_DEBUG_KEY, true ); $run_time = $run_dbg ? get_post_meta( $scene->ID, V_Dicom_Storage::RUN_DEBUG_TIME_KEY, true ) : null; $run_resp = $run_dbg ? get_post_meta( $scene->ID, '_v_dicom_runpod_run_response', true ) : null;
							$stat_dbg = get_post_meta( $scene->ID, V_Dicom_Storage::LAST_STATUS_DEBUG_KEY, true ); $stat_time= $stat_dbg ? get_post_meta( $scene->ID, V_Dicom_Storage::LAST_STATUS_TIME_KEY, true ) : null;
							$cb_dbg = get_post_meta( $scene->ID, V_Dicom_Storage::LAST_CALLBACK_KEY, true ); $cb_time = $cb_dbg ? get_post_meta( $scene->ID, V_Dicom_Storage::LAST_CALLBACK_TIME_KEY, true ) : null;
							$cb_err = $cb_dbg ? get_post_meta( $scene->ID, '_v_dicom_runpod_last_error', true ) : ''; $cb_out = $cb_dbg ? get_post_meta( $scene->ID, '_v_dicom_runpod_last_output', true ) : '';
						}
					}
					?>
					<tr>
						<td><strong><?php echo esc_html( get_the_title( $scene ) ); ?></strong><br><code style="font-size:10px;"><?php echo esc_html( $key ); ?></code></td>
						<td><?php $owner = get_userdata( (int) $scene->post_author ); if ( $owner ) : ?><?php echo get_avatar( $owner->ID, 24 ); ?> <strong><?php echo esc_html( $owner->display_name ); ?></strong><br><span class="description">@<?php echo esc_html( $owner->user_login ); ?>  — ID <?php echo (int) $owner->ID; ?></span><?php else : ?><em class="description"><?php esc_html_e( 'Usuário removido', 'v-dicom' ); ?> (ID <?php echo (int) $scene->post_author; ?>)</em><?php endif; ?></td>
						<td><?php echo (int) count( $files ); ?></td>
						<td><?php echo esc_html( get_the_date( '', $scene ) ); ?></td>
						<td>
							<input type="text" readonly class="large-text code" value="<?php echo esc_url( $link ); ?>"
								onfocus="this.select()" />
						</td>
						<td data-seg-cell="<?php echo esc_attr( $key ); ?>">
							<?php if ( empty( $seg_types_enabled ) ) : ?>
								<span class="description"><?php esc_html_e( 'Nenhum tipo configurado.', 'v-dicom' ); ?></span>
							<?php elseif ( empty( $segs_map ) ) : ?>
								<?php foreach ( $seg_types_enabled as $stype ) : ?>
									<button type="button" class="button v-dicom-seg-btn" data-key="<?php echo esc_attr( $key ); ?>" data-type="<?php echo esc_attr( $stype['id'] ); ?>" title="<?php echo esc_attr( wp_strip_all_tags( $stype['description'] ) ); ?>">
										<?php echo esc_html( $stype['name'] ); ?> — <?php echo (int) $stype['cost']; ?> cr
									</button>
								<?php endforeach; ?>
							<?php else : ?>
								<?php foreach ( $segs_map as $tid => $sv ) : $st = (string) ( $sv['status'] ?? '' ); ?>
									<div style="margin-bottom:4px">
										<strong><?php echo esc_html( $tid ); ?>:</strong>
										<?php if ( 'COMPLETED' === $st ) : ?><span style="color:#00a32a;"><?php esc_html_e( '✓ Concluída', 'v-dicom' ); ?></span>
										<?php elseif ( 'FAILED' === $st ) : ?><span style="color:#d63638;"><?php esc_html_e( '✕ Falhou — crédito devolvido', 'v-dicom' ); ?></span> <button type="button" class="button button-small v-dicom-seg-btn" data-key="<?php echo esc_attr( $key ); ?>" data-type="<?php echo esc_attr( $tid ); ?>"><?php esc_html_e( 'Tentar novamente', 'v-dicom' ); ?></button>
										<?php else : ?><span style="color:#f0a500;">⏳ <?php echo esc_html( $st ?: 'IN_QUEUE' ); ?></span><?php endif; ?>
									</div>
								<?php endforeach; ?>
								<?php foreach ( $seg_types_enabled as $stype ) : if ( isset( $segs_map[ $stype['id'] ] ) ) continue; ?>
									<button type="button" class="button v-dicom-seg-btn" data-key="<?php echo esc_attr( $key ); ?>" data-type="<?php echo esc_attr( $stype['id'] ); ?>" title="<?php echo esc_attr( wp_strip_all_tags( $stype['description'] ) ); ?>">
										<?php echo esc_html( $stype['name'] ); ?> — <?php echo (int) $stype['cost']; ?> cr
									</button>
								<?php endforeach; ?>
							<?php endif; ?>
							<?php if ( $seg_started ) : ?>
								<br><span style="font-size:11px;color:#50575e;">
									<?php echo esc_html( date_i18n( 'd/m/Y H:i', $seg_started ) ); ?>
									<?php if ( $seg_finished ) : ?> → <?php echo esc_html( date_i18n( 'd/m/Y H:i', $seg_finished ) ); ?><?php endif; ?>
									— <strong><?php echo esc_html( $seg_duration_str ); ?></strong>
								</span>
							<?php endif; ?>
							<?php if ( $has_dbg && current_user_can( 'edit_users' ) ) : ?>
								<br><a href="#" onclick="var e=document.getElementById('vd-dbg-<?php echo esc_attr( $key ); ?>');e.style.display=e.style.display==='none'?'block':'none';return false;" style="font-size:11px;"><?php esc_html_e( 'Ver logs da segmentação', 'v-dicom' ); ?></a>
							<?php endif; ?>
						</td>
						<td>
							<a class="button" href="<?php echo esc_url( $link ); ?>" target="_blank"><?php esc_html_e( 'Abrir', 'v-dicom' ); ?></a>
							<a class="button button-link-delete" href="<?php echo esc_url( $del ); ?>"
								onclick="return confirm('<?php echo esc_js( __( 'Remover esta cena e seus arquivos?', 'v-dicom' ) ); ?>')">
								<?php esc_html_e( 'Excluir', 'v-dicom' ); ?>
							</a>
						</td>
					</tr>
					<?php if ( $has_dbg && current_user_can( 'edit_users' ) ) : ?>
					<tr id="vd-dbg-<?php echo esc_attr( $key ); ?>" style="display:none;background:#f6f7f7;">
						<td colspan="7" style="padding:12px;">
							<strong><?php esc_html_e( 'Debug da segmentação — por cena (admin)', 'v-dicom' ); ?></strong>
							<?php if ( $seg_started ) : ?>
								<div style="margin:8px 0;padding:8px;background:#fff;border:1px solid #ccd0d4;border-left:4px solid #2271b1;">
									<strong><?php esc_html_e( 'Início:', 'v-dicom' ); ?></strong> <?php echo esc_html( date_i18n( 'Y-m-d H:i:s', $seg_started ) ); ?>
									<?php if ( $seg_finished ) : ?> &nbsp; <strong><?php esc_html_e( 'Fim:', 'v-dicom' ); ?></strong> <?php echo esc_html( date_i18n( 'Y-m-d H:i:s', $seg_finished ) ); ?><?php else : ?> &nbsp; <em><?php esc_html_e( '(em andamento)', 'v-dicom' ); ?></em><?php endif; ?>
									&nbsp; <strong><?php esc_html_e( 'Total:', 'v-dicom' ); ?></strong> <?php echo esc_html( $seg_duration_str ); ?>
								</div>
							<?php endif; ?>
							<?php if ( $run_dbg ) : ?>
								<details open style="margin-top:10px;"><summary><strong>POST execução</strong> — <?php echo $run_time ? esc_html( date_i18n( 'Y-m-d H:i:s', (int) $run_time ) ) : ''; ?> — <code><?php echo esc_html( $run_dbg['request_url'] ?? '' ); ?></code></summary>
									<div style="margin-top:8px;"><em><?php esc_html_e( 'Payload enviado:', 'v-dicom' ); ?></em><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( $run_dbg['request_body'] ?? wp_json_encode( $run_dbg['input_sent'] ?? $run_dbg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ); ?></pre></div>
									<div><em>Request body:</em><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:260px;overflow:auto;"><?php echo esc_html( $run_dbg['request_body'] ?? $run_dbg['request_body_json'] ?? '' ); ?></pre></div>
									<div><em>Headers:</em><pre style="white-space:pre-wrap;background:#fff;border:1px solid #ccd0d4;padding:8px;"><?php echo esc_html( wp_json_encode( $run_dbg['request_headers'] ?? array(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) ); ?></pre></div>
									<div><em><?php esc_html_e( 'Resposta do serviço:', 'v-dicom' ); ?></em> HTTP <?php echo esc_html( $run_dbg['response_code'] ?? '—' ); ?><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( $run_dbg['response_body_raw'] ?? wp_json_encode( $run_resp, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ); ?></pre></div>
								</details>
							<?php endif; ?>
							<?php if ( $stat_dbg ) : ?>
								<details <?php echo $run_dbg ? '' : 'open'; ?> style="margin-top:10px;"><summary><strong>GET /segmentation-status</strong> — <?php esc_html_e( 'último polling', 'v-dicom' ); ?> — <?php echo $stat_time ? esc_html( date_i18n( 'Y-m-d H:i:s', (int) $stat_time ) ) : ''; ?> — <code><?php echo esc_html( $stat_dbg['request_url'] ?? '' ); ?></code></summary>
									<div style="margin-top:8px;"><em>Job ID:</em> <code><?php echo esc_html( $stat_dbg['job_id'] ?? '' ); ?></code> — HTTP <?php echo esc_html( $stat_dbg['response_code'] ?? '—' ); ?></div>
									<pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( wp_json_encode( $stat_dbg['response_json'] ?? $stat_dbg['response_body_raw'] ?? $stat_dbg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ); ?></pre>
									<details style="margin-top:6px;"><summary>Raw body</summary><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( $stat_dbg['response_body_raw'] ?? '' ); ?></pre></details>
								</details>
							<?php endif; ?>
							<?php if ( $cb_dbg ) : ?>
								<details style="margin-top:10px;"><summary><strong>POST callback (serviço → WP)</strong> — <?php echo $cb_time ? esc_html( date_i18n( 'Y-m-d H:i:s', (int) $cb_time ) ) : ''; ?> — <?php esc_html_e( 'status mapeado:', 'v-dicom' ); ?> <code><?php echo esc_html( $cb_dbg['mapped_status'] ?? '' ); ?></code></summary>
									<pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( wp_json_encode( $cb_dbg['body_params'] ?? $cb_dbg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ); ?></pre>
									<?php if ( $cb_err || $cb_out ) : ?>
										<div><em><?php esc_html_e( 'error (até 4k):', 'v-dicom' ); ?></em><pre style="white-space:pre-wrap;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:200px;overflow:auto;"><?php echo esc_html( $cb_err ); ?></pre></div>
										<div><em><?php esc_html_e( 'output (até 8k):', 'v-dicom' ); ?></em><pre style="white-space:pre-wrap;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:260px;overflow:auto;"><?php echo esc_html( $cb_out ); ?></pre></div>
									<?php endif; ?>
									<details style="margin-top:6px;"><summary>Raw body</summary><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( $cb_dbg['raw_body'] ?? '' ); ?></pre></details>
								</details>
							<?php endif; ?>
							<p class="description" style="margin-top:10px;"><?php esc_html_e( 'Logs salvos no post meta da cena. DEBUG_SEGMENTATION=true também inclui debug na resposta JSON de /run e /segmentation-status.', 'v-dicom' ); ?></p>
						</td>
					</tr>
					<?php endif; ?>
				<?php endforeach; ?>
				</tbody>
			</table>
			<?php $this->render_list_pages( 'sq', 'spage', $search, $scenes_total, self::PER_PAGE, array(), $paged ); ?>
		</div>
		<script>
		(function () {
			var restUrl = <?php echo wp_json_encode( esc_url_raw( rest_url( V_Dicom_REST::NS ) ) ); ?>;
			var nonce = <?php echo wp_json_encode( wp_create_nonce( 'wp_rest' ) ); ?>;
			var vdSceneI18n = <?php echo wp_json_encode( array(
				'completed'    => __( '✓ Concluída', 'v-dicom' ),
				'failed'       => __( '✕ Falhou', 'v-dicom' ),
				'fail_alert'   => __( 'A segmentação falhou.', 'v-dicom' ),
				'segmentation' => __( 'segmentação', 'v-dicom' ),
				/* translators: %s: segmentation type name or id. */
				'start'        => __( 'Iniciar %s? Confirme para consumir os créditos do tipo.', 'v-dicom' ),
				'sending'      => __( 'Enviando…', 'v-dicom' ),
				'start_error'  => __( 'Erro ao iniciar a segmentação.', 'v-dicom' ),
				'net_error'    => __( 'Erro de rede ao iniciar a segmentação.', 'v-dicom' ),
			) ); ?>;

			function segCell(key) {
				return document.querySelector('[data-seg-cell="' + key + '"]');
			}

			function renderStatus(key, status) {
				var cell = segCell(key);
				if (!cell) return;
				var span = document.createElement('span');
				var text;
				if (status === 'COMPLETED') {
					span.style.color = '#00a32a';
					text = vdSceneI18n.completed;
				} else if (status === 'FAILED') {
					span.style.color = '#d63638';
					text = vdSceneI18n.failed;
				} else {
					span.style.color = '#f0a500';
					text = '⏳ ' + status;
				}
				span.textContent = text;
				cell.textContent = '';
				cell.appendChild(span);
			}

			function poll(key, type) {
				var attempts = 0;
				var timer = setInterval(function () {
					attempts++;
					if (attempts > 240) {
						clearInterval(timer);
						renderStatus(key, 'TIMEOUT');
						return;
					}
					var u = restUrl + '/scenes/' + encodeURIComponent(key) + '/segmentation-status' + (type ? '?type=' + encodeURIComponent(type) : '');
					fetch(u, { method: 'GET', credentials: 'same-origin', headers: { 'X-WP-Nonce': nonce } }).then(function (r) { return r.json(); }).then(function (data) {
						var st = data && (data.status || (data.segmentations && data.segmentations[type]));
						if (!st) return;
						renderStatus(key, st);
						if (st === 'COMPLETED') { clearInterval(timer); window.location.reload(); }
						else if (st === 'FAILED') { clearInterval(timer); alert(vdSceneI18n.fail_alert); }
					}).catch(function () {});
				}, 5000);
			}

			document.queryAll('.v-dicom-seg-btn').forEach(function (btn) {
				btn.addEventListener('click', function () {
					var key = btn.getAttribute('data-key');
					var type = btn.getAttribute('data-type') || '';
					var label = type ? type : vdSceneI18n.segmentation;
					if (!confirm(vdSceneI18n.start.replace('%s', label))) return;
					var prev = btn.textContent;
					btn.disabled = true;
					btn.textContent = vdSceneI18n.sending;
					fetch(restUrl + '/scenes/' + encodeURIComponent(key) + '/run', {
						method: 'POST',
						credentials: 'same-origin',
						headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
						body: JSON.stringify(type ? { type: type } : {})
					}).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); }).then(function (res) {
						if (!res.ok || res.data.code) {
							var msg = res.data && res.data.message ? res.data.message : vdSceneI18n.start_error;
							alert(msg);
							btn.disabled = false;
							btn.textContent = prev;
							return;
						}
						renderStatus(key, res.data.status || 'IN_QUEUE');
						poll(key, type || res.data.type);
					}).catch(function () {
						alert(vdSceneI18n.net_error);
						btn.disabled = false;
						btn.textContent = prev;
					});
				});
			});
		})();
		</script>
		<?php
	}
}