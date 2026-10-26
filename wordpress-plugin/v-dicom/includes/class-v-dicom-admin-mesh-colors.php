<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin submenu: mesh name -> color rules.
 */
class V_Dicom_Admin_Mesh_Colors {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_v_dicom_mesh_colors', array( $this, 'handle_mesh_colors' ) );
	}

	public function menu() {
		add_submenu_page(
			'v-dicom',
			__( 'Cores dos modelos (STL)', 'v-dicom' ),
			__( 'Cores dos modelos', 'v-dicom' ),
			'edit_users',
			'v-dicom-colors',
			array( $this, 'page' )
		);
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

	public function page() {
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
}