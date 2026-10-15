<?php
/**
 * Migração "VisorDICOM" -> "v-dicom" via plugin Code Snippets.
 *
 * COMO USAR
 *  1. Code Snippets -> Add New.
 *  2. Cole TODO o conteúdo abaixo de "// --- início do snippet ---".
 *  3. Scope/condição: "Run everywhere" (o gatilho já é protegido por usuário,
 *     nonce e parâmetro na URL). Não marque "Run once".
 *  4. Salve e ative o snippet.
 *  5. Vá ao Dashboard do wp-admin. Um aviso aparece com dois links:
 *       - "Simular (dry-run)": mostra o que mudaria, sem alterar nada.
 *       - "Executar migração": aplica as mudanças (pede confirmação).
 *
 * Por que não procurar o wp-load.php? Dentro do Code Snippets o WordPress já
 * está carregado, então o snippet roda direto nos hooks do admin.
 *
 * É idempotente: rodar de novo não altera nada.
 */

// --- início do snippet ---

if ( ! function_exists( 'vdmig_replace_deep' ) ) {

	/** Substitui recursivamente um trecho em string/array/serializado. */
	function vdmig_replace_deep( $value, $search, $replace ) {
		if ( is_string( $value ) ) {
			return str_replace( $search, $replace, $value );
		}
		if ( is_array( $value ) ) {
			foreach ( $value as $k => $v ) {
				$value[ $k ] = vdmig_replace_deep( $v, $search, $replace );
			}
		}
		return $value;
	}

	/** Renomeia chaves com "visordicom" numa tabela de chaves do WP. */
	function vdmig_rename_keys( $table, $id_col, $key_col, $group_col = '', $dry = true ) {
		global $wpdb;
		$cols = "`$id_col` AS id, `$key_col` AS k" . ( $group_col ? ", `$group_col` AS g" : "" );
		$rows = $wpdb->get_results( "SELECT $cols FROM `$table` WHERE `$key_col` LIKE '%visordicom%'", ARRAY_A );

		$log     = array();
		$changed = 0;
		foreach ( $rows as $row ) {
			$old = $row['k'];
			$new = str_replace( 'visordicom', 'v_dicom', $old );
			if ( $new === $old ) {
				continue;
			}

			$where = array( $key_col => $new );
			if ( $group_col ) {
				$where[ $group_col ] = $row['g'];
			}
			$conds = array();
			$vals  = array();
			foreach ( $where as $col => $val ) {
				$conds[] = "`$col` = %s";
				$vals[]  = $val;
			}
			$sql    = "SELECT `$id_col` FROM `$table` WHERE " . implode( ' AND ', $conds ) . ' LIMIT 1';
			$exists = $wpdb->get_var( $wpdb->prepare( $sql, $vals ) );

			if ( $exists ) {
				if ( ! $dry ) {
					$wpdb->delete( $table, array( $id_col => $row['id'] ) );
				}
				$log[] = "  drop   $old (já migrado)";
			} else {
				if ( ! $dry ) {
					$wpdb->update( $table, array( $key_col => $new ), array( $id_col => $row['id'] ) );
				}
				$log[] = "  rename $old -> $new";
			}
			$changed++;
		}
		return array( $changed, $log );
	}

	/** Reescreve a base de uploads antiga nos metas (mesmo serializados). */
	function vdmig_fix_upload_urls( $dry = true ) {
		global $wpdb;
		$uploads = wp_upload_dir();
		$pairs   = array(
			array( trailingslashit( $uploads['baseurl'] ) . 'visordicom', trailingslashit( $uploads['baseurl'] ) . 'v-dicom' ),
			array( 'uploads/visordicom/', 'uploads/v-dicom/' ),
		);

		$rows = $wpdb->get_results(
			$wpdb->prepare( "SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE meta_value LIKE %s", '%visordicom%' ),
			ARRAY_A
		);

		$changed = 0;
		foreach ( $rows as $row ) {
			$value = maybe_unserialize( $row['meta_value'] );
			$fixed = $value;
			foreach ( $pairs as $pair ) {
				$fixed = vdmig_replace_deep( $fixed, $pair[0], $pair[1] );
			}
			if ( $fixed === $value ) {
				continue;
			}
			if ( ! $dry ) {
				$wpdb->update( $wpdb->postmeta, array( 'meta_value' => maybe_serialize( $fixed ) ), array( 'meta_id' => $row['meta_id'] ) );
			}
			$changed++;
		}
		return $changed;
	}

	/** Renomeia a tabela antiga de URLs autorizadas, se existir. */
	function vdmig_rename_table( $dry = true ) {
		global $wpdb;
		$old = $wpdb->prefix . 'visordicom_authorized_urls';
		$new = $wpdb->prefix . 'v_dicom_authorized_urls';

		$old_exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $old ) ) === $old;
		$new_exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $new ) ) === $new;

		if ( ! $old_exists ) {
			return array( false, '' );
		}
		if ( $new_exists ) {
			return array( false, "  tabela $new já existe (mantive $old)" );
		}
		if ( ! $dry ) {
			$wpdb->query( "RENAME TABLE `$old` TO `$new`" );
		}
		return array( true, "  rename tabela $old -> $new" );
	}

	/** Move uploads/visordicom -> uploads/v-dicom (mesclando se necessário). */
	function vdmig_move_upload_dir( $dry = true ) {
		$uploads = wp_upload_dir();
		$old_dir = trailingslashit( $uploads['basedir'] ) . 'visordicom';
		$new_dir = trailingslashit( $uploads['basedir'] ) . 'v-dicom';

		if ( ! is_dir( $old_dir ) ) {
			return array( false, '' );
		}
		if ( $dry ) {
			return array( true, "  mover pasta $old_dir -> $new_dir" );
		}
		if ( ! is_dir( $new_dir ) && @rename( $old_dir, $new_dir ) ) {
			return array( true, "  mover pasta $old_dir -> $new_dir" );
		}
		if ( ! is_dir( $new_dir ) ) {
			return array( false, "  AVISO: não foi possível mover $old_dir" );
		}
		if ( ! function_exists( 'copy_dir' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		copy_dir( $old_dir, $new_dir );
		return array( true, "  mesclar pasta $old_dir -> $new_dir" );
	}

	/** Reagenda o cron sob o novo nome. */
	function vdmig_reschedule_cron( $dry = true ) {
		$log = array();
		if ( wp_next_scheduled( 'visordicom_storage_expiry_check' ) ) {
			if ( ! $dry ) {
				wp_clear_scheduled_hook( 'visordicom_storage_expiry_check' );
			}
			$log[] = '  removido cron visordicom_storage_expiry_check';
		}
		if ( ! wp_next_scheduled( 'v_dicom_storage_expiry_check' ) ) {
			if ( ! $dry ) {
				wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', 'v_dicom_storage_expiry_check' );
			}
			$log[] = '  agendado cron v_dicom_storage_expiry_check';
		}
		return $log;
	}

	/** Roda a migração inteira e devolve o relatório em texto. */
	function vdmig_run( $dry = true ) {
		global $wpdb;
		$out   = array();
		$out[] = $dry ? 'SIMULAÇÃO (dry-run) - nada será alterado.' : 'Executando migração VisorDICOM -> v-dicom ...';
		$out[] = '';

		$out[] = 'Options:';
		list( $n, $log ) = vdmig_rename_keys( $wpdb->options, 'option_id', 'option_name', '', $dry );
		$out   = array_merge( $out, $log ? $log : array( '  nada a fazer' ) );

		$out[] = 'User meta:';
		list( $n, $log ) = vdmig_rename_keys( $wpdb->usermeta, 'umeta_id', 'meta_key', 'user_id', $dry );
		$out   = array_merge( $out, $log ? $log : array( '  nada a fazer' ) );

		$out[] = 'Post meta (chaves):';
		list( $n, $log ) = vdmig_rename_keys( $wpdb->postmeta, 'meta_id', 'meta_key', 'post_id', $dry );
		$out   = array_merge( $out, $log ? $log : array( '  nada a fazer' ) );

		$out[] = 'Post meta (URLs de upload gravadas):';
		$n     = vdmig_fix_upload_urls( $dry );
		$out[] = $n ? "  atualizadas $n linha(s)" : '  nada a fazer';

		$out[]   = 'Post type:';
		$updated = $dry
			? $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s", 'visordicom_scene' ) )
			: $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->posts} SET post_type = %s WHERE post_type = %s", 'v_dicom_scene', 'visordicom_scene' ) );
		$out[]   = $updated ? "  visordicom_scene -> v_dicom_scene ($updated post(s))" : '  nada a fazer';

		$out[] = 'GUID:';
		$guids = $dry
			? $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE guid LIKE '%visordicom_scene%'" )
			: $wpdb->query( "UPDATE {$wpdb->posts} SET guid = REPLACE(guid, 'visordicom_scene', 'v_dicom_scene') WHERE guid LIKE '%visordicom_scene%'" );
		$out[] = $guids ? "  atualizados $guids guid(s)" : '  nada a fazer';

		$out[] = 'Tabela do banco:';
		list( $changed, $msg ) = vdmig_rename_table( $dry );
		$out[] = $changed || $msg ? $msg : '  nada a fazer';

		$out[] = 'Pasta de uploads:';
		list( $changed, $msg ) = vdmig_move_upload_dir( $dry );
		$out[] = $changed || $msg ? $msg : '  nada a fazer';

		$out[] = 'Cron:';
		$cron  = vdmig_reschedule_cron( $dry );
		$out   = array_merge( $out, $cron ? $cron : array( '  nada a fazer' ) );

		$out[] = 'Nome do tema:';
		$theme = get_option( 'v_dicom_theme', null );
		if ( is_array( $theme ) && isset( $theme['name'] ) && 'VisorDICOM' === $theme['name'] ) {
			if ( ! $dry ) {
				$theme['name'] = 'v-dicom';
				update_option( 'v_dicom_theme', $theme );
			}
			$out[] = '  VisorDICOM -> v-dicom';
		} else {
			$out[] = '  nada a fazer';
		}

		if ( ! $dry ) {
			flush_rewrite_rules();
			wp_cache_flush();
		}

		$out[] = '';
		$out[] = $dry ? 'Simulação concluída.' : 'Migração concluída.';
		return implode( "\n", $out );
	}

	/** Gatilho seguro via URL: ?v_dicom_migrate=1 (&confirm=1 para executar). */
	add_action(
		'admin_init',
		function () {
			if ( empty( $_GET['v_dicom_migrate'] ) ) {
				return;
			}
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_die( 'Sem permissão.' );
			}
			check_admin_referer( 'vdmig_run' );

			$dry    = empty( $_GET['confirm'] );
			$report = vdmig_run( $dry );

			wp_die(
				'<h2>v-dicom - migração</h2><pre>' . esc_html( $report ) . '</pre>',
				'v-dicom - migração',
				array( 'response' => 200, 'back_link' => true )
			);
		}
	);

	/** Aviso no Dashboard com os links de simulação/execução. */
	add_action(
		'admin_notices',
		function () {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
			if ( ! $screen || 'dashboard' !== $screen->id ) {
				return;
			}

			$dry_url = wp_nonce_url( add_query_arg( 'v_dicom_migrate', '1', admin_url() ), 'vdmig_run' );
			$run_url = wp_nonce_url( add_query_arg( array( 'v_dicom_migrate' => '1', 'confirm' => '1' ), admin_url() ), 'vdmig_run' );

			echo '<div class="notice notice-warning"><p><strong>v-dicom:</strong> migração de dados VisorDICOM pendente? ';
			echo '<a class="button" href="' . esc_url( $dry_url ) . '">Simular (dry-run)</a> ';
			echo '<a class="button button-primary" href="' . esc_url( $run_url ) . '" onclick="return confirm(\'Executar a migração agora? Faça backup do banco antes.\');">Executar migração</a>';
			echo '</p></div>';
		}
	);
}

// --- fim do snippet ---
