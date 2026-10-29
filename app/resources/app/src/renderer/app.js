// Renderer entry. Creates the workspace sidebar and the terminal grid, and switches the main area
// between the grid (#terminal_grid) and the inline launch page (#launch_host). Exactly one of them is visible.
// Wrapped in an IIFE because classic scripts share one global scope with the other renderer scripts.
(function app_module() {
  const warned_keys = new Set();
  const GRID_ID = 'terminal_grid';
  const LAUNCH_HOST_ID = 'launch_host';

  // A missing module or method is reported once; the app keeps running without that feature.
  function warn_once(key, message) {
    if (warned_keys.has(key)) return;
    warned_keys.add(key);
    console.error(message);
  }

  (function boot() {
    const xterm_loaded = typeof window.Terminal === 'function' && typeof window.FitAddon !== 'undefined';
    document.body.dataset.xterm_loaded = String(xterm_loaded);
  })();

  // The grid lives inside #main_area. #terminal_grid is its root element.
  function create_grid(callbacks) {
    if (typeof window.init_terminal_grid === 'function') {
      return window.init_terminal_grid({
        container: document.getElementById(GRID_ID),
        on_counts_change: callbacks.on_counts_change,
        on_sessions_change: callbacks.on_sessions_change,
        on_new_session_request: callbacks.on_new_session_request,
      });
    }
    warn_once('init_terminal_grid', 'terminal_grid.js does not define init_terminal_grid; the main area stays empty');
    return {
      show_workspace() {},
      forget_workspace() {},
      get_counts() {
        return {};
      },
    };
  }

  function destroy_instance(instance) {
    try {
      if (instance && typeof instance.destroy === 'function') instance.destroy();
    } catch (error) {
      console.error('launch page destroy failed:', error);
    }
  }

  async function start_app() {
    const grid_element = document.getElementById(GRID_ID);
    const launch_host = document.getElementById(LAUNCH_HOST_ID);
    // What the main area shows right now, and which workspace the grid's active view was last shown for
    // (null = the grid's empty state). A hidden grid is re-shown on reveal so its panes refit.
    let grid_visible = true;
    let grid_workspace_id = null;
    // At most one launch page: { mount_id, workspace, instance }.
    let page = null;
    let mount_serial = 0;
    // Bumped by every explicit view change, so a slower async selection decision cannot override it.
    let view_serial = 0;
    let pending_decisions = 0;
    // Workspaces whose first selection in this app run has been handled (saved sessions restored once).
    const restore_checked = new Set();
    document.body.dataset.view_settled = 'true';

    // The sidebar is created first so the grid can report into it while it starts.
    // The callbacks below only run after this function returns, so the late `const grid` is safe.
    const sidebar = window.init_sidebar({
      container: document.getElementById('sidebar'),
      on_select: (workspace) => select_workspace(workspace),
      on_remove: (workspace_id) => forget_workspace_views(workspace_id),
      on_new_session: (workspace) => show_launch_page(workspace),
      on_select_session: (workspace, terminal_id) => show_session(workspace, terminal_id),
      on_close_session: (workspace_id, terminal_id) => call_grid('close_session', [terminal_id]),
    });
    const grid = create_grid({
      on_counts_change: (counts) => sidebar.set_counts(counts),
      on_sessions_change: (sessions_by_workspace) => sidebar.set_sessions(sessions_by_workspace),
      on_new_session_request: (workspace) => show_launch_page(workspace),
    });

    // Calls a grid method if the grid module provides it; otherwise logs once and does nothing.
    function call_grid(method_name, args) {
      const method = grid[method_name];
      if (typeof method !== 'function') {
        warn_once(`grid.${method_name}`, `terminal_grid.js has no ${method_name}(); the request is ignored`);
        return undefined;
      }
      return method.apply(grid, args);
    }

    function set_grid_visible(visible) {
      grid_visible = visible;
      grid_element.hidden = !visible;
      launch_host.hidden = visible;
    }

    function grid_show(workspace) {
      grid_workspace_id = workspace ? workspace.id : null;
      call_grid('show_workspace', [workspace || null]);
    }

    function destroy_page() {
      const current = page;
      if (!current) return;
      page = null;
      destroy_instance(current.instance);
      launch_host.replaceChildren();
    }

    // Shows the grid for a workspace (null = empty state). Re-shows the grid view when it was hidden,
    // so the panes refit to the visible size.
    function reveal_grid(workspace) {
      const was_hidden = !grid_visible;
      destroy_page();
      set_grid_visible(true);
      const workspace_id = workspace ? workspace.id : null;
      if (was_hidden || grid_workspace_id !== workspace_id) grid_show(workspace);
    }

    // Shows the launch page for a workspace. Any open page is replaced, so the page is always fresh.
    function show_launch_page(workspace) {
      view_serial += 1;
      if (!workspace) {
        reveal_grid(null);
        return;
      }
      if (typeof window.mount_launch_page !== 'function') {
        warn_once('mount_launch_page', 'launch_page.js does not define mount_launch_page; the grid stays visible instead');
        reveal_grid(workspace);
        return;
      }
      destroy_page();
      set_grid_visible(false);
      if (grid_workspace_id !== workspace.id) grid_show(workspace);
      mount_page_for(workspace);
    }

    function mount_page_for(workspace) {
      mount_serial += 1;
      const mount_id = mount_serial;
      const record = { mount_id, workspace, instance: null };
      page = record;
      try {
        record.instance = window.mount_launch_page({
          container: launch_host,
          workspace,
          on_launch: (seats, options) => handle_page_launch(mount_id, seats, options),
          on_close: () => handle_page_close(mount_id),
        }) || null;
      } catch (error) {
        console.error('mount_launch_page failed:', error);
        if (page === record) {
          destroy_page();
          reveal_grid(workspace);
        }
        return;
      }
      // on_launch or on_close may have run while the page was mounting; then the page is already gone.
      if (page !== record) destroy_instance(record.instance);
    }

    // options = { use_worktree } from the launch page; the grid decides what to do with it.
    function handle_page_launch(mount_id, seats, options) {
      if (!page || page.mount_id !== mount_id) return;
      const workspace = page.workspace;
      view_serial += 1;
      reveal_grid(workspace);
      launch_into(workspace, seats, options || {});
    }

    async function launch_into(workspace, seats, options) {
      try {
        await call_grid('launch_seats', [workspace, seats, options]);
      } catch (error) {
        console.error('launch_seats failed:', error);
      }
    }

    // Recreates the saved sessions of a workspace. Resolves with how many came back (0 when none or on failure).
    async function restore_into(workspace) {
      try {
        const restored = await call_grid('restore_saved_sessions', [workspace]);
        return typeof restored === 'number' ? restored : 0;
      } catch (error) {
        console.error('restore_saved_sessions failed:', error);
        return 0;
      }
    }

    function handle_page_close(mount_id) {
      if (!page || page.mount_id !== mount_id) return;
      const workspace = page.workspace;
      view_serial += 1;
      reveal_grid(workspace);
    }

    // Number of sessions a workspace has, including terminals of it that are not attached to a view yet
    // (after a UI reload). The main process is the source of truth; the grid's own list is merged in.
    async function count_sessions(workspace_id) {
      const terminal_ids = new Set();
      if (typeof grid.list_sessions === 'function') {
        for (const session of grid.list_sessions(workspace_id)) terminal_ids.add(session.terminal_id);
      }
      try {
        const infos = await window.hub.terminals.list(workspace_id);
        for (const info of infos) terminal_ids.add(info.terminal_id);
      } catch (error) {
        console.error('terminals.list failed:', error);
      }
      return terminal_ids.size;
    }

    // A workspace was selected in the sidebar. The first selection of a workspace in this app run restores its
    // saved sessions (when it has no live terminals). Otherwise empty workspaces get the launch page, others the grid.
    async function select_workspace(workspace) {
      view_serial += 1;
      const serial = view_serial;
      if (!workspace) {
        reveal_grid(null);
        return;
      }
      const first_selection = !restore_checked.has(workspace.id);
      restore_checked.add(workspace.id);
      pending_decisions += 1;
      document.body.dataset.view_settled = 'false';
      let count = 0;
      let restored = 0;
      try {
        count = await count_sessions(workspace.id);
        if (count === 0 && first_selection) restored = await restore_into(workspace);
      } finally {
        pending_decisions -= 1;
        if (pending_decisions === 0) document.body.dataset.view_settled = 'true';
      }
      if (serial !== view_serial) return;
      if (count === 0 && restored === 0) {
        show_launch_page(workspace);
      } else {
        reveal_grid(workspace);
      }
    }

    // A session row was clicked: its workspace and the grid come first, then the pane is focused.
    function show_session(workspace, terminal_id) {
      view_serial += 1;
      reveal_grid(workspace);
      call_grid('focus_session', [terminal_id]);
    }

    // A workspace is being removed: its launch page goes away. The sidebar then selects a neighbour,
    // which decides the main area again. The grid itself forgets the workspace.
    function forget_workspace_views(workspace_id) {
      view_serial += 1;
      if (page && page.workspace.id === workspace_id) {
        destroy_page();
        set_grid_visible(true);
      }
      if (grid_workspace_id === workspace_id) grid_workspace_id = null;
      call_grid('forget_workspace', [workspace_id]);
    }

    sidebar.set_counts(grid.get_counts());
    // Test hooks: the page can be inspected from Playwright through these.
    window.__sidebar = sidebar;
    window.__grid = grid;
    window.__mount_launch_page = window.mount_launch_page;
    window.__show_launch_page = async (workspace_id) => {
      const workspaces = await window.hub.workspaces.list();
      const workspace = workspaces.find((item) => item.id === workspace_id);
      if (!workspace) return false;
      show_launch_page(workspace);
      return true;
    };

    await sidebar.refresh();
  }

  document.addEventListener('DOMContentLoaded', () => {
    start_app().catch((error) => {
      console.error('AgentSense failed to start', error);
    });
  });
})();
