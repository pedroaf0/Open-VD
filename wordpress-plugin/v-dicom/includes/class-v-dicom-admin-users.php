<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin submenu: user quotas and limits.
 */
class V_Dicom_Admin_Users {

	/** Rows per page in the users list. */
	const PER_PAGE = 20;

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_v_dicom_limit', array( $this, 'handle_limit' ) );
		add_action( 'admin_post_v_dicom_newuser_defaults', array( $this, 'handle_newuser_defaults' ) );
	}

	public function menu() {
		add_submenu_page(
			'v-dicom',
			__( 'Usuários e cotas', 'v-dicom' ),
			__( 'Usuários', 'v-dicom' ),
			'edit_users',
			'v-dicom-users',
			array( $this, 'page' )
		);
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
		$args = array_merge( array( 'page' => 'v-dicom-users' ), $args );
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
		$args = array_merge( $args, array( 'page' => 'v-dicom-users', $page_arg => '__VD_PAGE__' ) );
		$args = array_filter(
			$args,
			static function ( $v ) {
				return null !== $v && '' !== $v;
			}
		);
		return str_replace( '__VD_PAGE__', '%#%', admin_url( 'admin.php' ) . '?' . http_build_query( $args ) );
	}

	/**
	 * Renders the search box for the users list.
	 */
	private function render_list_search( $name, $search, array $keep, $placeholder, $total ) {
		?>
		<form method="get" action="<?php echo esc_url( admin_url( 'admin.php' ) ); ?>" style="margin:8px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
			<input type="hidden" name="page" value="v-dicom-users" />
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
	 * Renders the pagination links for the users list.
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
		wp_safe_redirect( add_query_arg( 'limitsaved', 1, admin_url( 'admin.php?page=v-dicom-users' ) ) );
		exit;
	}

	public function handle_newuser_defaults() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_newuser_defaults' );
		V_Dicom_Storage::set_default_new_user_credit( isset( $_POST['v_dicom_default_credit'] ) ? absint( wp_unslash( $_POST['v_dicom_default_credit'] ) ) : 0 );
		V_Dicom_Storage::set_default_new_user_storage_mb( isset( $_POST['v_dicom_default_storage_mb'] ) ? absint( wp_unslash( $_POST['v_dicom_default_storage_mb'] ) ) : 0 );
		wp_safe_redirect( add_query_arg( 'newusersaved', 1, admin_url( 'admin.php?page=v-dicom-users' ) ) );
		exit;
	}

	public function page() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$users_search = isset( $_GET['uq'] ) ? sanitize_text_field( wp_unslash( $_GET['uq'] ) ) : '';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin list filter.
		$users_paged  = isset( $_GET['upage'] ) ? max( 1, absint( wp_unslash( $_GET['upage'] ) ) ) : 1;

		$users_result = $this->query_quota_users( $users_search, $users_paged, self::PER_PAGE );
		$quota_users  = $users_result['users'];
		$users_total  = (int) $users_result['total'];

		$users_args = array(
			'uq'    => '' !== $users_search ? $users_search : null,
			'upage' => $users_paged > 1 ? $users_paged : null,
		);

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
		<div class="wrap">
			<h1><?php esc_html_e( 'Usuários e cotas', 'v-dicom' ); ?></h1>

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
				$this->render_list_search( 'uq', $users_search, array(), __( 'Buscar por nome, usuário ou e-mail…', 'v-dicom' ), $users_total );
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
					<?php $this->render_list_pages( 'uq', 'upage', $users_search, $users_total, self::PER_PAGE, array(), $users_paged ); ?>
					<?php if ( $quota_users ) : ?>
						<p class="description"><?php esc_html_e( 'Limite 0 bloqueia novos uploads. O valor definido aqui é a cota base do usuário; planos de armazenamento ativos, quando existirem, somam-se a ele. Créditos são consumidos pela segmentação automática e pela autorização de URLs.', 'v-dicom' ); ?></p>
						<?php if ( $users_total > self::PER_PAGE ) : ?>
							<p class="description"><?php esc_html_e( 'Somente os usuários desta página são salvos.', 'v-dicom' ); ?></p>
						<?php endif; ?>
						<?php submit_button( __( 'Salvar limites e créditos', 'v-dicom' ) ); ?>
					<?php endif; ?>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}
}