/**
 * Starter content. This is the single source of truth for the "Create tabs &
 * seed" action, so edit here (not in the Sheet) and re-seed to redistribute.
 * IDs are hardcoded on purpose: Progress rows key off Checklist item ids, so
 * changing one orphans every tally that referenced it.
 */

const snip = (id, title, language, category, description, code, tags) => ({
  id,
  title,
  language,
  category,
  description,
  code,
  tags
});

export const DEFAULT_SNIPPETS = [
  snip(
    'snip_enqueue_assets',
    'Enqueue assets with filemtime version',
    'php',
    'Enqueue / Assets',
    'Cache-bust styles and scripts using the file modification time instead of a hand-bumped version string.',
    `/**
 * Add to a theme's functions.php or a plugin bootstrap.
 */
function devpad_enqueue_assets() {
    $dir = get_template_directory();
    $uri = get_template_directory_uri();

    wp_enqueue_style(
        'theme-main',
        $uri . '/assets/css/main.css',
        [],
        file_exists($dir . '/assets/css/main.css') ? filemtime($dir . '/assets/css/main.css') : null
    );

    wp_enqueue_script(
        'theme-main',
        $uri . '/assets/js/main.js',
        [],
        file_exists($dir . '/assets/js/main.js') ? filemtime($dir . '/assets/js/main.js') : null,
        true
    );
}
add_action('wp_enqueue_scripts', 'devpad_enqueue_assets');`,
    ['assets', 'performance', 'caching']
  ),
  snip(
    'snip_localize_data',
    'Pass PHP data to JavaScript',
    'php',
    'Enqueue / Assets',
    'wp_localize_script is the safe way to hand config, nonces and translated strings to a script.',
    `wp_enqueue_script('theme-main', $uri . '/assets/js/main.js', [], $ver, true);

wp_localize_script('theme-main', 'DevPadData', [
    'ajaxUrl'  => admin_url('admin-ajax.php'),
    'restUrl'  => esc_url_raw(rest_url('devpad/v1/')),
    'nonce'    => wp_create_nonce('wp_rest'),
    'locale'   => get_locale(),
    'isEditor' => current_user_can('edit_posts'),
]);`,
    ['localize', 'nonce', 'rest']
  ),
  snip(
    'snip_rest_route',
    'Register a REST route',
    'php',
    'REST / AJAX',
    'Add a namespaced REST endpoint with a permission callback.',
    `add_action('rest_api_init', function () {
    register_rest_route('devpad/v1', '/items', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'devpad_get_items',
        'permission_callback' => function () {
            return current_user_can('edit_posts');
        },
    ]);
});

function devpad_get_items(WP_REST_Request $request) {
    $args = [
        'post_type'      => 'post',
        'posts_per_page' => (int) $request->get_param('per_page') ?: 10,
    ];

    return new WP_REST_Response(get_posts($args), 200);
}`,
    ['rest', 'api', 'endpoint']
  ),
  snip(
    'snip_ajax_nonce',
    'Secure admin-ajax handler',
    'php',
    'Security',
    'The correct shape for an admin-ajax action: nonce check, capability check, sanitised input, JSON response.',
    `add_action('wp_ajax_devpad_save', 'devpad_ajax_save');
add_action('wp_ajax_nopriv_devpad_save', 'devpad_ajax_save');

function devpad_ajax_save() {
    check_ajax_referer('devpad_save', 'nonce');

    if (!current_user_can('edit_posts')) {
        wp_send_json_error(['message' => 'Insufficient permissions.'], 403);
    }

    $title = sanitize_text_field(wp_unslash($_POST['title'] ?? ''));

    if ($title === '') {
        wp_send_json_error(['message' => 'Title is required.'], 400);
    }

    $id = wp_insert_post([
        'post_title'  => $title,
        'post_status' => 'draft',
        'post_type'   => 'post',
    ], true);

    if (is_wp_error($id)) {
        wp_send_json_error(['message' => $id->get_error_message()], 500);
    }

    wp_send_json_success(['id' => $id]);
}`,
    ['ajax', 'nonce', 'capabilities', 'sanitize']
  ),
  snip(
    'snip_register_cpt',
    'Register a custom post type',
    'php',
    'Plugin',
    'A full CPT registration with labels, supports, rewrite and show_in_rest.',
    `add_action('init', function () {
    register_post_type('devpad_item', [
        'labels' => [
            'name'          => __('Items', 'devpad'),
            'singular_name' => __('Item', 'devpad'),
            'add_new_item'  => __('Add New Item', 'devpad'),
            'edit_item'     => __('Edit Item', 'devpad'),
        ],
        'public'        => true,
        'show_in_rest'  => true,
        'menu_icon'     => 'dashicons-admin-tools',
        'supports'      => ['title', 'editor', 'thumbnail', 'excerpt', 'revisions'],
        'has_archive'   => true,
        'rewrite'       => ['slug' => 'items'],
        'show_in_menu'  => true,
        'menu_position' => 26,
    ]);
});`,
    ['cpt', 'custom post type', 'register_post_type']
  ),
  snip(
    'snip_register_taxonomy',
    'Register a taxonomy',
    'php',
    'Plugin',
    'Hierarchical category attached to post and the devpad_item CPT.',
    `add_action('init', function () {
    register_taxonomy('devpad_topic', ['post', 'devpad_item'], [
        'labels' => [
            'name'          => __('Topics', 'devpad'),
            'singular_name' => __('Topic', 'devpad'),
        ],
        'public'            => true,
        'hierarchical'      => true,
        'show_admin_column' => true,
        'show_in_rest'      => true,
        'rewrite'           => ['slug' => 'topic'],
    ]);
});`,
    ['taxonomy', 'categories']
  ),
  snip(
    'snip_metabox_save',
    'Meta box with nonce-protected save',
    'php',
    'Security',
    'Classic meta box: render field, verify nonce + capability, sanitise value. For ACF-based builds see snip_acf_field.',
    `add_action('add_meta_boxes', function () {
    add_meta_box('devpad_meta', 'DevPad Settings', 'devpad_meta_render', 'post', 'normal', 'high');
});

function devpad_meta_render($post) {
    wp_nonce_field('devpad_meta_save', 'devpad_meta_nonce');
    $value = get_post_meta($post->ID, '_devpad_subtitle', true);
    echo '<p><label for="devpad_subtitle">Subtitle</label><br>';
    echo '<input type="text" id="devpad_subtitle" name="devpad_subtitle" class="widefat" value="'
        . esc_attr($value) . '"></p>';
});

add_action('save_post', function ($post_id, $post) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (wp_is_post_revision($post_id) || $post->post_type !== 'post') return;
    if (!isset($_POST['devpad_meta_nonce'])
        || !wp_verify_nonce(sanitize_key($_POST['devpad_meta_nonce']), 'devpad_meta_save')) return;
    if (!current_user_can('edit_post', $post_id)) return;

    $value = sanitize_text_field(wp_unslash($_POST['devpad_subtitle'] ?? ''));

    if ($value === '') {
        delete_post_meta($post_id, '_devpad_subtitle');
    } else {
        update_post_meta($post_id, '_devpad_subtitle', $value);
    }
}, 10, 2);`,
    ['meta box', 'save_post', 'nonce']
  ),
  snip(
    'snip_acf_field',
    'ACF field read with fallback',
    'php',
    'ACF / Fields',
    'Never call get_field() unguarded - it fatals when ACF is deactivated. Use the function_exists check.',
    `function devpad_field($name, $post_id = null, $fallback = '') {
    if (!function_exists('get_field')) return $fallback;

    $value = get_field($name, $post_id);

    if ($value === null || $value === false || $value === '') return $fallback;
    if (is_array($value)) return implode(', ', array_filter($value));

    return (string) $value;
}

// Usage in a template:
echo esc_html(devpad_field('subtitle', get_the_ID(), 'Untitled'));`,
    ['acf', 'get_field', 'fallback']
  ),
  snip(
    'snip_acf_flexible',
    'Loop an ACF field group safely',
    'php',
    'ACF / Fields',
    'Flexible content loop with an else fallback.',
    `if (function_exists('have_rows')) {
    while (have_rows('sections')) {
        the_row();
        $layout = get_row_layout();

        switch ($layout) {
            case 'hero':
                get_template_part('template-parts/section', 'hero');
                break;
            case 'rich_text':
                the_flexible_content();
                break;
            case 'cta':
                get_template_part('template-parts/section', 'cta', get_row_index());
                break;
        }
    }
} else {
    echo '<p>ACF not active.</p>';
}`,
    ['acf', 'flexible content', 'template']
  ),
  snip(
    'snip_wp_query',
    'WP_Query with meta filter',
    'php',
    'Query',
    'Standard custom query. Always pass wp_reset_postdata() after the loop.',
    `$query = new WP_Query([
    'post_type'      => 'post',
    'posts_per_page' => 6,
    'paged'          => max(1, get_query_var('paged')),
    'meta_query'     => [
        [
            'key'     => '_devpad_featured',
            'value'   => '1',
            'compare' => '=',
        ],
    ],
]);

if ($query->have_posts()) {
    while ($query->have_posts()) {
        $query->the_post();
        get_template_part('template-parts/card');
    }
    wp_reset_postdata();
} else {
    echo '<p>Nothing found.</p>';
}`,
    ['wp_query', 'meta_query', 'loop']
  ),
  snip(
    'snip_posts_by_meta',
    'Fast post IDs by meta key',
    'php',
    'Query',
    'get_posts is a WP_Query wrapper - for a bare list of IDs use a direct meta query.',
    `$ids = get_posts([
    'post_type'      => 'post',
    'posts_per_page' => -1,
    'fields'         => 'ids',
    'no_found_rows'  => true,
    'update_post_term_cache' => false,
    'meta_key'       => '_devpad_featured', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
    'orderby'        => 'meta_value_num',
    'order'          => 'DESC',
]);

foreach ($ids as $id) {
    echo '<li>' . esc_html(get_the_title($id)) . '</li>';
}`,
    ['get_posts', 'performance', 'meta_key']
  ),
  snip(
    'snip_pre_get_posts',
    'pre_get_posts: modify the main query',
    'php',
    'Hooks',
    'Never touch the main query in a template - do it on pre_get_posts and only where you mean to.',
    `add_action('pre_get_posts', function ($query) {
    if (is_admin() || ! $query->is_main_query()) return;
    if (! $query->is_post_type_archive('devpad_item')) return;

    $query->set('posts_per_page', 12);
    $query->set('orderby', ['title' => 'ASC']);
});`,
    ['pre_get_posts', 'query', 'archive']
  ),
  snip(
    'snip_shortcode',
    'Shortcode with attributes',
    'php',
    'Shortcode',
    'Attribute whitelisting plus escaping on output. Add the shortcode to the allowed list for blocks too.',
    `add_shortcode('devpad_button', function ($atts) {
    $atts = shortcode_atts([
        'label' => __('Read more', 'devpad'),
        'url'   => '',
        'class' => 'btn',
    ], $atts, 'devpad_button');

    if ($atts['url'] === '') return '';

    return sprintf(
        '<a class="%1$s" href="%2$s">%3$s</a>',
        esc_attr($atts['class']),
        esc_url($atts['url']),
        esc_html($atts['label'])
    );
});`,
    ['shortcode', 'esc_url', 'esc_attr']
  ),
  snip(
    'snip_cron',
    'Scheduled event: register, run, clean up',
    'php',
    'Cron',
    'Always unschedule on deactivation or the event accumulates on every activation.',
    `add_action('devpad_daily', 'devpad_do_daily');
add_action('init', function () {
    if (! wp_next_scheduled('devpad_daily')) {
        wp_schedule_event(time(), 'daily', 'devpad_daily');
    }
});

register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('devpad_daily');
});

function devpad_do_daily() {
    $count = wp_count_posts('post')->publish;
    update_option('devpad_last_run', [
        'at'    => time(),
        'posts' => $count,
    ]);
}`,
    ['cron', 'wp-cron', 'deactivation']
  ),
  snip(
    'snip_transient',
    'Transient with a stale-while-revalidate read',
    'php',
    'Database',
    'Serve the cached value immediately and refresh it after the response, so visitors never wait on the slow query.',
    `function devpad_heavy_data() {
    $cache_key = 'devpad_heavy_v1';
    $cached    = get_transient($cache_key);

    if ($cached !== false) {
        // Refresh in the background, serve the cache now.
        if (! wp_next_scheduled('devpad_refresh_' . $cache_key)) {
            wp_schedule_single_event(time() + 30, 'devpad_refresh_' . $cache_key);
        }
        return $cached;
    }

    $value = devpad_run_expensive_query();
    set_transient($cache_key, $value, 12 * HOUR_IN_SECONDS);
    return $value;
}`,
    ['transient', 'cache', 'performance']
  ),
  snip(
    'snip_options',
    'Option with a default and controlled autoload',
    'php',
    'Database',
    'get_option with a fallback; autoload only tiny values, otherwise every page load carries the weight.',
    `function devpad_setting($key, $default = '') {
    $value = get_option('devpad_' . $key, $default);
    return $value === '' ? $default : $value;
}

function devpad_update_setting($key, $value) {
    // autoload = 'no' keeps the row out of the autoloaded cache.
    return update_option('devpad_' . $key, $value, false);
}`,
    ['options', 'autoload', 'settings']
  ),
  snip(
    'snip_escape_table',
    'Escaping and sanitising cheat sheet',
    'php',
    'Security',
    'The rule: escape late, sanitise on input, always use a context-specific function.',
    `// Output
esc_html( $text );                  // in HTML text
esc_attr( $text );                  // inside an HTML attribute
esc_url( $url );                    // in href/src, blocks javascript:
esc_js( $text );                    // inside inline JS
esc_textarea( $text );              // inside <textarea>
wp_kses_post( $html );              // post content with allowed tags

// Input
sanitize_text_field( $raw );        // single line text
sanitize_textarea_field( $raw );    // multi line text
sanitize_key( $raw );               // a-z 0-9 _ -
sanitize_email( $raw );
absint( $raw );                     // positive integer
(int) $raw;`,
    ['escape', 'sanitize', 'security', 'reference']
  ),
  snip(
    'snip_safe_redirect',
    'Safe redirect helper',
    'php',
    'Security',
    'wp_safe_redirect refuses off-site hosts; use it instead of wp_redirect on anything user supplied.',
    `function devpad_redirect($url, $status = 302) {
    $target = wp_safe_redirect($url, $status);
    if (!$target) {
        $target = home_url('/');
    }
    wp_safe_redirect($target);
    exit;
}`,
    ['redirect', 'security']
  ),
  snip(
    'snip_debug_log',
    'Structured debug logging',
    'php',
    'Dev / CLI',
    'Log to a file only when WP_DEBUG is on, and strip anything sensitive before it lands on disk.',
    `function devpad_log($message, $context = []) {
    if (! defined('WP_DEBUG') || ! WP_DEBUG) return;

    $line = sprintf(
        "[%s] %s %s\\n",
        gmdate('c'),
        is_scalar($message) ? (string) $message : wp_json_encode($message),
        $context ? wp_json_encode($context) : ''
    );

    error_log($line, 3, WP_CONTENT_DIR . '/devpad.log');
}

// devpad_log('Checkout failed', ['order' => $order_id, 'gateway' => $code]);`,
    ['debug', 'logging', 'error_log']
  ),
  snip(
    'snip_wp_cli',
    'WP-CLI: common maintenance commands',
    'bash',
    'Dev / CLI',
    'Run from the WordPress root with --url= when it is not the primary site.',
    `# Search and replace across the whole install
wp search-replace 'old.example.com' 'new.example.com' --all-tables --dry-run
wp search-replace 'old.example.com' 'new.example.com' --all-tables --yes

# Users
wp user list --fields=ID,user_email,roles
wp user update admin --user_pass='Str0ng!Pass' --user_email=ops@example.com
wp role add editor_caps edit_theme_options

# Content
wp post list --post_type=page --post_status=draft --fields=ID,post_title
wp post update 123 --post_status=publish
wp db export backup.sql
wp db import backup.sql
wp cache flush
wp cron event run --due-now`,
    ['wp-cli', 'search-replace', 'maintenance']
  ),
  snip(
    'snip_sql_debug',
    'Find slow meta queries',
    'sql',
    'Database',
    'Meta queries are the usual cause of slow WordPress pages. Check coverage before blaming the server.',
    `-- Which postmeta keys are queried most, and are they indexed?
SELECT meta_key, COUNT(*) AS uses
FROM wp_postmeta
GROUP BY meta_key
ORDER BY uses DESC
LIMIT 50;

-- Posts with a specific meta value (needs an index on (meta_key, meta_value))
SELECT post_id, meta_key, meta_value
FROM wp_postmeta
WHERE meta_key = '_devpad_featured'
  AND meta_value = '1';

-- Confirm the index exists
SHOW INDEX FROM wp_postmeta;`,
    ['sql', 'performance', 'debug']
  ),
  snip(
    'snip_js_fetch_rest',
    'Fetch from a REST route with a nonce',
    'javascript',
    'REST / AJAX',
    'Always send X-WP-Nonce so cookie auth works and the server can tell it is a logged-in user.',
    `async function loadItems() {
  const res = await fetch(\`\${window.DevPadData.restUrl}items?per_page=20\`, {
    headers: {
      'X-WP-Nonce': window.DevPadData.nonce,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(\`Request failed: \${res.status}\`);
  }

  const items = await res.json();
  return items;
}

document.addEventListener('DOMContentLoaded', () => {
  loadItems()
    .then((items) => console.table(items))
    .catch((err) => console.error(err));
});`,
    ['fetch', 'rest', 'nonce', 'async']
  ),
  snip(
    'snip_css_fluid',
    'Fluid type and spacing with clamp()',
    'css',
    'Theme',
    'Scale between a min and max viewport width with no breakpoints.',
    `:root {
  --step--1: clamp(0.83rem, 0.8rem + 0.15vw, 0.9rem);
  --step-0:  clamp(1rem, 0.95rem + 0.25vw, 1.13rem);
  --step-1:  clamp(1.2rem, 1.1rem + 0.5vw, 1.5rem);
  --step-2:  clamp(1.44rem, 1.3rem + 0.7vw, 1.95rem);
  --gutter:  clamp(1rem, 0.9rem + 0.5vw, 1.5rem);
}

body {
  font-size: var(--step-0);
  line-height: 1.6;
}

.container {
  padding-inline: var(--gutter);
  max-inline-size: 75rem;
  margin-inline: auto;
}`,
    ['css', 'clamp', 'fluid', 'typography']
  ),
  snip(
    'snip_js_intersection',
    'Lazy-load behaviour with IntersectionObserver',
    'javascript',
    'Theme',
    'Cheaper than a scroll listener and it gives you the same enter/leave callbacks.',
    `const targets = document.querySelectorAll('[data-observe]');

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;

      entry.target.classList.add('is-visible');

      if (entry.target.dataset.observe === 'once') {
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

  targets.forEach((node) => io.observe(node));
} else {
  targets.forEach((node) => node.classList.add('is-visible'));
}`,
    ['javascript', 'performance', 'observer']
  )
];

const item = (id, category, text, detail) => ({ id, category, item: text, detail, order: 0 });

export const DEFAULT_CHECKLIST = [
  item('chk_pre_backup', 'Pre-Deploy', 'Database backup taken', 'Full export stored off-server and dated.'),
  item('chk_pre_files', 'Pre-Deploy', 'File backup / release snapshot', 'Deploy from a known-good commit, not a live edit.'),
  item('chk_pre_staging', 'Pre-Deploy', 'Changes tested on staging', 'Same content and same plugin versions as production.'),
  item('chk_pre_php', 'Pre-Deploy', 'No PHP notices in debug.log', 'Read the log after the full test pass, not just spot checks.'),
  item('chk_pre_console', 'Pre-Deploy', 'Browser console is clean', 'No JS errors, no 404s for assets.'),
  item('chk_pre_diff', 'Pre-Deploy', 'Change list matches the ticket', 'Anything unrequested gets removed or a new ticket is raised.'),

  item('chk_core_updates', 'WordPress Core', 'Core is on the latest supported version', 'Check the release notes for template deprecations.'),
  item('chk_core_php', 'WordPress Core', 'PHP version meets plugin requirements', 'Anything below the minimum supported version gets flagged.'),
  item('chk_core_permalinks', 'WordPress Core', 'Permalinks structure is set', 'Save Settings > Permalinks once after any URL change.'),
  item('chk_core_users', 'WordPress Core', 'Default admin account renamed', 'No "admin" username left on client sites.'),
  item('chk_core_cron', 'WordPress Core', 'WP-Cron firing (DISABLE_WP_CRON not set)', 'Confirm a system cron hits wp-cron.php on long-running sites.'),
  item('chk_core_timezone', 'WordPress Core', 'Timezone and date format correct', 'Matters for scheduling and for logs you will read later.'),

  item('chk_theme_child', 'Theme', 'Child theme used for overrides', 'Never edit a parent or vendor theme directly.'),
  item('chk_theme_functions', 'Theme', 'Custom code lives in functions.php or a small plugin', 'Anything reusable moves out of the child theme.'),
  item('chk_theme_templates', 'Theme', 'Template parts used instead of duplicated markup', 'get_template_part for cards, headers, sidebars.'),
  item('chk_theme_editor', 'Theme', 'Theme editor disabled', 'Code editing through wp-admin is an unnecessary risk.'),
  item('chk_theme_screenshot', 'Theme', 'Theme screenshot and version bumped', 'So updates are traceable in Appearance > Themes.'),
  item('chk_theme_parent_updates', 'Theme', 'Parent theme update reviewed', 'Read the changelog for hook and template changes.'),

  item('chk_plugins_used', 'Plugins', 'Unused plugins deactivated and deleted', 'Deactivate first, then delete once nothing breaks.'),
  item('chk_plugins_versions', 'Plugins', 'All plugins within support window', 'Flag anything unmaintained for the client.'),
  item('chk_plugins_patches', 'Plugins', 'Security patches applied', 'Prioritise over feature work.'),
  item('chk_plugins_conflicts', 'Plugins', 'No duplicate-function fatals', 'Check the log for "already declared" errors.'),
  item('chk_plugins_licences', 'Plugins', 'Licences recorded and in date', 'Premium plugin renewals tracked by the client.'),

  item('chk_acf_sync', 'ACF & Fields', 'ACF field groups synced to the DB', 'Requires "Local JSON" saving in every environment.'),
  item('chk_acf_required', 'ACF & Fields', 'Required fields set where the template needs them', 'Prevents blank sections in production.'),
  item('chk_acf_guards', 'ACF & Fields', 'get_field() calls guarded by function_exists', 'Pages must not fatal when ACF is deactivated.'),
  item('chk_acf_repeater', 'ACF & Fields', 'Repeater rows have an empty state in the template', 'have_rows() with an else branch.'),
  item('chk_acf_labels', 'ACF & Fields', 'Admin labels user-friendly', 'The client edits these fields.'),

  item('chk_seo_titles', 'SEO Basics', 'Title and meta description on every key page', 'Unique per page, written for the query, not the brand.'),
  item('chk_seo_canonical', 'SEO Basics', 'Canonical tags correct', 'Self-referencing except for intentional duplicates.'),
  item('chk_seo_robots', 'SEO Basics', 'No index tags left on staging', 'Site-wide: X-Robots-Tag responses checked.'),
  item('chk_seo_sitemap', 'SEO Basics', 'XML sitemap regenerating', 'Verify it after deploy, not just on install.'),
  item('chk_seo_redirects', 'SEO Basics', 'Old URLs 301 to the new location', 'Check the full redirect map, including trailing slashes.'),
  item('chk_seo_images', 'SEO Basics', 'Images have alt text', 'Descriptive, not filename dumps.'),
  item('chk_seo_schema', 'SEO Basics', 'Structured data validates', 'Google Rich Results Test on the key templates.'),

  item('chk_perf_lcp', 'Performance', 'Largest Contentful Paint under 2.5s on mobile', 'Test on the real URL with PageSpeed Insights.'),
  item('chk_perf_cls', 'Performance', 'Cumulative Layout Shift under 0.1', 'Usually image dimensions and late-loading webfonts.'),
  item('chk_perf_images', 'Performance', 'Images sized, lazy loaded, modern formats', 'Dimensions declared in markup to avoid CLS.'),
  item('chk_perf_cache', 'Performance', 'Page caching active and purged on deploy', 'Confirm the cache clears when content changes.'),
  item('chk_perf_plugins', 'Performance', 'No full-page-cache conflicts', 'Two caching plugins is the classic conflict.'),
  item('chk_perf_query', 'Performance', 'No slow queries in debug.log', 'SAVEQUERIES checked during the test pass.'),

  item('chk_sec_ssl', 'Security', 'HTTPS enforced with a valid certificate', 'Includes www and non-www both covered.'),
  item('chk_sec_hsts', 'Security', 'HSTS set if the site is fully HTTPS', 'Do not enable while subdomains are not ready.'),
  item('chk_sec_roles', 'Security', 'Roles are least-privilege', 'No editors with unfiltered_html or install_plugins.'),
  item('chk_sec_users', 'Security', 'Accounts reviewed and offboarded', 'Remove ex-contractors, reset shared logins.'),
  item('chk_sec_updates', 'Security', 'Core, theme and plugin updates applied', 'Scheduled weekly, not ad hoc.'),
  item('chk_sec_2fa', 'Security', '2FA enabled for admin accounts', 'Documented so nobody is locked out.'),
  item('chk_sec_backups', 'Security', 'Backups run and a restore is tested', 'A backup that has never been restored is a hope.'),

  item('chk_a11y_kb', 'Accessibility', 'Full page navigable by keyboard', 'Focus order follows the visual order.'),
  item('chk_a11y_contrast', 'Accessibility', 'Text contrast meets WCAG AA', '4.5:1 body, 3:1 large text and UI borders.'),
  item('chk_a11y_alt', 'Accessibility', 'Meaningful images have alt text', 'Decorative images use alt="".'),
  item('chk_a11y_forms', 'Accessibility', 'Form fields have labels', 'Placeholder is not a label.'),
  item('chk_a11y_headings', 'Accessibility', 'Heading levels do not skip', 'One h1 per page, then a sensible hierarchy.'),
  item('chk_a11y_focus', 'Accessibility', 'Focus state is visible', 'Never outline: none without a replacement.'),

  item('chk_content_copy', 'Content & Media', 'Copy proofread, not placeholder text', "Search for lorem, 'test', 'click here'." ),
  item('chk_content_links', 'Content & Media', 'Internal links resolve', 'Check for 404s, including from and to key pages.'),
  item('chk_content_404', 'Content & Media', '404 page is useful', 'Search box, links back, no dead ends.'),
  item('chk_content_media', 'Content & Media', 'Image sizes and file sizes sane', 'Nothing over ~200KB in a hero slot.'),
  item('chk_content_forms', 'Content & Media', 'Forms deliver email and are logged', 'Test the real inbox, not just the AJAX response.'),

  item('chk_live_analytics', 'Go-Live / Handover', 'Analytics and Search Console verified', 'Real traffic, not "no data".'),
  item('chk_live_tag', 'Go-Live / Handover', 'Tag manager container published', 'Check it fires on the live domain.'),
  item('chk_live_docs', 'Go-Live / Handover', 'Credentials handed over, not just shared', 'Owner list, hosting, domain registrar, CMS.'),
  item('chk_live_maintenance', 'Go-Live / Handover', 'Maintenance window and fallback agreed', 'Who rolls back, and how fast.'),
  item('chk_live_watch', 'Go-Live / Handover', '24-48h post-launch check booked', 'Errors, Core Web Vitals, form delivery.')
];

export const DEFAULT_HANDBOOK = [
  {
    id: 'hb_request_lifecycle',
    section: 'Foundations',
    title: 'How WordPress loads a request',
    content: `Everything you debug in WordPress is a consequence of load order. The short version:

1. \`wp-config.php\` - constants, DB credentials, \`ABSPATH\`, salts, \`WP_DEBUG\`.
2. \`wp-settings.php\` - loads active plugins, then \`functions.php\` of the active theme.
3. \`init\` - where you should register post types, taxonomies, taxonomies, roles, cron.
4. \`wp_loaded\` - everything is registered. Safe to read from other plugins here.
5. Template loads (\`template_redirect\`, then the template hierarchy).
6. \`wp_footer\`, then \`shutdown\`.

The practical rules:

- If a post type is "not found" on a front-end request, it was probably registered too late.
- If your code runs on some pages and not others, check whether the hook fires conditionally.
- Anything that reads from another plugin should hook \`wp_loaded\` or later.

\`\`\`php
// Too early: other plugins may not be loaded yet.
add_action( 'init', function () {
    if ( function_exists( 'get_my_plugin_option' ) ) { /* risky */ }
} );

// Safer: run at wp_loaded
add_action( 'wp_loaded', 'my_plugin_boot' );
\`\`\``
  },
  {
    id: 'hb_template_hierarchy',
    section: 'Foundations',
    title: 'Template hierarchy (memorise the order)',
    content: `WordPress picks the most specific template that exists.

**Singular** - \`single-{post_type}.php\` > \`single.php\` > \`singular.php\` > \`index.php\`

**Archive** - \`archive-{post_type}.php\` > \`taxonomy-{taxonomy}-{term}.php\` > \`taxonomy-{taxonomy}.php\` > \`taxonomy.php\` > \`archive.php\` > \`index.php\`

**404** - \`404.php\` > \`index.php\`

Useful facts:

- \`is_home()\` is the posts index, which is not "the front page" unless it is.
- \`is_front_page()\` is the page you set as the static front page.
- A 404 renders inside the site template, so it should still have header and footer.
- \`404.php\` is a template, not a hook - it cannot be filtered, only created.

\`\`\`php
// template-parts/card.php is used by the loop
get_template_part( 'template-parts/card', null, [ 'post_id' => get_the_ID() ] );
\`\`\``
  },
  {
    id: 'hb_loop',
    section: 'Foundations',
    title: 'The loop, and when it breaks',
    content: `The loop is a pair of functions over a global \`$post\`. Problems come from secondary queries.

\`\`\`php
$q = new WP_Query( $args );
while ( $q->have_posts() ) :
    $q->the_post();
    // the_post() moves the global $post to the current item
endwhile;
wp_reset_postdata(); // puts the global $post back
\`\`\`

- A secondary loop without \`wp_reset_postdata()\` breaks \`the_title()\`, \`the_permalink()\` and \`setup_postdata\` expectations after it.
- \`get_posts()\` is a \`WP_Query\` wrapper, so the same rule applies.
- Inside a secondary loop, use \`get_the_ID()\` on the query object, not \`get_the_ID()\`, if you need the outer post.
- \`query_posts()\` reuses the main query. Almost always the wrong tool.`
  },
  {
    id: 'hb_conditional_tags',
    section: 'Foundations',
    title: 'Conditional tags and template selection',
    content: `Use these in \`template-parts\` and for enqueueing.

\`\`\`php
is_front_page(); is_home(); is_singular( 'book' ); is_single( 'post' );
is_page_template( 'templates/landing.php' );
is_page( 42 ); is_attachment(); is_search(); is_404();
is_archive(); is_category(); is_tag(); is_tax(); is_author();
is_paged(); is_sticky( $post_id ); is_main_query(); is_feed();
\`\`\`

**Cache-busting template assets per template**

\`\`\`php
add_action( 'wp_enqueue_scripts', function () {
    if ( is_page_template( 'templates/landing.php' ) ) {
        wp_enqueue_style( 'landing', get_stylesheet_directory_uri() . '/assets/landing.css', [], null );
    }
} );
\`\`\`

**Enqueue in the admin only where needed**

\`\`\`php
add_action( 'admin_enqueue_scripts', function ( $hook ) {
    if ( $hook === 'post.php' ) {
        wp_enqueue_media();
    }
} );
\`\`\``
  },
  {
    id: 'hb_actions_filters',
    section: 'Hooks',
    title: 'Actions vs filters',
    content: `An **action** announces something happened. A **filter** passes a value through.

\`\`\`php
do_action( 'devpad_before_save', $post_id );          // fire
add_action( 'devpad_before_save', $cb, 10, 1 );      // listen

$value = apply_filters( 'devpad_excerpt_length', 55 ); // fire
add_filter( 'devpad_excerpt_length', function ( $n ) { return $n + 10; } );
\`\`\`

Rules of thumb:

- Never \`echo\` in an action unless the hook is explicitly a print hook.
- A filter callback must always return the value, or you break the chain.
- Name hooks with a prefix. \`devpad_*\`.
- Document the accepted args in the docblock so others can rely on them.`
  },
  {
    id: 'hb_hook_signature',
    section: 'Hooks',
    title: 'Priority and accepted args',
    content: `\`add_action( $hook, $cb, $priority, $accepted_args )\`

\`\`\`php
// Runs late so other plugins have already registered their post types.
add_action( 'init', 'devpad_register_meta', 20 );

// Listen to only the first argument of a 3-arg hook.
add_action( 'save_post', 'devpad_on_save', 10, 1 );
\`\`\`

- Lower priority runs earlier. \`0\` is as early as you should go.
- Most \`init\` work belongs at the default \`10\`; \`99\`+ is for "after everybody".
- A filter at priority 20 usually means "adjust what the theme did".`
  },
  {
    id: 'hb_removing_behaviour',
    section: 'Hooks',
    title: 'Removing or replacing core behaviour',
    content: `\`\`\`php
// Remove by exact callback reference.
remove_action( 'wp_head', 'wp_generator' );
remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_filter( 'the_content', 'wpautop' );

// Remove every callback on a hook (rarely a good idea).
remove_all_filters( 'the_excerpt' );

// Replace instead of remove: return early from your own callback.
add_filter( 'the_content', function ( $content ) {
    if ( is_singular( 'book' ) ) return $content;
    return wpautop( $content );
}, 9 );
\`\`\`

Never remove an action in a theme function that a plugin might depend on without checking who registered it:

\`\`\`php
print_r( array_keys( $GLOBALS['wp_filter']['the_content']->callbacks ) );
\`\`\``
  },
  {
    id: 'hb_child_theme',
    section: 'Hooks',
    title: 'Child theme vs plugin decision',
    content: `**Child theme** - presentational overrides tied to a specific theme. Templates, enqueues, small tweaks.

**Plugin** - behaviour, reusable across themes, or anything a client might want turned off.

**mu-plugin** - must-load plugin, no activation UI. Good for site-specific configuration.

The practical test: *if the theme changes, should this break?* If yes, it is theme code. If it should survive, it is plugin code.

\`\`\`php
// wp-content/mu-plugins/devpad-config.php - no <?php close tag
define( 'DEVPAD_SUPPORT_EMAIL', 'support@example.com' );
add_filter( 'upload_size_limit', function () { return 32 * MB_IN_BYTES; } );
\`\`\``
  },
  {
    id: 'hb_options',
    section: 'Data',
    title: 'Options API',
    content: `\`\`\`php
get_option( 'devpad_key', 'default' );
update_option( 'devpad_key', $value, false );   // third arg: autoload
add_option( 'devpad_key', $value, '', false );
delete_option( 'devpad_key' );

get_site_option( 'devpad_network_key' );       // multisite only, network wide
\`\`\`

Gotchas:

- Options are cached for the whole request. After \`update_option\`, re-read if you need the new value and it did not change.
- Autoload \`yes\` puts the row in a single cache loaded on every request. Keep those tiny.
- Never store arrays of thousands of rows in an option. That is what a custom table is for.
- \`get_option\` with a default that is an array works, but check \`is_array\` before using.`
  },
  {
    id: 'hb_transients',
    section: 'Data',
    title: 'Transients and the caching layers',
    content: `A transient is an option with an expiry, and for external-object storage sites it can be a real cache.

\`\`\`php
$value = get_transient( 'devpad_report' );
if ( false === $value ) {
    $value = expensive();
    set_transient( 'devpad_report', $value, HOUR_IN_SECONDS );
}
delete_transient( 'devpad_report' );
\`\`\`

**The caching layers in order of blast radius**

1. Browser cache - you do not control it, but you set headers.
2. CDN / page cache - serves HTML wholesale. Purge on deploy.
3. Object cache (Redis/Memcached) - \`wp_cache_*\`, per request, non-persistent unless configured.
4. Transients - option-shaped, survives requests.
5. Application cache inside your code.

The classic bug: a full-page cache serves stale HTML while transients are cleared, or you clear a transient but a page cache still shows the old value. Decide which layer owns freshness, and never mix.`
  },
  {
    id: 'hb_postmeta',
    section: 'Data',
    title: 'Post meta done right',
    content: `\`\`\`php
update_post_meta( $post_id, '_devpad_subtitle', $value );
get_post_meta( $post_id, '_devpad_subtitle', true );
delete_post_meta( $post_id, '_devpad_subtitle' );

add_post_meta( $post_id, '_devpad_tag', $term_id );      // append
add_post_meta( $post_id, '_devpad_tag', $term_id, true ); // replace, no duplicate
\`\`\`

- Prefix with \`_\` for private meta. Protected meta starts with an underscore and is skipped by the custom fields box.
- Register meta for the REST API or it will not appear in responses.

\`\`\`php
add_action( 'init', function () {
    register_post_meta( 'post', '_devpad_subtitle', [
        'type'          => 'string',
        'single'        => true,
        'show_in_rest'  => true,
        'auth_callback' => function () {
            return current_user_can( 'edit_posts' );
        },
    ] );
} );
\`\`\`

- Unregistered meta cannot be filtered, sorted or exposed via REST.`
  },
  {
    id: 'hb_cpt',
    section: 'Data',
    title: 'Custom post types and capabilities',
    content: `Register on \`init\`, and give the CPT its own capabilities so you can control access properly.

\`\`\`php
add_action( 'init', function () {
    register_post_type( 'book', [
        'public'      => true,
        'show_in_rest' => true,
        'supports'    => [ 'title', 'editor', 'thumbnail' ],
        'capability_type' => 'book',
        'map_meta_cap' => true,
        'capabilities' => [
            'edit_post'          => 'edit_book',
            'read_post'          => 'read_book',
            'delete_post'        => 'delete_book',
            'edit_posts'         => 'edit_books',
            'edit_others_posts'  => 'edit_others_books',
            'publish_posts'      => 'publish_books',
            'read_private_posts' => 'read_private_books',
            'create_posts'       => 'edit_books',
        ],
    ] );

    add_role( 'book_editor', 'Book Editor', [ 'edit_books' => true, 'publish_books' => true ] );
} );
\`\`\`

Checklist before shipping a CPT: \`has_archive\`, \`rewrite\`, \`show_in_rest\`, \`supports\`, \`menu_position\`, and whether it needs \`map_meta_cap\`.`
  },
  {
    id: 'hb_wp_query',
    section: 'Querying',
    title: 'WP_Query arguments that matter',
    content: `\`\`\`php
new WP_Query( [
    'post_type'           => 'post',
    'posts_per_page'      => 12,
    'paged'               => max( 1, get_query_var( 'paged' ) ),
    'post__not_in'        => [ 4, 8, 15 ],
    'ignore_sticky_posts' => true,
    'no_found_rows'       => true,   // skip the COUNT(*) - big win
    'orderby'             => [ 'title' => 'ASC', 'date' => 'DESC' ],
    'meta_query'          => [
        'relation' => 'AND',
        [ 'key' => '_devpad_featured', 'value' => '1', 'compare' => '=' ],
        [ 'key' => 'views', 'value' => 100, 'compare' => '>', 'type' => 'NUMERIC' ],
    ],
    'tax_query'           => [
        [ 'taxonomy' => 'category', 'field' => 'term_id', 'terms' => [ 12 ] ],
    ],
] );
\`\`\`

Performance flags:

- \`no_found_rows => true\` unless you are printing pagination.
- \`fields => 'ids'\` when you only need IDs.
- \`update_post_meta_cache\` / \`update_post_term_cache\` to \`false\` when you will not call \`get_post_meta()\`.
- \`orderby => 'rand'\` is a full table sort. Do not use it on large sites.`
  },
  {
    id: 'hb_pre_get_posts',
    section: 'Querying',
    title: 'pre_get_posts and modifying the main query',
    content: `Never modify the main query in a template. Hook \`pre_get_posts\`, guard it, and \`set()\` only what you mean to change.

\`\`\`php
add_action( 'pre_get_posts', function ( $query ) {
    if ( is_admin() || ! $query->is_main_query() ) return;
    if ( ! $query->is_archive( 'book' ) ) return;

    $query->set( 'posts_per_page', 24 );

    if ( $query->get( 'orderby' ) === '' ) {
        $query->set( 'orderby', 'title' );
    }
} );
\`\`\`

Common mistakes:

- Forgetting \`is_main_query()\` - you end up changing every secondary query too.
- Forgetting \`is_admin()\` - admin list tables change with it.
- Using \`pre_get_posts\` to change a query you create yourself. Use the \`args\` you passed.`
  },
  {
    id: 'hb_enqueue',
    section: 'Assets',
    title: 'Enqueueing styles and scripts properly',
    content: `\`\`\`php
add_action( 'wp_enqueue_scripts', function () {
    $uri = get_theme_file_uri();
    $ver = filemtime( get_theme_file_path( 'assets/app.js' ) );

    wp_enqueue_style( 'app', $uri . '/assets/app.css', [], null );
    wp_enqueue_script( 'app', $uri . '/assets/app.js', [ 'wp-i18n' ], null, true );
} );
\`\`\`

- Never \`echo\` a \`<script>\` or \`<link>\` tag. Enqueue, always.
- \`wp_enqueue_script\` before \`wp_head\` or in \`wp_enqueue_scripts\`.
- \`in_footer = true\` unless the script is needed for the initial paint or is depended on by another footer script.
- Use \`get_theme_file_uri()\` and \`get_theme_file_path()\` so child themes can override files.
- \`wp_register_script()\` + \`wp_enqueue_script()\` split it if two things share a dependency.
- Always declare dependencies. \`wp-i18n\` for \`wp.i18n\`, \`jquery\` for \`$\`.
- Declare \`style\` and \`script\` in \`wp_add_inline_script()\` rather than printing.

\`\`\`php
wp_add_inline_script( 'app', 'window.DEVPAD = ' . wp_json_encode( $data ) . ';', 'before' );
\`\`\``
  },
  {
    id: 'hb_nonces',
    section: 'Security',
    title: 'Nonces',
    content: `A nonce proves the request came from a page WordPress generated. It is **not** a CSRF token that never expires, and it is not authentication.

\`\`\`php
// Form side
wp_nonce_field( 'devpad_save', 'devpad_nonce' );

// Handler side
if ( ! isset( $_POST['devpad_nonce'] )
  || ! wp_verify_nonce( sanitize_key( $_POST['devpad_nonce'] ), 'devpad_save' ) ) {
    wp_die( 'Invalid request.', 403 );
}

// REST
wp_create_nonce( 'wp_rest' );  // sent as X-WP-Nonce
\`\`\`

Remember:

- Check the nonce **and** a capability. The capability is the actual authorisation.
- Nonces are tied to the user session, so they do not protect logged-out endpoints.
- A nonce does not replace sanitising the data that comes with it.`
  },
  {
    id: 'hb_capabilities',
    section: 'Security',
    title: 'Capabilities and authorisation',
    content: `\`\`\`php
current_user_can( 'edit_posts' );
current_user_can( 'edit_post', $post_id );
current_user_can( 'manage_options' );          // admin only
current_user_can( 'edit_theme_options' );
current_user_can( 'upload_files' );
\`\`\`

- Check the **object-level** capability, not just the generic one: \`edit_post\` with the ID.
- Meta capabilities (like \`edit_post\`) only work with \`map_meta_cap => true\` on the object type.
- \`is_admin()\` is not an authorisation check. It just means "this is a wp-admin request".
- Test roles with \`WP_User::for_blog( $blog_id )->has_cap( ... )\` in network contexts.

\`\`\`php
// Who can do this? Write it down before you write the code.
echo current_user_can( 'manage_options' ) ? esc_html( $dangerous_thing ) : '';
\`\`\``
  },
  {
    id: 'hb_escape',
    section: 'Security',
    title: 'Sanitising, validating, escaping',
    content: `Three separate jobs. Doing them in the wrong order is the whole problem.

**1. Validate** - is this the expected shape at all?
**2. Sanitise** - clean the raw input on the way in.
**3. Escape** - make the value safe for this exact output context, on the way out.

\`\`\`php
$raw   = wp_unslash( $_POST['email'] );
$email = sanitize_email( $raw );
$id    = absint( $_POST['post_id'] );

if ( ! is_email( $email ) ) { /* reject */ }

// Output - context specific
echo esc_html( get_the_title() );
echo esc_attr( get_post_meta( $id, '_x', true ) );
echo esc_url( $url );
echo esc_js( $json );
echo wp_kses_post( $html );
echo esc_textarea( $content );
\`\`\`

Also remember \`wp_unslash()\` on anything from \`$_POST\`/\`$_GET\`/\`$_REQUEST\`, and never trust \`$_SERVER['HTTP_X_FORWARDED_FOR']\` or \`REMOTE_ADDR\` without \`wp_unslash\` + validation.`
  },
  {
    id: 'hb_sql',
    section: 'Security',
    title: 'SQL and $wpdb',
    content: `\`\`\`php
global $wpdb;

// Prepared with a placeholder
$rows = $wpdb->get_results( $wpdb->prepare(
    "SELECT post_id, meta_value FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s LIMIT %d",
    $key, $value, $limit
) );

// IN clause with placeholders
$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
$sql = $wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE ID IN ($placeholders)", $ids );
\`\`\`

- \`{$wpdb->prefix}\` and \`{$wpdb->postmeta}\` are property interpolations, not user input. Never put a request value into an identifier - there is no placeholder for those.
- \`prepare()\` always, even for \`LIMIT\` and offsets.
- Escape for display separately: \`esc_html( $row->post_title )\`.
- \`$wpdb->esc_like()\` when you need \`LIKE '%term%'\`.
- On slow custom queries, add an index rather than caching around the problem.`
  },
  {
    id: 'hb_acf',
    section: 'ACF',
    title: 'ACF essentials',
    content: `\`\`\`php
if ( function_exists( 'get_field' ) ) { $v = get_field( 'subtitle' ); }

while ( have_rows( 'sections' ) ) {
    the_row();
    $layout = get_row_layout();
}

$repeater = get_field( 'items' );          // array
$first    = $repeater[0] ?? null;
$img      = get_field( 'photo' );          // array( 'url', 'alt', 'sizes' )
\`\`\`

Environment discipline:

- Turn on **ACF Local JSON** (pointing at the theme or a plugin folder) so field groups are in version control.
- "Sync changes" needs to run on deploy. Add it to your deploy script:

\`\`\`bash
wp acf import --all
\`\`\`

- Always guard \`get_field\` in themes with \`function_exists\`, or pages fatal when ACF is off.
- Render an empty state for every repeater and every group. Empty is a valid state.`
  },
  {
    id: 'hb_wpcli',
    section: 'Tooling',
    title: 'WP-CLI essentials',
    content: `\`\`\`bash
wp core version
wp core update --version=6.5.2
wp plugin list --status=inactive
wp plugin update --all
wp theme list --fields=name,status,version

wp user list --fields=ID,user_email,roles
wp user update 5 --user_pass='Str0ng!Pass'

wp post list --post_type=page --post_status=draft
wp post create --post_type=book --post_title='New' --post_status=publish
wp post delete 123 --force

wp db export backup.sql --add-drop-table
wp db import backup.sql
wp db query "SELECT COUNT(*) FROM wp_posts"

wp cache flush
wp transient delete --all
wp rewrite flush --hard
wp cron event run --due-now
wp eval 'echo esc_html( get_bloginfo( "name" ) );'
\`\`\`

Always add \`--url=https://example.com\` (or \`--path=/var/www/example.com\`) when working on multisite or a subdirectory install, otherwise WP-CLI talks to the wrong site.`
  },
  {
    id: 'hb_debugging',
    section: 'Tooling',
    title: 'A debugging routine',
    content: `Turn errors on before you start:

\`\`\`php
// wp-config.php
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );   // keep notices out of the HTML
@ini_set( 'display_errors', 0 );
\`\`\`

Order of attack:

1. \`wp-content/debug.log\` - read the last deploy's worth, not just the newest lines.
2. Browser console + network tab - JS errors and 404/500 responses.
3. \`SAVEQUERIES\` - count and time the queries on a slow page:

\`\`\`php
define( 'SAVEQUERIES', true );
\`\`\`

4. \`WP_DEBUG_DISPLAY\` on briefly to catch fatals with a stack trace.
5. Bisect - disable half the plugins, then half the theme. Fastest reliable method.

Useful constants: \`WP_CONTENT_DIR\`, \`ABSPATH\`, \`WPINC\`, \`SCRIPT_DEBUG\` (unminified core JS when debugging).`
  },
  {
    id: 'hb_deploy',
    section: 'Tooling',
    title: 'A deploy routine that does not surprise you',
    content: `\`\`\`bash
# 1. Build assets (in a git hook or CI)
npm ci
npm run build
npx terser assets/app.js -c -m -o dist/app.min.js

# 2. Sync files
rsync -avz --delete ./dist/ user@host:/var/www/example.com/dist/
rsync -avz --delete --exclude 'wp-config.php' ./ ./user@host:/var/www/example.com/

# 3. Let WordPress do its own maintenance
wp --path=/var/www/example.com core update-db
wp --path=/var/www/example.com rewrite flush
wp --path=/var/www/example.com cache flush
wp --path=/var/www/example.com transient delete --all
wp --path=/var/www/example.com acf import --all
\`\`\`

Non-negotiables:

- Never \`git pull\` on the server. Deploy a built artefact.
- \`wp-config.php\` is never in the deploy payload.
- Purge page cache after deploy or the site serves the previous release.
- Database-first deploys (a schema change) must be backwards compatible for one release.`
  }
];

export const SEED = {
  Snippets: DEFAULT_SNIPPETS,
  Checklist: DEFAULT_CHECKLIST,
  Handbook: DEFAULT_HANDBOOK
};
