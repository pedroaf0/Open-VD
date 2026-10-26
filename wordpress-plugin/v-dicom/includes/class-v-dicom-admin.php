<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin orchestrator: loads all admin sub-pages and registers the top-level menu.
 */
class V_Dicom_Admin {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );

		// Instantiate sub-page handlers so their hooks are registered.
		new V_Dicom_Admin_Scenes();
		new V_Dicom_Admin_Users();
		new V_Dicom_Admin_Settings();
		new V_Dicom_Admin_Segmentation();
		new V_Dicom_Admin_Mesh_Colors();
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
	}

	public function page() {
		$viewer = v_dicom_viewer_url();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'v-dicom', 'v-dicom' ); ?></h1>

			<p>
				<?php esc_html_e( 'Bem-vindo ao painel do v-dicom. Use o menu lateral para navegar entre as seções.', 'v-dicom' ); ?>
			</p>
			<p>
				<?php esc_html_e( 'Página do visualizador:', 'v-dicom' ); ?>
				<a href="<?php echo esc_url( $viewer ); ?>" target="_blank"><?php echo esc_html( $viewer ); ?></a>
			</p>

			<h2><?php esc_html_e( 'Seções do painel', 'v-dicom' ); ?></h2>
			<ul>
				<li><a href="<?php echo esc_url( admin_url( 'admin.php?page=v-dicom-settings' ) ); ?>"><strong><?php esc_html_e( 'Configurações', 'v-dicom' ); ?></strong> — <?php esc_html_e( 'Visual (white label), API key, configurações gerais (autorização de URL, DICOM direto, carregamento público, padrão de nome de vídeo).', 'v-dicom' ); ?></a></li>
				<li><a href="<?php echo esc_url( admin_url( 'admin.php?page=v-dicom-segmentation' ) ); ?>"><strong><?php esc_html_e( 'Segmentação', 'v-dicom' ); ?></strong> — <?php esc_html_e( 'Tipos de segmentação automática (serviços serverless, endpoints, payloads, custos).', 'v-dicom' ); ?></a></li>
				<li><a href="<?php echo esc_url( admin_url( 'admin.php?page=v-dicom-colors' ) ); ?>"><strong><?php esc_html_e( 'Cores dos modelos', 'v-dicom' ); ?></strong> — <?php esc_html_e( 'Regras de cor forçada para modelos STL/PLY/OBJ por nome.', 'v-dicom' ); ?></a></li>
				<li><a href="<?php echo esc_url( admin_url( 'admin.php?page=v-dicom-users' ) ); ?>"><strong><?php esc_html_e( 'Usuários', 'v-dicom' ); ?></strong> — <?php esc_html_e( 'Cotas de armazenamento, créditos, limites por usuário e cotas padrão para novas contas.', 'v-dicom' ); ?></a></li>
				<li><a href="<?php echo esc_url( admin_url( 'admin.php?page=v-dicom-scenes' ) ); ?>"><strong><?php esc_html_e( 'Cenas', 'v-dicom' ); ?></strong> — <?php esc_html_e( 'Listagem de cenas salvas, links de compartilhamento, segmentação e exclusão.', 'v-dicom' ); ?></a></li>
			</ul>

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
							$this->format_bytes( $used ),
							$this->format_bytes( $limit ),
							$this->format_bytes( $avail )
						)
					);
					?>
				</p>
				<div style="max-width:480px;height:14px;border-radius:7px;overflow:hidden;background:#dcdcde;">
					<div style="height:100%;background:#2271b1;width:<?php echo esc_attr( max( 1, min( 100, $pct ) ) ); ?>%;"></div>
				</div>
			<?php endif; ?>
		</div>
		<?php
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
}