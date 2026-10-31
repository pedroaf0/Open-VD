<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin submenu: general settings, theme, API key.
 */
class V_Dicom_Admin_Settings {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_media' ) );
		add_action( 'admin_post_v_dicom_theme', array( $this, 'handle_theme' ) );
		add_action( 'admin_post_v_dicom_apikey', array( $this, 'handle_apikey' ) );
		add_action( 'admin_post_v_dicom_general_settings', array( $this, 'handle_general_settings' ) );
		add_action( 'admin_post_v_dicom_url_auth', array( $this, 'handle_url_auth' ) );
		add_action( 'admin_post_v_dicom_direct_dicom', array( $this, 'handle_direct_dicom' ) );
		add_action( 'admin_post_v_dicom_public_loading', array( $this, 'handle_public_loading' ) );
	}

	/** Load the media library only on the plugin screen (logo picker). */
	public function enqueue_media( $hook ) {
		if ( 'toplevel_page_v-dicom' === $hook || 'v-dicom_page_v-dicom-settings' === $hook ) {
			wp_enqueue_media();
		}
	}

	public function menu() {
		add_submenu_page(
			'v-dicom',
			__( 'Configurações', 'v-dicom' ),
			__( 'Configurações', 'v-dicom' ),
			'edit_users',
			'v-dicom-settings',
			array( $this, 'page' )
		);
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
		wp_safe_redirect( add_query_arg( 'themesaved', 1, admin_url( 'admin.php?page=v-dicom-settings' ) ) );
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
		wp_safe_redirect( add_query_arg( 'keysaved', 1, admin_url( 'admin.php?page=v-dicom-settings' ) ) );
		exit;
	}

	/** Toggle URL authorization on/off. */
	public function handle_url_auth() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_url_auth' );
		V_Dicom_Storage::set_url_auth_enabled( isset( $_POST['v_dicom_url_auth'] ) );
		wp_safe_redirect( add_query_arg( 'urlauthsaved', 1, admin_url( 'admin.php?page=v-dicom-settings' ) ) );
		exit;
	}

	/** Toggle direct DICOM loading/upload on/off. */
	public function handle_direct_dicom() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_direct_dicom' );
		V_Dicom_Storage::set_direct_dicom_enabled( isset( $_POST['v_dicom_direct_dicom'] ) );
		wp_safe_redirect( add_query_arg( 'directdicomsaved', 1, admin_url( 'admin.php?page=v-dicom-settings' ) ) );
		exit;
	}

	/** Toggle public loading of exams without login on/off. */
	public function handle_public_loading() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_public_loading' );
		V_Dicom_Storage::set_public_loading_enabled( isset( $_POST['v_dicom_public_loading'] ) );
		wp_safe_redirect( add_query_arg( 'publicloadingsaved', 1, admin_url( 'admin.php?page=v-dicom-settings' ) ) );
		exit;
	}

	/**
	 * Save general settings (URL auth, direct DICOM, public loading, recording name pattern, watermark text/position/font-size, subscription URL) in a single submission.
	 */
	public function handle_general_settings() {
		if ( ! current_user_can( 'edit_users' ) ) {
			wp_die( esc_html__( 'Permissão negada.', 'v-dicom' ) );
		}
		check_admin_referer( 'v_dicom_general_settings' );
		V_Dicom_Storage::set_url_auth_enabled( isset( $_POST['v_dicom_url_auth'] ) );
		V_Dicom_Storage::set_direct_dicom_enabled( isset( $_POST['v_dicom_direct_dicom'] ) );
		V_Dicom_Storage::set_public_loading_enabled( isset( $_POST['v_dicom_public_loading'] ) );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized in set_recording_name_pattern().
		$recording_name_pattern = isset( $_POST['v_dicom_recording_name_pattern'] ) ? wp_unslash( $_POST['v_dicom_recording_name_pattern'] ) : '';
		V_Dicom_Storage::set_recording_name_pattern( $recording_name_pattern );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized in set_watermark_text().
		$watermark_text = isset( $_POST['v_dicom_watermark_text'] ) ? wp_unslash( $_POST['v_dicom_watermark_text'] ) : '';
		V_Dicom_Storage::set_watermark_text( $watermark_text );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized in set_watermark_position().
		$watermark_position = isset( $_POST['v_dicom_watermark_position'] ) ? wp_unslash( $_POST['v_dicom_watermark_position'] ) : '';
		V_Dicom_Storage::set_watermark_position( $watermark_position );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized in set_watermark_font_size().
		$watermark_font_size = isset( $_POST['v_dicom_watermark_font_size'] ) ? wp_unslash( $_POST['v_dicom_watermark_font_size'] ) : '';
		V_Dicom_Storage::set_watermark_font_size( $watermark_font_size );
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized in set_subscription_url().
		$subscription_url = isset( $_POST['v_dicom_subscription_url'] ) ? wp_unslash( $_POST['v_dicom_subscription_url'] ) : '';
		V_Dicom_Storage::set_subscription_url( $subscription_url );
		wp_safe_redirect( add_query_arg( 'generalsaved', 1, admin_url( 'admin.php?page=v-dicom-settings' ) ) );
		exit;
	}

	public function page() {
		$viewer = v_dicom_viewer_url();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Configurações', 'v-dicom' ); ?></h1>

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

				<h2><?php esc_html_e( 'Configurações gerais', 'v-dicom' ); ?></h2>
				<?php // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin view ?>
				<?php if ( isset( $_GET['generalsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Configurações salvas.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<?php if ( isset( $_GET['urlauthsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Configuração de autorização de URL atualizada.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<?php if ( isset( $_GET['directdicomsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Configuração de carregamento de DICOM atualizada.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<?php if ( isset( $_GET['publicloadingsaved'] ) ) : ?>
					<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Configuração de carregamento público atualizada.', 'v-dicom' ); ?></p></div>
				<?php endif; ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="v_dicom_general_settings" />
					<?php wp_nonce_field( 'v_dicom_general_settings' ); ?>
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
						<tr>
							<th scope="row"><label for="v-dicom-recording-name-pattern"><?php esc_html_e( 'Padrão do nome do vídeo 3D', 'v-dicom' ); ?></label></th>
							<td>
								<input type="text" id="v-dicom-recording-name-pattern" name="v_dicom_recording_name_pattern" value="<?php echo esc_attr( V_Dicom_Storage::recording_name_pattern() ); ?>" class="regular-text code" maxlength="120" />
								<p class="description">
									<?php esc_html_e( 'Nome usado no download do vídeo gravado no viewport 3D. Use {data}, {hora} ou {timestamp} para inserir a data/hora. Se não usar nenhum marcador de data/hora, o carimbo será acrescentado automaticamente. Não inclua a extensão (.mp4 ou .webm).', 'v-dicom' ); ?>
								</p>
								<p class="description">
									<code>exame-{data}-{hora}</code> →
									<code>exame-20261022-100319.mp4</code>
								</p>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-watermark-text"><?php esc_html_e( 'Texto de marca d\'água para vídeo', 'v-dicom' ); ?></label></th>
							<td>
								<input type="text" id="v-dicom-watermark-text" name="v_dicom_watermark_text" value="<?php echo esc_attr( V_Dicom_Storage::watermark_text() ); ?>" class="regular-text" maxlength="200" placeholder="<?php esc_attr_e( 'Ex.: Clínica São Lucas - Dr. João Silva', 'v-dicom' ); ?>" />
								<p class="description">
									<?php esc_html_e( 'Texto opcional que será desenhado como marca d\'água nos vídeos gravados do viewport 3D. Deixe vazio para não adicionar marca d\'água.', 'v-dicom' ); ?>
								</p>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-watermark-position"><?php esc_html_e( 'Posição da marca d\'água', 'v-dicom' ); ?></label></th>
							<td>
								<select id="v-dicom-watermark-position" name="v_dicom_watermark_position" class="regular-text">
									<option value="center" <?php selected( V_Dicom_Storage::watermark_position(), 'center' ); ?>><?php esc_html_e( 'Centro', 'v-dicom' ); ?></option>
									<option value="tl" <?php selected( V_Dicom_Storage::watermark_position(), 'tl' ); ?>><?php esc_html_e( 'Canto superior esquerdo', 'v-dicom' ); ?></option>
									<option value="tr" <?php selected( V_Dicom_Storage::watermark_position(), 'tr' ); ?>><?php esc_html_e( 'Canto superior direito', 'v-dicom' ); ?></option>
									<option value="bl" <?php selected( V_Dicom_Storage::watermark_position(), 'bl' ); ?>><?php esc_html_e( 'Canto inferior esquerdo', 'v-dicom' ); ?></option>
									<option value="br" <?php selected( V_Dicom_Storage::watermark_position(), 'br' ); ?>><?php esc_html_e( 'Canto inferior direito', 'v-dicom' ); ?></option>
									<option value="top" <?php selected( V_Dicom_Storage::watermark_position(), 'top' ); ?>><?php esc_html_e( 'Centro superior', 'v-dicom' ); ?></option>
									<option value="bottom" <?php selected( V_Dicom_Storage::watermark_position(), 'bottom' ); ?>><?php esc_html_e( 'Centro inferior', 'v-dicom' ); ?></option>
									<option value="left" <?php selected( V_Dicom_Storage::watermark_position(), 'left' ); ?>><?php esc_html_e( 'Centro esquerdo', 'v-dicom' ); ?></option>
									<option value="right" <?php selected( V_Dicom_Storage::watermark_position(), 'right' ); ?>><?php esc_html_e( 'Centro direito', 'v-dicom' ); ?></option>
								</select>
								<p class="description">
									<?php esc_html_e( 'Posição onde a marca d\'água será desenhada no vídeo.', 'v-dicom' ); ?>
								</p>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-watermark-font-size"><?php esc_html_e( 'Tamanho da fonte da marca d\'água', 'v-dicom' ); ?></label></th>
							<td>
								<input type="number" id="v-dicom-watermark-font-size" name="v_dicom_watermark_font_size" value="<?php echo esc_attr( V_Dicom_Storage::watermark_font_size() ); ?>" class="small-text" min="8" max="72" step="1" />
								<span class="description" style="margin-left:8px;"><?php esc_html_e( 'px (base para largura de 1920px)', 'v-dicom' ); ?></span>
								<p class="description">
									<?php esc_html_e( 'Tamanho da fonte da marca d\'água. O valor é escalado proporcionalmente à resolução do vídeo.', 'v-dicom' ); ?>
								</p>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="v-dicom-subscription-url"><?php esc_html_e( 'URL para assinatura', 'v-dicom' ); ?></label></th>
							<td>
								<input type="url" id="v-dicom-subscription-url" name="v_dicom_subscription_url" value="<?php echo esc_attr( V_Dicom_Storage::subscription_url() ); ?>" class="regular-text code" placeholder="https://example.com/assinatura?callback={{callback}}" />
								<p class="description">
									<?php esc_html_e( 'URL onde o usuário fará a assinatura. Use {{callback}} como placeholder para a URL de retorno (ex.: https://meusite.com/assinatura?callback={{callback}}). O placeholder será substituído pela URL do visualizador.', 'v-dicom' ); ?>
								</p>
							</td>
						</tr>
					</table>
					<?php submit_button( __( 'Salvar configurações', 'v-dicom' ) ); ?>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}
}