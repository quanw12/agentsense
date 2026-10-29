// File panel (file_panel.js): workspace file tree beside the sessions of one workspace. Folders expand
// (loaded on demand), files open a viewer pane (via on_open_file; pane itself lives in terminal_grid.js),
// and files dropped anywhere over the panel are copied into the workspace root via files.copy_in.
// Classic script (no import/export). Exposes window.init_file_panel(options).
// Depends on window.hub (preload.js: files.list / files.copy_in / files.path_for_file).
(function file_panel_module() {
  'use strict';

  const DROP_FEEDBACK_MS = 4000;

  function init_file_panel(options) {
    const settings = options || {};
    if (!settings.container) throw new Error('init_file_panel: container is required');
    const workspace = settings.workspace;
    if (!workspace || !workspace.id) throw new Error('init_file_panel: workspace is required');

    const on_open_file = typeof settings.on_open_file === 'function' ? settings.on_open_file : () => {};
    const on_error = typeof settings.on_error === 'function' ? settings.on_error : () => {};

    let disposed = false;
    const branch_children = new Map(); // rel dir -> rendered wrapper element
    const children_open = {}; // rel dir -> true when expanded at least once
    let drop_timer = 0;
    let drag_depth = 0;

    const root = document.createElement('div');
    root.className = 'fp-panel';

    const header = document.createElement('div');
    header.className = 'fp-header';
    const label = document.createElement('span');
    label.className = 'fp-title';
    label.textContent = 'Files';
    const refresh = document.createElement('button');
    refresh.className = 'fp-refresh';
    refresh.type = 'button';
    refresh.title = 'Refresh';
    refresh.textContent = '⟳';
    refresh.addEventListener('click', () => {
      load_root_rebuild();
    });
    const drop_hint = document.createElement('span');
    drop_hint.className = 'fp-drop-hint';
    header.append(label, refresh, drop_hint);

    const tree = document.createElement('div');
    tree.className = 'fp-tree';
    tree.setAttribute('role', 'tree');
    tree.textContent = 'Loading…';

    const drop_overlay = document.createElement('div');
    drop_overlay.className = 'fp-dropzone';
    drop_overlay.hidden = true;
    drop_overlay.textContent = 'Release to copy files into this workspace';

    root.append(header, tree, drop_overlay);
    settings.container.appendChild(root);

    toast_drop_hint('Drop files onto the panel to copy them into the workspace root');

    // Normalizes hub.files.list entries: alphabetical, folders before files.
    function normalize_list(entries) {
      const list = Array.isArray(entries) ? entries.slice() : [];
      for (const entry of list) {
        if (!entry || typeof entry.name !== 'string') continue;
        entry.kind = entry.kind === 'dir' ? 'dir' : 'file';
      }
      list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
      });
      return list;
    }

    async function list_dir(rel_dir) {
      return window.hub.files.list(workspace.path, rel_dir || '');
    }

    // Reloads the root list and throws the whole tree away (refresh and first load).
    async function load_root_rebuild() {
      if (disposed) return;
      branch_children.clear();
      for (const key of Object.keys(children_open)) delete children_open[key];
      let entries;
      try {
        entries = await list_dir('');
      } catch (error) {
        if (disposed) return;
        tree.textContent = '';
        const note = document.createElement('div');
        note.className = 'fp-empty';
        note.textContent = `Could not read ${workspace.path}: ${error_text(error)}`;
        tree.append(note);
        return;
      }
      if (disposed) return;
      const wrapper = render_children('', normalize_list(entries));
      branch_children.set('', wrapper);
      tree.textContent = '';
      if (entries.length === 0) {
        tree.append(
          empty_note('This folder is empty (or only non-files). Drop files onto the panel to copy them in.')
        );
        return;
      }
      tree.append(wrapper);
    }

    function error_text(error) {
      const raw = error && error.message ? error.message : String(error);
      return raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '');
    }

    // Replace the rendered children of one dir (or builds them the first time). Used after expand or drop.
    function apply_children(rel_dir, list) {
      const previous = branch_children.get(rel_dir);
      const wrapper = render_children(rel_dir, list);
      branch_children.set(rel_dir, wrapper);
      if (rel_dir === '') {
        tree.replaceChildren(wrapper);
        return;
      }
      const row = tree.querySelector(`.fp-row[data-path="${css_escape(rel_dir)}"]`);
      if (!row) return;
      if (previous && previous.parentNode) previous.parentNode.replaceChild(wrapper, previous);
      else row.insertAdjacentElement('afterend', wrapper);
    }

    function empty_note(text) {
      const note = document.createElement('div');
      note.className = 'fp-empty';
      note.textContent = text;
      return note;
    }

    function toast_drop_hint(lines) {
      drop_hint.textContent = lines;
      drop_hint.title = lines;
      if (drop_timer) window.clearTimeout(drop_timer);
      drop_timer = window.setTimeout(() => {
        drop_timer = 0;
        drop_hint.textContent = '';
      }, DROP_FEEDBACK_MS);
    }

    function stop_drag_depth_reset() {
      drag_depth = 0;
      drop_overlay.hidden = true;
    }

    root.addEventListener(
      'dragenter',
      (event) => {
        if (disposed) return;
        event.preventDefault();
        drag_depth += 1;
        drop_overlay.hidden = false;
      },
      false
    );

    root.addEventListener(
      'dragover',
      (event) => {
        if (disposed) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        drop_overlay.hidden = false;
      },
      false
    );

    root.addEventListener(
      'dragleave',
      (event) => {
        if (disposed) return;
        if (event.relatedTarget && root.contains(event.relatedTarget)) return;
        drag_depth = 0;
        drop_overlay.hidden = true;
      },
      false
    );

    root.addEventListener(
      'drop',
      async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const files_list = event.dataTransfer ? Array.from(event.dataTransfer.files || []) : [];
        stop_drag_depth_reset();
        if (disposed || files_list.length === 0) return;
        await copy_in(files_list);
      },
      true
    );

    async function copy_in(files_list) {
      const sources = [];
      for (const file of files_list) {
        let path = '';
        try {
          path = String(window.hub.files.path_for_file(file) || file.path || '');
        } catch (error) {
          path = typeof file.path === 'string' ? file.path : '';
        }
        if (path) sources.push(path);
      }
      if (sources.length === 0) {
        toast_drop_hint('Could not resolve the file paths of that drop');
        return;
      }
      try {
        const results = await window.hub.files.copy_in(workspace.path, sources);
        if (disposed) return;
        const entries = Array.isArray(results) ? results : [];
        const copied = entries.filter((entry) => entry && entry.copied);
        const failed = entries.filter((entry) => entry && !entry.copied && entry.error);
        if (copied.length > 0) await load_root_rebuild();
        if (disposed) return;
        if (failed.length > 0) {
          toast_drop_hint(`Copied ${copied.length}, failed ${failed.length} (error logged)`);
          on_error(`Could not copy: ${failed.map((entry) => `${entry.path}: ${entry.error}`).join('; ')}`);
        } else {
          toast_drop_hint(`Copied ${copied.length} file${copied.length === 1 ? '' : 's'} to this workspace`);
        }
      } catch (error) {
        if (disposed) return;
        toast_drop_hint(error_text(error));
        on_error(`Could not copy files: ${error_text(error)}`);
      }
    }

    const LISTENERS_STOP = [
      ['dragenter', (event) => event.preventDefault()],
      ['dragover', (event) => event.preventDefault()],
      ['dragleave', (event) => event.preventDefault()],
      ['drop', (event) => event.preventDefault()],
    ];
    for (const [name, handler] of LISTENERS_STOP) tree.addEventListener(name, handler);

    // Renders one directory level: rows + (for folders) their loaded child wrapper after expand.
    function render_children(rel_dir, entries) {
      const wrapper = document.createElement('div');
      wrapper.className = rel_dir === '' ? 'fp-root' : 'fp-children';
      for (const entry of entries) {
        const rel_path = rel_dir ? `${rel_dir}/${entry.name}` : entry.name;
        if (entry.kind === 'dir') wrapper.append(render_dir_row(rel_path, entry.name));
        else wrapper.append(render_file_row(rel_path, entry.name, entry.size));
      }
      return wrapper;
    }

    function render_dir_row(rel_path, name) {
      const row = document.createElement('div');
      row.className = 'fp-row fp-row-dir';
      row.dataset.path = rel_path;
      row.dataset.kind = 'dir';
      row.setAttribute('role', 'treeitem');
      const caret = document.createElement('span');
      caret.className = 'fp-caret';
      caret.textContent = '▸';
      const label_el = document.createElement('span');
      label_el.className = 'fp-name';
      label_el.textContent = name;
      label_el.title = rel_path;
      row.append(caret, label_el);
      row.addEventListener('click', () => toggle_dir(rel_path, row, caret));
      return row;
    }

    function render_file_row(rel_path, name, size) {
      const row = document.createElement('div');
      row.className = 'fp-row fp-row-file';
      row.dataset.path = rel_path;
      row.dataset.kind = 'file';
      row.setAttribute('role', 'treeitem');
      const caret = document.createElement('span');
      caret.className = 'fp-caret';
      const label_el = document.createElement('span');
      label_el.className = 'fp-name';
      label_el.textContent = name;
      label_el.title = size ? `${rel_path} — ${format_size(size)}` : rel_path;
      row.append(caret, label_el);
      row.addEventListener('click', () => {
        if (disposed) return;
        on_open_file(rel_path);
      });
      return row;
    }

    function format_size(bytes) {
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return `${bytes} B`;
    }

    // Expand a folder: load its entries (once) and render them right after the row.
    async function toggle_dir(rel_path, row, caret) {
      if (disposed) return;
      const previous = branch_children.get(rel_path);
      if (previous && previous.parentNode) {
        // Collapse: keep the data but hide it (cheap), so it can pop back instantly next time.
        previous.remove();
        row.classList.remove('fp-open');
        caret.textContent = '▸';
        return;
      }
      if (children_open[rel_path] && !row.isConnected) {
        // The row was re-rendered (root refresh); re-show the already loaded children.
        apply_children_from_cache(rel_path, row);
        return;
      }
      let entries;
      try {
        entries = await list_dir(rel_path);
      } catch (error) {
        if (disposed) return;
        on_error(`Could not read folder: ${error_text(error)}`);
        return;
      }
      if (disposed) return;
      children_open[rel_path] = true;
      row.classList.add('fp-open');
      caret.textContent = '▾';
      apply_children(rel_path, normalize_list(entries));
    }

    function apply_children_from_cache(rel_path, row) {
      // Rebuild from the server-listed state (cheap re-list keeps the cache honest after collapses).
      row.classList.add('fp-open');
      const caret = row.querySelector('.fp-caret');
      if (caret) caret.textContent = '▾';
      list_dir(rel_path)
        .then((entries) => {
          if (disposed) return;
          apply_children(rel_path, normalize_list(entries));
        })
        .catch(() => {});
    }

    function css_escape(value) {
      return String(value).replace(/["\\]/g, '\\$&');
    }

    function dispose() {
      disposed = true;
      if (drop_timer) window.clearTimeout(drop_timer);
      root.remove();
    }

    load_root_rebuild();

    return {
      refresh: load_root_rebuild,
      dispose,
    };
  }

  window.init_file_panel = init_file_panel;
})();
