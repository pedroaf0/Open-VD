<?php
/**
 * Plugin Name:       v-dicom
 * Plugin URI:        https://v-dicom.online-web.app.br/
 * Description:       Visualizador DICOM/CBCT no navegador (cortes axial, coronal, sagital, reconstrução 3D e modelos STL/PLY) com upload de estudos e compartilhamento por link. Inclui reorientação multiplanar (MPR oblíquo) para alinhar os cortes ao longo eixo do dente.
 * Version:           1.109.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            v-dicom
 * License:           GPL-2.0-or-later
 * Text Domain:       v-dicom
 * Domain Path:       /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'V_DICOM_VERSION', '1.109.0' );
define( 'V_DICOM_FILE', __FILE__ );
define( 'V_DICOM_DIR', plugin_dir_path( __FILE__ ) );
define( 'V_DICOM_URL', plugin_dir_url( __FILE__ ) );
define( 'V_DICOM_CPT', 'v_dicom_scene' );

require_once V_DICOM_DIR . 'includes/class-v-dicom-storage.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-theme.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-rest.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-page.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-admin.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-admin-scenes.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-admin-users.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-admin-settings.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-admin-segmentation.php';
require_once V_DICOM_DIR . 'includes/class-v-dicom-admin-mesh-colors.php';

/**
 * Register the scene post type. Scenes are private containers: the viewer
 * always reads them through the REST API using the scene key.
 */
function v_dicom_register_post_type() {
	register_post_type(
		V_DICOM_CPT,
		array(
			'labels'          => array(
				'name'          => __( 'Cenas DICOM', 'v-dicom' ),
				'singular_name' => __( 'Cena DICOM', 'v-dicom' ),
			),
			'public'          => false,
			'show_ui'         => false,
			'supports'        => array( 'title', 'author' ),
			'capability_type' => 'post',
			'map_meta_cap'    => true,
		)
	);
}
add_action( 'init', 'v_dicom_register_post_type' );

function v_dicom_activate() {
	v_dicom_register_post_type();
	V_Dicom_Storage::ensure_upload_dir();
	$page = new V_Dicom_Page();
	$page->rewrites();
	flush_rewrite_rules();

	// Create authorized URLs table
	global $wpdb;
	$authorized_urls_table = $wpdb->prefix . "v_dicom_authorized_urls";
	$sql = "CREATE TABLE IF NOT EXISTS `$authorized_urls_table` (
		id mediumint(9) NOT NULL AUTO_INCREMENT,
		url varchar(255) NOT NULL,
		times_accessed int(11) NOT NULL DEFAULT 0,
		PRIMARY KEY (id),
		UNIQUE KEY url (url)
	)";
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta($sql);
	// Verificação horária de planos de armazenamento vencidos.
	if ( ! wp_next_scheduled( 'v_dicom_storage_expiry_check' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', 'v_dicom_storage_expiry_check' );
	}
}
register_activation_hook( __FILE__, 'v_dicom_activate' );

function v_dicom_deactivate() {
	wp_clear_scheduled_hook( 'v_dicom_storage_expiry_check' );
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'v_dicom_deactivate' );

/** Expira planos vencidos e remove o excedente de armazenamento. */
add_action( 'v_dicom_storage_expiry_check', array( 'V_Dicom_Storage', 'cron_prune_and_enforce' ) );

/** URL of the standalone viewer page. */
function v_dicom_viewer_url() {
	return V_Dicom_Page::url();
}

/** True when the current user may create scenes / upload studies. */
function v_dicom_can_upload() {
	// Any logged-in user (including subscribers) may save scenes and upload
	// files. The per-user storage quota decides how much they can store.
	return is_user_logged_in();
}

/** Estiliza a tela de login (wp-login.php) com a identidade visual do app. */
function v_dicom_login_styles() {
	$css = V_Dicom_Theme::login_css();
	if ( '' === $css ) {
		return;
	}
	// Fonte Geist alinhada ao app (texto/rótulos) e Geist Mono (dados).
	wp_enqueue_style(
		'v-dicom-login',
		'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@400;500;600&display=swap',
		array(),
		V_DICOM_VERSION
	);
	wp_add_inline_style( 'v-dicom-login', $css );
}
add_action( 'login_enqueue_scripts', 'v_dicom_login_styles' );

/**
 * Load plugin text domain.
 */
function v_dicom_load_textdomain() {
	load_plugin_textdomain(
		'v-dicom',
		false,
		dirname( plugin_basename( V_DICOM_FILE ) ) . '/languages'
	);
}
add_action( 'init', 'v_dicom_load_textdomain' );

new V_Dicom_REST();
new V_Dicom_Page();
new V_Dicom_Admin();

// Apply initial quotas to newly registered accounts. Runs on every new user
// and also lazy-backfills when the same user logs in for the first time.
add_action( 'user_register', array( 'V_Dicom_Storage', 'apply_new_user_defaults' ) );
add_action( 'wp_login', function( $user_login, $user ) {
	if ( empty( $user->ID ) ) {
		return;
	}
	V_Dicom_Storage::apply_new_user_defaults( (int) $user->ID );
}, 10, 2 );

/**
 * URL da loja/checkout usada para compra de créditos e armazenamento.
 *
 * O plugin principal não conhece o WooCommerce. Um plugin companheiro
 * (ex.: v-dicom — WooCommerce) implementa este filtro para fornecer a URL.
 * Sem companheiro, retorna string vazia e os botões de compra não aparecem.
 */
function v_dicom_shop_url() {
	return (string) apply_filters( 'v_dicom_shop_url', '' );
}


