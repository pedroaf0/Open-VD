<?php
/**
 * Backup and migration snippet for the segmentation types.
 *
 * This file is intentionally separate from the plugin. Run it once with
 * WP-CLI after updating the plugin, then keep the generated JSON backup in a
 * safe place.
 *
 * Usage (from the WordPress root, where wp-cli.phar lives):
 *
 *   php wp-cli.phar eval-file C:\path\to\scripts\migrate-segmentation-payload.php
 *   php wp-cli.phar eval-file C:\path\to\scripts\migrate-segmentation-payload.php dry-run
 *   php wp-cli.phar eval-file C:\path\to\scripts\migrate-segmentation-payload.php output=C:\backup.json
 *   php wp-cli.phar eval-file C:\path\to\scripts\migrate-segmentation-payload.php restore=C:\backup.json
 *
 * The plain forms are the most portable across WP-CLI versions. The script
 * also accepts --dry-run, --output=... and --restore=... when the CLI passes
 * them through to the snippet.
 *
 * What it does:
 *   1. Writes a JSON backup with the current segmentation types, the legacy
 *      option and the segmentation cost. The backup is stored in
 *      wp-content/v-dicom-segmentation-backups/ (protected by .htaccess) unless
 *      output=<path> is given.
 *   2. Converts legacy types (max_voxels/max_triangles) to the new payload
 *      template schema, filling run_url/status_url with the previous fixed
 *      paths (url/run and url/status/{{job_id}}).
 *   3. Removes the legacy option after a successful migration.
 *
 * Use restore=<file> to put the backed-up options back.
 */

if ( ! defined( 'ABSPATH' ) ) {
	fwrite( STDERR, "This snippet must run inside WordPress (wp eval-file).\n" );
	exit( 1 );
}
if ( ! class_exists( 'V_Dicom_Storage' ) ) {
	fwrite( STDERR, "The v-dicom plugin must be active before running this snippet.\n" );
	exit( 1 );
}

if ( ! function_exists( 'v_dicom_seg_migration_log' ) ) {
	function v_dicom_seg_migration_log( $message ) {
		if ( class_exists( 'WP_CLI' ) ) {
			WP_CLI::log( $message );
		} else {
			echo $message . PHP_EOL;
		}
	}
}

global $args;

// WP-CLI normally exposes positional arguments in $args, but some versions
// only leave them in the global argv array. Support both.
$seg_args = array();
if ( isset( $args ) && is_array( $args ) ) {
	$seg_args = $args;
} elseif ( ! empty( $GLOBALS['argv'] ) && is_array( $GLOBALS['argv'] ) ) {
	$seg_argv = $GLOBALS['argv'];
	$seg_eval = array_search( 'eval-file', $seg_argv, true );
	if ( false !== $seg_eval ) {
		$seg_args = array_slice( $seg_argv, $seg_eval + 2 );
	} else {
		$seg_args = array_slice( $seg_argv, 1 );
	}
}

$seg_dry_run = false;
$seg_restore = '';
$seg_output  = '';
foreach ( $seg_args as $seg_arg ) {
	$seg_arg = (string) $seg_arg;
	if ( 'dry-run' === $seg_arg || '--dry-run' === $seg_arg ) {
		$seg_dry_run = true;
	} elseif ( 0 === strpos( $seg_arg, '--restore=' ) ) {
		$seg_restore = substr( $seg_arg, 10 );
	} elseif ( 0 === strpos( $seg_arg, 'restore=' ) ) {
		$seg_restore = substr( $seg_arg, 8 );
	} elseif ( 0 === strpos( $seg_arg, '--output=' ) ) {
		$seg_output = substr( $seg_arg, 9 );
	} elseif ( 0 === strpos( $seg_arg, 'output=' ) ) {
		$seg_output = substr( $seg_arg, 7 );
	}
}

$seg_types_option  = 'v_dicom_segmentation_types';
$seg_legacy_option = 'v_dicom_runpod';
$seg_cost_option   = 'v_dicom_segmentation_cost';

/* -------------------------------------------------------------------------
 * Restore mode
 * ---------------------------------------------------------------------- */
if ( '' !== $seg_restore ) {
	if ( ! is_file( $seg_restore ) ) {
		fwrite( STDERR, "Backup file not found: {$seg_restore}\n" );
		exit( 1 );
	}
	$seg_data = json_decode( (string) file_get_contents( $seg_restore ), true );
	if ( ! is_array( $seg_data ) ) {
		fwrite( STDERR, "Invalid backup JSON: {$seg_restore}\n" );
		exit( 1 );
	}
	if ( array_key_exists( 'segmentation_types', $seg_data ) ) {
		if ( null === $seg_data['segmentation_types'] ) {
			delete_option( $seg_types_option );
		} else {
			update_option( $seg_types_option, $seg_data['segmentation_types'] );
		}
	} elseif ( isset( $seg_data[0] ) || empty( $seg_data ) ) {
		// Also accept a raw types array.
		update_option( $seg_types_option, $seg_data );
	}
	if ( array_key_exists( 'legacy_config', $seg_data ) ) {
		if ( null === $seg_data['legacy_config'] ) {
			delete_option( $seg_legacy_option );
		} else {
			update_option( $seg_legacy_option, $seg_data['legacy_config'] );
		}
	}
	if ( array_key_exists( 'segmentation_cost', $seg_data ) ) {
		if ( null === $seg_data['segmentation_cost'] ) {
			delete_option( $seg_cost_option );
		} else {
			update_option( $seg_cost_option, (int) $seg_data['segmentation_cost'] );
		}
	}
	v_dicom_seg_migration_log( "Restored options from {$seg_restore}." );
	return;
}

/* -------------------------------------------------------------------------
 * Backup
 * ---------------------------------------------------------------------- */
$seg_backup = array(
	'created_at'         => gmdate( 'c' ),
	'plugin_version'     => defined( 'V_DICOM_VERSION' ) ? V_DICOM_VERSION : '',
	'segmentation_types' => get_option( $seg_types_option, null ),
	'legacy_config'      => get_option( $seg_legacy_option, null ),
	'segmentation_cost'  => get_option( $seg_cost_option, null ),
);

if ( '' !== $seg_output ) {
	$seg_backup_file = $seg_output;
	$seg_backup_dir  = dirname( $seg_backup_file );
} else {
	$seg_backup_dir  = WP_CONTENT_DIR . '/v-dicom-segmentation-backups';
	$seg_backup_file = $seg_backup_dir . '/segmentation-backup-' . gmdate( 'Ymd-His' ) . '.json';
}
if ( ! is_dir( $seg_backup_dir ) ) {
	wp_mkdir_p( $seg_backup_dir );
}
if ( '' === $seg_output ) {
	$seg_htaccess = $seg_backup_dir . '/.htaccess';
	if ( ! file_exists( $seg_htaccess ) ) {
		file_put_contents(
			$seg_htaccess,
			"<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n\tOrder deny,allow\n\tDeny from all\n</IfModule>\n"
		);
	}
	$seg_index = $seg_backup_dir . '/index.php';
	if ( ! file_exists( $seg_index ) ) {
		file_put_contents( $seg_index, "<?php\n// Silence is golden.\n" );
	}
}
$seg_json = wp_json_encode( $seg_backup, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
if ( false === $seg_json || false === file_put_contents( $seg_backup_file, $seg_json ) ) {
	fwrite( STDERR, "Could not write the backup file: {$seg_backup_file}\n" );
	exit( 1 );
}
v_dicom_seg_migration_log( "Backup written to: {$seg_backup_file}" );

/* -------------------------------------------------------------------------
 * Migration
 * ---------------------------------------------------------------------- */
if ( $seg_dry_run ) {
	v_dicom_seg_migration_log( 'Dry run: no option will be changed.' );
}

$seg_current = get_option( $seg_types_option, null );
$seg_types   = is_array( $seg_current ) ? $seg_current : array();

// If there are no types but the old single-server option exists, create one.
if ( empty( $seg_types ) ) {
	$seg_legacy = get_option( $seg_legacy_option, null );
	if ( is_array( $seg_legacy ) && ( ! empty( $seg_legacy['url'] ) || ! empty( $seg_legacy['authorization'] ) ) ) {
		$seg_types = array(
			array(
				'id'            => 'default',
				'name'          => 'Padrão',
				'description'   => 'Tipo migrado automaticamente da configuração anterior.',
				'url'           => $seg_legacy['url'] ?? '',
				'authorization' => $seg_legacy['authorization'] ?? '',
				'max_voxels'    => $seg_legacy['max_voxels'] ?? 0,
				'max_triangles' => $seg_legacy['max_triangles'] ?? 0,
				'cost'          => (int) get_option( $seg_cost_option, 1 ),
				'enabled'       => true,
			),
		);
	}
}

if ( empty( $seg_types ) ) {
	v_dicom_seg_migration_log( 'No segmentation types to migrate.' );
	return;
}

$seg_migrated = array();
$seg_changed  = 0;
foreach ( $seg_types as $seg_item ) {
	if ( ! is_array( $seg_item ) ) {
		continue;
	}
	$seg_original = $seg_item;
	$seg_url      = esc_url_raw( trim( (string) ( $seg_item['url'] ?? '' ) ) );
	$seg_payload  = isset( $seg_item['payload'] ) ? trim( (string) $seg_item['payload'] ) : '';
	$seg_vox      = max( 0, (int) ( $seg_item['max_voxels'] ?? $seg_item['max-voxels'] ?? 0 ) );
	$seg_tri      = max( 0, (int) ( $seg_item['max_triangles'] ?? $seg_item['max-triangles'] ?? 0 ) );

	if ( '' === $seg_payload ) {
		$seg_item['payload'] = V_Dicom_Storage::default_segmentation_payload( $seg_vox, $seg_tri );
	}
	if ( empty( $seg_item['run_url'] ) && '' !== $seg_url ) {
		$seg_item['run_url'] = trailingslashit( $seg_url ) . 'run';
	}
	if ( empty( $seg_item['status_url'] ) && '' !== $seg_url ) {
		$seg_item['status_url'] = trailingslashit( $seg_url ) . 'status/{{job_id}}';
	}
	unset( $seg_item['max_voxels'], $seg_item['max_triangles'], $seg_item['max-voxels'], $seg_item['max-triangles'] );

	$seg_sanitized = V_Dicom_Storage::sanitize_segmentation_type( $seg_item );
	if ( ! $seg_sanitized ) {
		v_dicom_seg_migration_log( 'Skipped invalid type: ' . ( $seg_item['name'] ?? '(no name)' ) );
		continue;
	}
	if ( $seg_sanitized !== $seg_original ) {
		$seg_changed++;
	}
	$seg_migrated[] = $seg_sanitized;
}

v_dicom_seg_migration_log( sprintf( 'Types found: %d; converted: %d.', count( $seg_types ), count( $seg_migrated ) ) );
if ( $seg_dry_run ) {
	v_dicom_seg_migration_log( 'Dry run finished. Re-run without --dry-run to apply.' );
	return;
}

update_option( $seg_types_option, array_values( $seg_migrated ) );
// The types are now the source of truth; the old single-server option is kept
// in the backup above, so it can be removed safely.
delete_option( $seg_legacy_option );
v_dicom_seg_migration_log( 'Migration applied. The legacy option was removed (a copy is in the backup).' );
