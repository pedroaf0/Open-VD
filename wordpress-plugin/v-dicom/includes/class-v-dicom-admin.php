<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin screen: list scenes, copy share links, delete scenes.
 */
class V_Dicom_Admin {

	/** Rows per page in the admin lists. */
	const PER_PAGE_USERS  = 20;
	const PER_PAGE_SCENES = 20;

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_media' ) );
		add_action( 'admin_post_v_dicom_delete', array( $this, 'handle_delete' ) );
		add_action( 'admin_post_v_dicom_limit', array( $this, 'handle_limit' ) );
		add_action( 'admin_post_v_dicom_theme', array( $this, 'handle_theme' ) );
		add_action( 'admin_post_v_dicom_apikey', array( $this, 'handle_apikey' ) );
		add_action( 'admin_post_v_dicom_seg_types', array( $this, 'handle_seg_types' ) );
		add_action( 'admin_post_v_dicom_url_auth', array( $this, 'handle_url_auth' ) );
		add_action( 'admin_post_v_dicom_direct_dicom', array( $this, 'handle_direct_dicom' ) );
		add_action( 'admin_post_v_dicom_newuser_defaults', array( $this, 'handle_newuser_defaults' ) );
		add_action( 'admin_post_v_dicom_mesh_colors', array( $this, 'handle_mesh_colors' ) );
		add_action( 'admin_post_v_dicom_public_loading', array( $this, 'handle_public_loading' ) );
	}

	/** Load the media library only on the plugin screen (logo picker). */
	public function enqueue_media( $hook ) {
		if ( 'toplevel_page_v-dicom' === $hook ) {
			wp_enqueue_media();
		}
	}

	public function menu() {
		add_menu_page(
			__( 'v-dicom', 'v-dicom' ),
			__( 'v-dicom', 'v-dicom' ),
			'upload_files',
			'v-dicom',
			array( $this, 'page' ),
			'dashicons-visibility',
			58
		);
		add_submenu_page(
			'v-dicom',
			__( 'Cores dos modelos (STL)', 'v-dicom' ),
			__( 'Cores dos modelos', 'v-dicom' ),
			'edit_users',
			'v-dicom-colors',
			array( $this, 'page_mesh_colors' )
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
		wp_safe_redirect( admin_url( 'admin.php?page=v-dicom&deleted=1' ) );
		exit;
	}

	/** Save the per-user storage limits (MB) and processing credits sent by the admin. */
	public function handle_limit() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_limits' );
		$raw = isset( $_POST['v_dicom_limit'] ) && is_array( $_POST['v_dicom_limit'] ) ? array_map( 'absint', wp_unslash( $_POST['v_dicom_limit'] ) ) : array();
		foreach ( $raw as $uid => $mb ) {
			$uid = (int) $uid;
			if ( $uid > 0 ) {
				update_user_meta( $uid, V_Dicom_Storage::META_LIMIT, max( 0, (int) $mb ) );
			}
		}
		$credits_raw = isset( $_POST['v_dicom_credit'] ) && is_array( $_POST['v_dicom_credit'] ) ? array_map( 'absint', wp_unslash( $_POST['v_dicom_credit'] ) ) : array();
		foreach ( $credits_raw as $uid => $credits ) {
			$uid = (int) $uid;
			if ( $uid > 0 ) {
				V_Dicom_Storage::set_user_credit( $uid, max( 0, (int) $credits ) );
			}
		}
		wp_safe_redirect( add_query_arg( 'limitsaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
	}

	/** Save the white-label appearance (name, logo, colors). */
	public function handle_theme() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_theme' );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each field is sanitized in V_Dicom_Theme::save().
		$raw = isset( $_POST['v_dicom_theme'] ) && is_array( $_POST['v_dicom_theme'] ) ? wp_unslash( $_POST['v_dicom_theme'] ) : array();
		V_Dicom_Theme::save( $raw );
		wp_safe_redirect( add_query_arg( 'themesaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
	}

	/** Save the admin API key used to authorize uploads/downloads via REST. */
	public function handle_apikey() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_apikey' );
		$key = isset( $_POST['v_dicom_apikey'] ) ? sanitize_text_field( wp_unslash( $_POST['v_dicom_apikey'] ) ) : '';
		V_Dicom_Storage::set_api_key( $key );
		wp_safe_redirect( add_query_arg( 'keysaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
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
				'authorization' => $item['authorization'] ?? '',
				'max_voxels'    => $item['max_voxels'] ?? 0,
				'max_triangles' => $item['max_triangles'] ?? 0,
				'cost'          => $item['cost'] ?? 0,
				'enabled'       => ! empty( $item['enabled'] ),
			), $id );
			if ( ! $san ) { continue; }
			$out[] = $san;
		}
		update_option( V_Dicom_Storage::OPTION_SEG_TYPES, array_values( $out ) );
		wp_safe_redirect( add_query_arg( 'segtypessaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
	}

	public function handle_newuser_defaults() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_newuser_defaults' );
		V_Dicom_Storage::set_default_new_user_credit( isset( $_POST['v_dicom_default_credit'] ) ? absint( wp_unslash( $_POST['v_dicom_default_credit'] ) ) : 0 );
		V_Dicom_Storage::set_default_new_user_storage_mb( isset( $_POST['v_dicom_default_storage_mb'] ) ? absint( wp_unslash( $_POST['v_dicom_default_storage_mb'] ) ) : 0 );
		wp_safe_redirect( add_query_arg( 'newusersaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
	}

	/** Toggle URL authorization on/off. */
	public function handle_url_auth() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_url_auth' );
		V_Dicom_Storage::set_url_auth_enabled( isset( $_POST['v_dicom_url_auth'] ) );
		wp_safe_redirect( add_query_arg( 'urlauthsaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
	}

	/** Toggle direct DICOM loading/upload on/off. */
	public function handle_direct_dicom() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_direct_dicom' );
		V_Dicom_Storage::set_direct_dicom_enabled( isset( $_POST['v_dicom_direct_dicom'] ) );
		wp_safe_redirect( add_query_arg( 'directdicomsaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
	}

	/** Toggle public loading of exams without login on/off. */
	public function handle_public_loading() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_public_loading' );
		V_Dicom_Storage::set_public_loading_enabled( isset( $_POST['v_dicom_public_loading'] ) );
		wp_safe_redirect( add_query_arg( 'publicloadingsaved', 1, admin_url( 'admin.php?page=v-dicom' ) ) );
		exit;
	}

	/** Save the mesh name -> special color rules edited on the submenu page. */
	public function handle_mesh_colors() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_mesh_colors' );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each rule is sanitized in V_Dicom_Storage::set_mesh_colors().
		$raw = isset( $_POST['v_dicom_mesh_colors'] ) && is_array( $_POST['v_dicom_mesh_colors'] ) ? wp_unslash( $_POST['v_dicom_mesh_colors'] ) : array();
		$rules = array();
		foreach ( $raw as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			if ( ! empty( $item['_delete'] ) ) {
				continue;
			}
			$rules[] = array(
				'name'  => isset( $item['name'] ) ? $item['name'] : '',
				'color' => isset( $item['color'] ) ? $item['color'] : '',
				'match' => isset( $item['match'] ) ? $item['match'] : 'exact',
			);
		}
		V_Dicom_Storage::set_mesh_colors( $rules );
		wp_safe_redirect( add_query_arg( 'meshcolorssaved', 1, admin_url( 'admin.php?page=v-dicom-colors' ) ) );
		exit;
	}

	/**
	 * Paginated user list with an optional search over login, e-mail, nicename
	 * and display name. Returns the users of the current page plus the total
	 * number of matches.
	 */
	private function query_quota_users( $search, $paged, $per_page ) {
		$per_page = max( 1, (int) $per_page );
		$args     = array(
			'orderby'     => 'display_name',
			'order'       => 'ASC',
			'number'      => $per_page,
			'offset'      => ( max( 1, (int) $paged ) - 1 ) * $per_page,
			'count_total' => true,
		);
		if ( '' !== $search ) {
			$args['search']         = '*' . $search . '*';
			$args['search_columns'] = array( 'user_login', 'user_email', 'user_nicename', 'display_name' );
		}
		$query = new WP_User_Query( $args );
		return array(
			'users' => $query->get_results(),
			'total' => (int) $query->get_total(),
		);
	}

	private static function format_bytes( $bytes ) {
		$mb = (int) $bytes / 1048576;
		if ( $mb < 1 ) {
			return number_format_i18n( $mb, 2 ) . ' MB';
		}
		if ( $mb < 1024 ) {
			return number_format_i18n( $mb, 1 ) . ' MB';
		}
		return number_format_i18n( $mb / 1024, 2 ) . ' GB';
	}

	/** This admin screen's URL with the given query args (null/'' values are dropped). */
	private static function list_url( array $args = array() ) {
		$args = array_merge( array( 'page' => 'v-dicom' ), $args );
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
		$args = array_merge( $args, array( 'page' => 'v-dicom', $page_arg => '__VD_PAGE__' ) );
		$args = array_filter(
			$args,
			static function ( $v ) {
				return null !== $v && '' !== $v;
			}
		);
		return str_replace( '__VD_PAGE__', '%#%', admin_url( 'admin.php' ) . '?' . http_build_query( $args ) );
	}

	/**
	 * Renders the search box for one of the admin lists.
	 *
	 * @param string $name        Query arg holding the search term (uq|sq).
	 * @param string $search      Current search term.
	 * @param array  $keep        Extra query args to preserve (the other list's state).
	 * @param string $placeholder Search field placeholder.
	 * @param int    $total       Total number of rows across all pages.
	 */
	private function render_list_search( $name, $search, array $keep, $placeholder, $total ) {
		?>
		<form method="get" action="<?php echo esc_url( admin_url( 'admin.php' ) ); ?>" style="margin:8px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
			<input type="hidden" name="page" value="v-dicom" />
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
	 * Renders the pagination links for one of the admin lists.
	 *
	 * @param string $name     Query arg holding the search term (uq|sq).
	 * @param string $page_arg Query arg holding the page number (upage|spage).
	 * @param string $search   Current search term.
	 * @param int    $total    Total number of rows across all pages.
	 * @param int    $per_page Rows per page.
	 * @param array  $keep     Extra query args to preserve (the other list's state).
	 * @param int    $current  Current page number.
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

	/**
	 * Submenu page: editor for the mesh name -> special color rules.
	 *
	 * The rules are shipped to the viewer through the encrypted config and
	 * force the color of any loaded STL/PLY/OBJ whose normalized name matches.
	 */
	public function page_mesh_colors() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		$rules = V_Dicom_Storage::get_mesh_colors();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Cores dos modelos (STL)', 'v-dicom' ); ?></h1>
			<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
			<?php if ( isset( $_GET['meshcolorssaved'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Cores dos modelos atualizadas.', 'v-dicom' ); ?></p></div>
			<?php endif; ?>
			<p class="description" style="max-width:860px">
				<?php esc_html_e( 'Cada regra força a cor de um modelo 3D (STL/PLY/OBJ) pelo nome do arquivo, ignorando a cor salva na cena. O nome é comparado sem a extensão, sem acentos e sem diferenciar maiúsculas de minúsculas.', 'v-dicom' ); ?>
			</p>
			<p class="description" style="max-width:860px">
				<?php esc_html_e( 'Use "Exato" para casar o nome inteiro (ex.: mandibula), "Contém" para casar qualquer nome que inclua o texto (ex.: dente também casa dente 11) ou "Regex" para uma expressão regular (ex.: ^dente \\d+$). A regex é testada no nome normalizado — sem extensão, sem acentos e em minúsculas — sem diferenciar maiúsculas/minúsculas. A primeira regra que combinar é aplicada; deixe as mais específicas no topo.', 'v-dicom' ); ?>
				<?php esc_html_e( 'Se todas as regras forem excluídas, nenhuma cor especial é forçada e cada modelo usa a cor salva na cena. Regras com regex inválida são descartadas.', 'v-dicom' ); ?>
			</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="v_dicom_mesh_colors" />
				<?php wp_nonce_field( 'v_dicom_mesh_colors' ); ?>
				<table class="widefat striped" style="max-width:860px" id="vd-mesh-colors-table">
					<thead>
						<tr>
							<th scope="col"><?php esc_html_e( 'Nome do modelo', 'v-dicom' ); ?></th>
							<th scope="col" style="width:110px"><?php esc_html_e( 'Cor', 'v-dicom' ); ?></th>
							<th scope="col" style="width:170px"><?php esc_html_e( 'Correspondência', 'v-dicom' ); ?></th>
							<th scope="col" style="width:80px"><?php esc_html_e( 'Excluir', 'v-dicom' ); ?></th>
						</tr>
					</thead>
					<tbody id="vd-mesh-colors-body">
					<?php foreach ( $rules as $idx => $rule ) : ?>
						<tr class="vd-mesh-color-row">
							<td><input type="text" name="v_dicom_mesh_colors[<?php echo (int) $idx; ?>][name]" value="<?php echo esc_attr( $rule['name'] ); ?>" class="regular-text" style="width:100%" placeholder="<?php esc_attr_e( 'Ex.: mandibula', 'v-dicom' ); ?>" /></td>
							<td><input type="color" name="v_dicom_mesh_colors[<?php echo (int) $idx; ?>][color]" value="<?php echo esc_attr( $rule['color'] ); ?>" style="width:100%" /></td>
							<td>
								<select name="v_dicom_mesh_colors[<?php echo (int) $idx; ?>][match]" style="width:100%">
									<option value="exact" <?php selected( 'exact' === $rule['match'] ); ?>><?php esc_html_e( 'Exato', 'v-dicom' ); ?></option>
									<option value="contains" <?php selected( 'contains' === $rule['match'] ); ?>><?php esc_html_e( 'Contém', 'v-dicom' ); ?></option>
									<option value="regex" <?php selected( 'regex' === $rule['match'] ); ?>><?php esc_html_e( 'Regex', 'v-dicom' ); ?></option>
								</select>
							</td>
							<td style="text-align:center"><input type="checkbox" name="v_dicom_mesh_colors[<?php echo (int) $idx; ?>][_delete]" value="1" /></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
				<p>
					<button type="button" class="button" id="vd-add-mesh-color"><?php esc_html_e( 'Adicionar regra', 'v-dicom' ); ?></button>
					<button type="button" class="button button-link-delete" id="vd-reset-mesh-colors" style="margin-left:8px"><?php esc_html_e( 'Restaurar padrões', 'v-dicom' ); ?></button>
				</p>
				<?php submit_button( __( 'Salvar cores', 'v-dicom' ) ); ?>
			</form>
			<script>
			var vdMeshLabels = <?php echo wp_json_encode(
				array(
					'name'     => __( 'Nome do modelo', 'v-dicom' ),
					'namePh'   => __( 'Ex.: mandibula', 'v-dicom' ),
					'color'    => __( 'Cor', 'v-dicom' ),
					'match'    => __( 'Correspondência', 'v-dicom' ),
					'exact'    => __( 'Exato', 'v-dicom' ),
					'contains' => __( 'Contém', 'v-dicom' ),
					'regex'    => __( 'Regex', 'v-dicom' ),
					'delete'   => __( 'Excluir', 'v-dicom' ),
					'confirm'  => __( 'Restaurar as regras padrão? As alterações atuais serão perdidas ao salvar.', 'v-dicom' ),
				)
			); ?>;
			var vdMeshDefaults = <?php echo wp_json_encode( V_Dicom_Storage::default_mesh_colors() ); ?>;
			(function () {
				var body = document.getElementById('vd-mesh-colors-body');
				var addBtn = document.getElementById('vd-add-mesh-color');
				var resetBtn = document.getElementById('vd-reset-mesh-colors');
				if (!body || !addBtn) {
					return;
				}
				function addRow(name, color, match) {
					var idx = body.querySelectorAll('.vd-mesh-color-row').length;
					var tr = document.createElement('tr');
					tr.className = 'vd-mesh-color-row';
					tr.innerHTML = '<td><input type="text" name="v_dicom_mesh_colors[' + idx + '][name]" class="regular-text" style="width:100%" placeholder="' + vdMeshLabels.namePh + '" /></td>'
						+ '<td><input type="color" name="v_dicom_mesh_colors[' + idx + '][color]" style="width:100%" /></td>'
						+ '<td><select name="v_dicom_mesh_colors[' + idx + '][match]" style="width:100%">'
						+ '<option value="exact">' + vdMeshLabels.exact + '</option>'
						+ '<option value="contains">' + vdMeshLabels.contains + '</option>'
						+ '<option value="regex">' + vdMeshLabels.regex + '</option>'
						+ '</select></td>'
						+ '<td style="text-align:center"><input type="checkbox" name="v_dicom_mesh_colors[' + idx + '][_delete]" value="1" /></td>';
					var nameInput = tr.querySelector('input[type="text"]');
					var colorInput = tr.querySelector('input[type="color"]');
					var matchSelect = tr.querySelector('select');
					if (nameInput && typeof name === 'string') { nameInput.value = name; }
					if (colorInput) { colorInput.value = color || '#FFFFFF'; }
					if (matchSelect && (match === 'contains' || match === 'regex')) { matchSelect.value = match; }
					body.appendChild(tr);
					return tr;
				}
				addBtn.addEventListener('click', function () {
					var tr = addRow('', '#FFFFFF', 'exact');
					tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
				});
				if (resetBtn) {
					resetBtn.addEventListener('click', function () {
						if (!window.confirm(vdMeshLabels.confirm)) {
							return;
						}
						body.innerHTML = '';
						vdMeshDefaults.forEach(function (rule) {
							addRow(rule.name, rule.color, rule.match);
						});
					});
				}
			})();
			</script>
		</div>
		<?php
	}

	public function page() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$users_search  = isset( $_GET['uq'] ) ? sanitize_text_field( wp_unslash( $_GET['uq'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$users_paged   = isset( $_GET['upage'] ) ? max( 1, absint( wp_unslash( $_GET['upage'] ) ) ) : 1;
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$scenes_search = isset( $_GET['sq'] ) ? sanitize_text_field( wp_unslash( $_GET['sq'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$scenes_paged  = isset( $_GET['spage'] ) ? max( 1, absint( wp_unslash( $_GET['spage'] ) ) ) : 1;

		$scenes_result = $this->query_scenes( $scenes_search, $scenes_paged, self::PER_PAGE_SCENES );
		$scenes        = $scenes_result['posts'];
		$scenes_total  = (int) $scenes_result['total'];

		// Query args that must survive navigation between the two lists.
		$scenes_args = array(
			'sq'    => '' !== $scenes_search ? $scenes_search : null,
			'spage' => $scenes_paged > 1 ? $scenes_paged : null,
		);
		$users_args  = array(
			'uq'    => '' !== $users_search ? $users_search : null,
			'upage' => $users_paged > 1 ? $users_paged : null,
		);

		$viewer = v_dicom_viewer_url();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'v-dicom', 'v-dicom' ); ?></h1>
			<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
			<?php if ( isset( $_GET['deleted'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Cena removida.', 'v-dicom' ); ?></p></div>
			<?php endif; ?>

			<p>
				<?php esc_html_e( 'O visualizador tem página própria, carregada sem o tema do site.', 'v-dicom' ); ?>
			</p>
			<p>
				<?php esc_html_e( 'Página do visualizador:', 'v-dicom' ); ?>
				<a href="<?php echo esc_url( $viewer ); ?>" target="_blank"><?php echo esc_html( $viewer ); ?></a>
			</p>

			<?php if ( current_user_can( 'edit_users' ) ) : ?>
				<h2><?php esc_html_e( 'Visual / White label', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['themesaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Visual atualizado.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<?php $theme = V_Dicom_Theme::get(); ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_theme" />
					<?php wp_nonce_field( 'v_dicom_theme' ); ?>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="v-dicom-name"><?php esc_html_e( 'Nome do visualizador', 'v-dicom' ); ?></label></th>
							<td><input type="text" id="v-dicom-name" name="v_dicom_theme[name]" value="<?php echo esc_attr( $theme['name'] ); ?>" class="regular-text" /></td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-logo"><?php esc_html_e( 'Logo', 'v-dicom' ); ?></label></th>
							<td>
								<input type="text" id="v-dicom-logo" name="v_dicom_theme[logo]" value="<?php echo esc_attr( $theme['logo'] ); ?>" class="regular-text" placeholder="https://…/logo.png" />
								<button type="button" id="v-dicom-logo-btn" class="button"><?php esc_html_e( 'Selecionar na biblioteca', 'v-dicom' ); ?></button>
								<?php if ( $theme['logo'] ) : ?>
									<p><img src="<?php echo esc_url( $theme['logo'] ); ?>" alt="<?php esc_attr_e( 'Pré-visualização do logo', 'v-dicom' ); ?>" style="max-height:60px;" /></p>
								<?php endif; ?>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-quiz-url"><?php esc_html_e( 'URL de espera', 'v-dicom' ); ?></label></th>
							<td><input type="url" id="v-dicom-quiz-url" name="v_dicom_theme[quiz_url]" value="<?php echo esc_attr( $theme['quiz_url'] ); ?>" class="regular-text" placeholder="https://…" /></td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-quiz-text"><?php esc_html_e( 'Texto de espera', 'v-dicom' ); ?></label></th>
							<td><textarea id="v-dicom-quiz-text" name="v_dicom_theme[quiz_text]" rows="2" class="large-text" placeholder="<?php esc_attr_e( 'Aguarde, carregando sua cena…', 'v-dicom' ); ?>"><?php echo esc_textarea( $theme['quiz_text'] ); ?></textarea></td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-bg"><?php esc_html_e( 'Cor de fundo', 'v-dicom' ); ?></label></th>
							<td><input type="color" id="v-dicom-bg" name="v_dicom_theme[background]" value="<?php echo esc_attr( $theme['background'] ); ?>" /></td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-panel"><?php esc_html_e( 'Cor da interface', 'v-dicom' ); ?></label></th>
							<td><input type="color" id="v-dicom-panel" name="v_dicom_theme[panel]" value="<?php echo esc_attr( $theme['panel'] ); ?>" /></td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-accent"><?php esc_html_e( 'Cor de destaque', 'v-dicom' ); ?></label></th>
							<td><input type="color" id="v-dicom-accent" name="v_dicom_theme[accent]" value="<?php echo esc_attr( $theme['accent'] ); ?>" /></td>
						</tr>
					</table>
					<p class="description">
						<?php esc_html_e( 'As cores dos cortes (axial, coronal e sagital) são fixas e não podem ser alteradas. As outras cores são aplicadas automaticamente ao visualizador.', 'v-dicom' ); ?>
					</p>
					<?php submit_button( __( 'Salvar visual', 'v-dicom' ) ); ?>
				</form>
				<script>
				(function () {
					var btn = document.getElementById('v-dicom-logo-btn');
					if (!btn || !window.wp || !wp.media) {
						return;
					}
					btn.addEventListener('click', function (e) {
						e.preventDefault();
						var frame = wp.media({ title: <?php echo wp_json_encode( __( 'Escolher logo', 'v-dicom' ) ); ?>, library: { type: 'image' }, multiple: false });
						frame.on('select', function () {
							var url = frame.state().get('selection').first().toJSON().url;
							var input = document.getElementById('v-dicom-logo');
							if (input && url) {
								input.value = url;
							}
						});
						frame.open();
					});
				})();
				</script>
			<?php endif; ?>

			<?php if ( current_user_can( 'edit_users' ) ) : ?>
				<h2><?php esc_html_e( 'API key (upload/download por chave)', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['keysaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'API key atualizada.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<?php $apikey = V_Dicom_Storage::api_key(); ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_apikey" />
					<?php wp_nonce_field( 'v_dicom_apikey' ); ?>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="v-dicom-apikey"><?php esc_html_e( 'Chave de API', 'v-dicom' ); ?></label></th>
							<td>
								<input type="password" id="v-dicom-apikey" name="v_dicom_apikey" value="<?php echo esc_attr( $apikey ); ?>" class="regular-text code" autocomplete="off" />
								<button type="button" id="v-dicom-apikey-gen" class="button"><?php esc_html_e( 'Gerar chave', 'v-dicom' ); ?></button>
								<p class="description">
									<?php esc_html_e( 'Deixe vazio para desativar. Endpoints aceitos com a chave:', 'v-dicom' ); ?>
								</p>
								<code>POST <?php echo esc_html( rest_url( V_Dicom_REST::NS . '/uploads/{id}/files' ) ); ?>?apikey=…</code><br />
								<code>GET <?php echo esc_html( rest_url( V_Dicom_REST::NS . '/download/{id}/zip' ) ); ?>?apikey=…</code>
							</td>
						</tr>
					</table>
					<?php submit_button( __( 'Salvar API key', 'v-dicom' ) ); ?>
				</form>
				<script>
				(function () {
					var btn = document.getElementById('v-dicom-apikey-gen');
					if (!btn || !window.crypto || !crypto.getRandomValues) {
						return;
					}
					btn.addEventListener('click', function (e) {
						e.preventDefault();
						var bytes = new Uint8Array(24);
						crypto.getRandomValues(bytes);
						var key = '';
						for (var i = 0; i < bytes.length; i++) {
							key += ('0' + bytes[i].toString(16)).slice(-2);
						}
						var input = document.getElementById('v-dicom-apikey');
						if (input) {
							input.value = key;
						}
					});
				})();
				</script>

				<h2><?php esc_html_e( 'Autorização de URLs externas', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['urlauthsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Configuração atualizada.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_url_auth" />
					<?php wp_nonce_field( 'v_dicom_url_auth' ); ?>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="v-dicom-url-auth-enabled"><?php esc_html_e( 'Exigir autorização de URL', 'v-dicom' ); ?></label></th>
							<td>
								<label>
									<input type="checkbox" id="v-dicom-url-auth-enabled" name="v_dicom_url_auth" value="1"
										<?php checked( V_Dicom_Storage::url_auth_enabled() ); ?> />
									<?php esc_html_e( 'Exigir autorização (1 crédito) para baixar arquivos de Google Drive/OneDrive.', 'v-dicom' ); ?>
								</label>
								<p class="description">
									<?php esc_html_e( 'Quando ativado, URLs externas precisam ser autorizadas antes do download. Ao desativar, todos os links são baixados sem autorização prévia.', 'v-dicom' ); ?>
								</p>
							</td>
						</tr>
					</table>
					<?php submit_button( __( 'Salvar autorização de URL', 'v-dicom' ) ); ?>
				</form>

				<h2><?php esc_html_e( 'Carregamento de DICOM', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['directdicomsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Configuração atualizada.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_direct_dicom" />
					<?php wp_nonce_field( 'v_dicom_direct_dicom' ); ?>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="v-dicom-direct-dicom-enabled"><?php esc_html_e( 'Permitir carregamento direto de DICOM', 'v-dicom' ); ?></label></th>
							<td>
								<label>
									<input type="checkbox" id="v-dicom-direct-dicom-enabled" name="v_dicom_direct_dicom" value="1"
										<?php checked( V_Dicom_Storage::direct_dicom_enabled() ); ?> />
									<?php esc_html_e( 'Permitir que os usuários abram DICOM de arquivos/pastas do próprio computador e façam upload direto (sem precisar de link do Drive/OneDrive).', 'v-dicom' ); ?>
								</label>
								<p class="description">
									<?php esc_html_e( 'Quando desativado (padrão), os exames só podem ser carregados por link público do Google Drive ou do OneDrive. Quando ativado, também é possível selecionar arquivos ou uma pasta com as fatias DICOM e salvá-las na cena.', 'v-dicom' ); ?>
								</p>
							</td>
						</tr>
					</table>
					<?php submit_button( __( 'Salvar carregamento de DICOM', 'v-dicom' ) ); ?>
				</form>

				<h2><?php esc_html_e( 'Carregamento público sem login', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['publicloadingsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Configuração atualizada.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_public_loading" />
					<?php wp_nonce_field( 'v_dicom_public_loading' ); ?>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="v-dicom-public-loading-enabled"><?php esc_html_e( 'Permitir carregamento público de exames', 'v-dicom' ); ?></label></th>
							<td>
								<label>
									<input type="checkbox" id="v-dicom-public-loading-enabled" name="v_dicom_public_loading" value="1"
										<?php checked( V_Dicom_Storage::public_loading_enabled() ); ?> />
									<?php esc_html_e( 'Permitir que visitantes não autenticados carreguem e visualizem exames (arquivos locais ou URLs suportados) sem fazer login.', 'v-dicom' ); ?>
								</label>
								<p class="description">
									<?php esc_html_e( 'Quando ativado, qualquer pessoa pode abrir o visualizador e carregar exames. Ações protegidas (compartilhar, segmentar) continuam exigindo login. Quando desativado (padrão), o visualizador exige autenticação para carregar exames.', 'v-dicom' ); ?>
								</p>
							</td>
						</tr>
					</table>
					<?php submit_button( __( 'Salvar carregamento público', 'v-dicom' ) ); ?>
				</form>

				<h2><?php esc_html_e( 'Tipos de segmentação (RunPod)', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['segtypessaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Tipos de segmentação atualizados.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<?php $seg_types = V_Dicom_Storage::get_segmentation_types( true ); ?>
				<p class="description"><?php esc_html_e( 'Cada tipo tem nome, descrição (texto rico), URL, Authorization, max-voxels, max-triangles e custo. Desmarque "Ativo" para desabilitar sem excluir. A mesma cena pode usar vários tipos.', 'v-dicom' ); ?></p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_seg_types" />
					<?php wp_nonce_field( 'v_dicom_seg_types' ); ?>
					<div id="vd-seg-types-wrap">
						<?php foreach ( $seg_types as $idx => $t ) : ?>
							<div class="vd-seg-type-box" style="border:1px solid #ccd0d4;padding:16px;margin-bottom:16px;background:#fff;">
								<input type="hidden" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][id]" value="<?php echo esc_attr( $t['id'] ); ?>" />
								<div style="display:grid;grid-template-columns:1fr 1fr 1fr 110px 120px 90px 60px 60px;gap:10px;align-items:end;">
									<div>
										<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Nome*', 'v-dicom' ); ?></label>
										<input type="text" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][name]" value="<?php echo esc_attr( $t['name'] ); ?>" class="regular-text" style="width:100%" required placeholder="<?php esc_attr_e( 'Ex.: Ossos', 'v-dicom' ); ?>" />
									</div>
									<div>
										<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'URL do servidor', 'v-dicom' ); ?></label>
										<input type="url" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][url]" value="<?php echo esc_attr( $t['url'] ); ?>" class="regular-text code" style="width:100%" placeholder="https://api.runpod.ai/v2/ENDPOINT_ID" />
									</div>
									<div>
										<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Authorization', 'v-dicom' ); ?></label>
										<input type="password" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][authorization]" value="<?php echo esc_attr( $t['authorization'] ); ?>" class="regular-text code" style="width:100%" autocomplete="off" placeholder="Bearer rpa_..." />
									</div>
									<div>
										<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Max voxels', 'v-dicom' ); ?></label>
										<input type="number" min="1" step="1" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][max_voxels]" value="<?php echo esc_attr( $t['max_voxels'] ); ?>" class="small-text" style="width:100%" />
									</div>
									<div>
										<label style="font-weight:600;display:block;margin-bottom:4px;"><?php esc_html_e( 'Max triângulos', 'v-dicom' ); ?></label>
										<input type="number" min="1" step="1" name="v_dicom_seg_types[<?php echo (int) $idx; ?>][max_triangles]" value="<?php echo esc_attr( $t['max_triangles'] ); ?>" class="small-text" style="width:100%" />
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
				<script>
				var vdSegLabels = <?php echo wp_json_encode( array(
					'name'                 => __( 'Nome*', 'v-dicom' ),
					'name_hint'            => __( 'Ex.: Ossos', 'v-dicom' ),
					'url'                  => __( 'URL do servidor', 'v-dicom' ),
					'authorization'        => __( 'Authorization', 'v-dicom' ),
					'max_voxels'           => __( 'Max voxels', 'v-dicom' ),
					'max_triangles'        => __( 'Max triângulos', 'v-dicom' ),
					'cost'                 => __( 'Custo', 'v-dicom' ),
					'enabled'              => __( 'Ativo', 'v-dicom' ),
					'delete'               => __( 'Excluir', 'v-dicom' ),
					'description'          => __( 'Descrição (texto rico)', 'v-dicom' ),
					'description_hint'     => __( 'Descrição com formatação — após salvar vira editor rico', 'v-dicom' ),
					'description_help'     => __( 'Após salvar, este campo virará editor visual com formatação.', 'v-dicom' ),
				) ); ?>;
				(function(){
					var btn=document.getElementById('vd-add-seg-type');
					var wrap=document.getElementById('vd-seg-types-wrap');
					if(!btn||!wrap) return;
					btn.addEventListener('click', function(){
						var idx=wrap.querySelectorAll('.vd-seg-type-box').length;
						var div=document.createElement('div');
						div.className='vd-seg-type-box';
						div.style.cssText='border:1px solid #ccd0d4;padding:16px;margin-bottom:16px;background:#fff;';
						div.innerHTML='<input type="hidden" name="v_dicom_seg_types['+idx+'][id]" value="" />'
							+'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 110px 120px 90px 60px 60px;gap:10px;align-items:end;">'
							+'<div><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.name+'</label><input type="text" name="v_dicom_seg_types['+idx+'][name]" class="regular-text" style="width:100%" required placeholder="'+vdSegLabels.name_hint+'" /></div>'
							+'<div><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.url+'</label><input type="url" name="v_dicom_seg_types['+idx+'][url]" class="regular-text code" style="width:100%" placeholder="https://..." /></div>'
							+'<div><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.authorization+'</label><input type="password" name="v_dicom_seg_types['+idx+'][authorization]" class="regular-text code" style="width:100%" autocomplete="off" placeholder="Bearer rpa_..." /></div>'
							+'<div><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.max_voxels+'</label><input type="number" min="1" step="1" name="v_dicom_seg_types['+idx+'][max_voxels]" class="small-text" style="width:100%" /></div>'
							+'<div><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.max_triangles+'</label><input type="number" min="1" step="1" name="v_dicom_seg_types['+idx+'][max_triangles]" class="small-text" style="width:100%" /></div>'
							+'<div><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.cost+'</label><input type="number" min="0" step="1" name="v_dicom_seg_types['+idx+'][cost]" value="1" class="small-text" style="width:100%" /></div>'
							+'<div style="text-align:center"><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.enabled+'</label><input type="checkbox" name="v_dicom_seg_types['+idx+'][enabled]" value="1" checked /></div>'
							+'<div style="text-align:center"><label style="font-weight:600;display:block;margin-bottom:4px;">'+vdSegLabels.delete+'</label><input type="checkbox" name="v_dicom_seg_types['+idx+'][_delete]" value="1" /></div>'
							+'</div>'
							+'<div style="margin-top:14px;"><label style="font-weight:600;display:block;margin-bottom:6px;">'+vdSegLabels.description+'</label><textarea name="v_dicom_seg_types['+idx+'][description]" rows="6" class="large-text" style="width:100%" placeholder="'+vdSegLabels.description_hint+'"></textarea><p class="description">'+vdSegLabels.description_help+'</p></div>';
						wrap.appendChild(div);
						div.scrollIntoView({behavior:'smooth', block:'center'});
					});
				})();
				</script>
			<?php endif; ?>

			<?php
			$uid = get_current_user_id();
			// Remove planos vencidos antes de exibir; se algo venceu agora,
			// o excedente é removido (cenas mais antigas primeiro).
			if ( V_Dicom_Storage::prune_expired_plans( $uid ) ) {
				V_Dicom_Storage::enforce_quota( $uid );
			}
			$limit   = V_Dicom_Storage::user_limit_bytes( $uid );
			$used    = V_Dicom_Storage::used_bytes( $uid );
			$avail   = 0 === $limit ? 0 : max( 0, $limit - $used );
			$pct     = $limit > 0 ? (int) round( 100 * $used / $limit ) : 100;
			$credits = V_Dicom_Storage::user_credit( $uid );
			?>
			<h2><?php esc_html_e( 'Meu armazenamento', 'v-dicom' ); ?></h2>
			<p>
				<strong><?php esc_html_e( 'Créditos de processamento:', 'v-dicom' ); ?></strong>
				<span style="font-size:1.4em;font-weight:700;color:<?php echo $credits > 0 ? '#2271b1' : '#8c8f94'; ?>;">
					<?php echo (int) $credits; ?>
				</span>
				<span class="description"><?php esc_html_e( '(usados para segmentação automática)', 'v-dicom' ); ?></span>
			</p>
			<?php do_action( 'v_dicom_admin_storage_extra', $uid ); ?>

			<?php $my_plans = V_Dicom_Storage::user_plans( $uid ); ?>
			<?php if ( $my_plans ) : ?>
				<h3 style="margin-top:18px;"><?php esc_html_e( 'Meus planos de armazenamento', 'v-dicom' ); ?></h3>
				<table class="widefat striped" style="max-width:640px;">
					<thead>
						<tr>
							<th style="width:140px"><?php esc_html_e( 'Espaço', 'v-dicom' ); ?></th>
							<th style="width:110px"><?php esc_html_e( 'Duração', 'v-dicom' ); ?></th>
							<th><?php esc_html_e( 'Contratado em', 'v-dicom' ); ?></th>
							<th><?php esc_html_e( 'Expira em', 'v-dicom' ); ?></th>
							<th style="width:120px"><?php esc_html_e( 'Situação', 'v-dicom' ); ?></th>
						</tr>
					</thead>
					<tbody>
					<?php foreach ( $my_plans as $plan ) :
						if ( ! is_array( $plan ) || empty( $plan['expires_at'] ) ) {
							continue;
						}
						$expires = (int) $plan['expires_at'];
						$granted = (int) $plan['granted_at'];
						$active  = $expires > time();
						$days    = $active ? (int) ceil( ( $expires - time() ) / DAY_IN_SECONDS ) : 0;
						?>
						<tr>
							<td><strong><?php echo esc_html( number_format_i18n( (int) $plan['mb'] ) . ' MB' ); ?></strong></td>
							<td>
								<?php
								echo esc_html(
									sprintf(
										/* translators: %d: number of months */
										_n( '%d mês', '%d meses', (int) $plan['months'], 'v-dicom' ),
										(int) $plan['months']
									)
								);
								?>
							</td>
							<td><?php echo esc_html( date_i18n( get_option( 'date_format' ), $granted ) ); ?></td>
							<td><?php echo esc_html( date_i18n( get_option( 'date_format' ), $expires ) ); ?></td>
							<td>
								<?php if ( $active ) : ?>
									<span style="color:#00a32a;font-weight:600;"><?php esc_html_e( 'Ativo', 'v-dicom' ); ?></span>
									<span class="description">
										<?php
										echo esc_html(
											sprintf(
												/* translators: %d: days remaining */
												_n( '%d dia restante', '%d dias restantes', $days, 'v-dicom' ),
												$days
											)
										);
										?>
									</span>
								<?php else : ?>
									<span style="color:#8c8f94;"><?php esc_html_e( 'Expirado', 'v-dicom' ); ?></span>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>

			<?php if ( 0 === $limit ) : ?>
				<div class="notice notice-warning"><p><?php esc_html_e( 'Você não tem armazenamento disponível. Contrate um plano ou peça ao administrador para definir um limite antes de enviar estudos.', 'v-dicom' ); ?></p></div>
			<?php else : ?>
				<p>
					<?php
					echo esc_html(
						sprintf(
							/* translators: 1: used space 2: total limit 3: available space */
							__( 'Usado: %1$s de %2$s (%3$s disponíveis).', 'v-dicom' ),
							self::format_bytes( $used ),
							self::format_bytes( $limit ),
							self::format_bytes( $avail )
						)
					);
					?>
				</p>
				<div style="max-width:480px;height:14px;border-radius:7px;overflow:hidden;background:#dcdcde;">
					<div style="height:100%;background:#2271b1;width:<?php echo esc_attr( max( 1, min( 100, $pct ) ) ); ?>%;"></div>
				</div>
			<?php endif; ?>

			<?php if ( current_user_can( 'edit_users' ) ) : ?>
				<h2><?php esc_html_e( 'Cotas para novas contas', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['newusersaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Cotas para novas contas atualizadas.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_newuser_defaults" />
					<?php wp_nonce_field( 'v_dicom_newuser_defaults' ); ?>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="v-dicom-default-storage-mb"><?php esc_html_e( 'Armazenamento inicial (MB)', 'v-dicom' ); ?></label></th>
							<td><input type="number" min="0" step="1" id="v-dicom-default-storage-mb" name="v_dicom_default_storage_mb" value="<?php echo (int) V_Dicom_Storage::default_new_user_storage_mb(); ?>" class="small-text" /></td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-default-credit"><?php esc_html_e( 'Créditos iniciais', 'v-dicom' ); ?></label></th>
							<td><input type="number" min="0" step="1" id="v-dicom-default-credit" name="v_dicom_default_credit" value="<?php echo (int) V_Dicom_Storage::default_new_user_credit(); ?>" class="small-text" /></td>
						</tr>
					</table>
					<p class="description"><?php esc_html_e( 'Aplicado automaticamente quando uma nova conta é criada (ou na primeira sessão de contas ainda sem cota).', 'v-dicom' ); ?></p>
					<?php submit_button( __( 'Salvar cotas para novas contas', 'v-dicom' ) ); ?>
				</form>

				<h2><?php esc_html_e( 'Limites de armazenamento por usuário', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['limitsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Limites atualizados.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<?php
				$users_result = $this->query_quota_users( $users_search, $users_paged, self::PER_PAGE_USERS );
				$quota_users  = $users_result['users'];
				$users_total  = (int) $users_result['total'];
				$this->render_list_search( 'uq', $users_search, $scenes_args, __( 'Buscar por nome, usuário ou e-mail…', 'v-dicom' ), $users_total );
				?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_limit" />
					<?php wp_nonce_field( 'v_dicom_limits' ); ?>
					<table class="widefat striped">
						<thead>
							<tr>
								<th><?php esc_html_e( 'Usuário', 'v-dicom' ); ?></th>
								<th style="width:120px"><?php esc_html_e( 'Limite (MB)', 'v-dicom' ); ?></th>
								<th style="width:120px"><?php esc_html_e( 'Créditos', 'v-dicom' ); ?></th>
								<th><?php esc_html_e( 'Em uso agora', 'v-dicom' ); ?></th>
							</tr>
						</thead>
						<tbody>
						<?php if ( ! $quota_users ) : ?>
							<tr><td colspan="4"><?php echo esc_html( '' !== $users_search ? __( 'Nenhum usuário encontrado para a busca.', 'v-dicom' ) : __( 'Nenhum usuário com cenas ou limite definido ainda.', 'v-dicom' ) ); ?></td></tr>
						<?php endif; ?>
						<?php foreach ( $quota_users as $u ) :
							$u_limit   = V_Dicom_Storage::user_limit_bytes( (int) $u->ID );
							$u_used    = V_Dicom_Storage::used_bytes( (int) $u->ID );
							$u_credits = V_Dicom_Storage::user_credit( (int) $u->ID );
							?>
							<tr>
								<td>
									<?php echo get_avatar( $u->ID, 24 ); ?>
									<strong><?php echo esc_html( $u->display_name ); ?></strong>
									<span class="description">@<?php echo esc_html( $u->user_login ); ?></span>
								</td>
								<td>
									<input type="number" min="0" step="1" class="small-text" name="v_dicom_limit[<?php echo (int) $u->ID; ?>]"
										value="<?php echo (int) get_user_meta( (int) $u->ID, V_Dicom_Storage::META_LIMIT, true ); ?>" />
									<?php $u_plans_mb = V_Dicom_Storage::active_plans_mb( (int) $u->ID ); ?>
									<?php if ( $u_plans_mb > 0 ) : ?>
										<?php /* translators: %d: extra storage in megabytes provided by active plans */ ?>
										<span class="description"><?php echo esc_html( sprintf( __( '+ %d MB em planos', 'v-dicom' ), (int) $u_plans_mb ) ); ?></span>
									<?php endif; ?>
								</td>
								<td>
									<input type="number" min="0" step="1" class="small-text" name="v_dicom_credit[<?php echo (int) $u->ID; ?>]"
										value="<?php echo (int) $u_credits; ?>" />
								</td>
								<td>
									<?php echo esc_html( self::format_bytes( $u_used ) ); ?>
									<?php if ( $u_limit > 0 ) : ?>
										<span class="description"><?php echo esc_html__( 'de', 'v-dicom' ) . ' ' . esc_html( self::format_bytes( $u_limit ) ); ?></span>
									<?php endif; ?>
								</td>
							</tr>
						<?php endforeach; ?>
						</tbody>
					</table>
					<?php $this->render_list_pages( 'uq', 'upage', $users_search, $users_total, self::PER_PAGE_USERS, $scenes_args, $users_paged ); ?>
					<?php if ( $quota_users ) : ?>
						<p class="description"><?php esc_html_e( 'Limite 0 bloqueia novos uploads. O valor definido aqui é a cota base do usuário; planos de armazenamento ativos, quando existirem, somam-se a ele. Créditos são consumidos pela segmentação automática e pela autorização de URLs.', 'v-dicom' ); ?></p>
						<?php if ( $users_total > self::PER_PAGE_USERS ) : ?>
							<p class="description"><?php esc_html_e( 'Somente os usuários desta página são salvos.', 'v-dicom' ); ?></p>
						<?php endif; ?>
						<?php submit_button( __( 'Salvar limites e créditos', 'v-dicom' ) ); ?>
					<?php endif; ?>
				</form>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Cenas salvas', 'v-dicom' ); ?></h2>
			<?php $this->render_list_search( 'sq', $scenes_search, $users_args, __( 'Buscar por título, chave ou dono…', 'v-dicom' ), $scenes_total ); ?>
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
					<tr><td colspan="7"><?php echo esc_html( '' !== $scenes_search ? __( 'Nenhuma cena encontrada para a busca.', 'v-dicom' ) : __( 'Nenhuma cena salva ainda.', 'v-dicom' ) ); ?></td></tr>
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
								<br><a href="#" onclick="var e=document.getElementById('vd-dbg-<?php echo esc_attr( $key ); ?>');e.style.display=e.style.display==='none'?'block':'none';return false;" style="font-size:11px;"><?php esc_html_e( 'Ver logs RunPod', 'v-dicom' ); ?></a>
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
							<strong><?php esc_html_e( 'Debug RunPod — por cena (admin)', 'v-dicom' ); ?></strong>
							<?php if ( $seg_started ) : ?>
								<div style="margin:8px 0;padding:8px;background:#fff;border:1px solid #ccd0d4;border-left:4px solid #2271b1;">
									<strong><?php esc_html_e( 'Início:', 'v-dicom' ); ?></strong> <?php echo esc_html( date_i18n( 'Y-m-d H:i:s', $seg_started ) ); ?>
									<?php if ( $seg_finished ) : ?> &nbsp; <strong><?php esc_html_e( 'Fim:', 'v-dicom' ); ?></strong> <?php echo esc_html( date_i18n( 'Y-m-d H:i:s', $seg_finished ) ); ?><?php else : ?> &nbsp; <em><?php esc_html_e( '(em andamento)', 'v-dicom' ); ?></em><?php endif; ?>
									&nbsp; <strong><?php esc_html_e( 'Total:', 'v-dicom' ); ?></strong> <?php echo esc_html( $seg_duration_str ); ?>
								</div>
							<?php endif; ?>
							<?php if ( $run_dbg ) : ?>
								<details open style="margin-top:10px;"><summary><strong>POST /run</strong> — <?php echo $run_time ? esc_html( date_i18n( 'Y-m-d H:i:s', (int) $run_time ) ) : ''; ?> — <code><?php echo esc_html( $run_dbg['request_url'] ?? '' ); ?></code></summary>
									<div style="margin-top:8px;"><em><?php esc_html_e( 'Input enviado:', 'v-dicom' ); ?></em><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( wp_json_encode( $run_dbg['input_sent'] ?? $run_dbg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ); ?></pre></div>
									<div><em>Request body:</em><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:260px;overflow:auto;"><?php echo esc_html( $run_dbg['request_body_json'] ?? '' ); ?></pre></div>
									<div><em>Headers:</em><pre style="white-space:pre-wrap;background:#fff;border:1px solid #ccd0d4;padding:8px;"><?php echo esc_html( wp_json_encode( $run_dbg['request_headers'] ?? array(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) ); ?></pre></div>
									<div><em><?php esc_html_e( 'Resposta RunPod:', 'v-dicom' ); ?></em> HTTP <?php echo esc_html( $run_dbg['response_code'] ?? '—' ); ?><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( $run_dbg['response_body_raw'] ?? wp_json_encode( $run_resp, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ); ?></pre></div>
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
								<details style="margin-top:10px;"><summary><strong>POST callback (RunPod → WP)</strong> — <?php echo $cb_time ? esc_html( date_i18n( 'Y-m-d H:i:s', (int) $cb_time ) ) : ''; ?> — <?php esc_html_e( 'status mapeado:', 'v-dicom' ); ?> <code><?php echo esc_html( $cb_dbg['mapped_status'] ?? '' ); ?></code></summary>
									<pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( wp_json_encode( $cb_dbg['body_params'] ?? $cb_dbg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ); ?></pre>
									<?php if ( $cb_err || $cb_out ) : ?>
										<div><em><?php esc_html_e( 'error (até 4k):', 'v-dicom' ); ?></em><pre style="white-space:pre-wrap;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:200px;overflow:auto;"><?php echo esc_html( $cb_err ); ?></pre></div>
										<div><em><?php esc_html_e( 'output (até 8k):', 'v-dicom' ); ?></em><pre style="white-space:pre-wrap;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:260px;overflow:auto;"><?php echo esc_html( $cb_out ); ?></pre></div>
									<?php endif; ?>
									<details style="margin-top:6px;"><summary>Raw body</summary><pre style="white-space:pre-wrap;word-break:break-all;background:#fff;border:1px solid #ccd0d4;padding:8px;max-height:320px;overflow:auto;"><?php echo esc_html( $cb_dbg['raw_body'] ?? '' ); ?></pre></details>
								</details>
							<?php endif; ?>
							<p class="description" style="margin-top:10px;"><?php esc_html_e( 'Logs salvos no post meta da cena. DEBUG_RUNPOD=true também inclui debug na resposta JSON de /run e /segmentation-status.', 'v-dicom' ); ?></p>
						</td>
					</tr>
					<?php endif; ?>
				<?php endforeach; ?>
				</tbody>
			</table>
			<?php $this->render_list_pages( 'sq', 'spage', $scenes_search, $scenes_total, self::PER_PAGE_SCENES, $users_args, $scenes_paged ); ?>
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

			document.querySelectorAll('.v-dicom-seg-btn').forEach(function (btn) {
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
