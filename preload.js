// Exposes window.hub to the renderer. This is the frozen contract from SPEC.md.
// Native access happens only here, through ipcRenderer, never from the page.
const { contextBridge, ipcRenderer } = require('electron');

// Dragged files carry a DOM File object that only the preload side can resolve to an OS path.
// Electron >= 32 needs webUtils.getPathForFile; older builds keep a plain .path property.
let webUtils = null;
try {
  webUtils = require('electron').webUtils || null;
} catch (error) {
  webUtils = null;
}

// Subscribes to an ipc event channel and returns an unsubscribe function.
function subscribe_channel(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('hub', {
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    add: (folder_path) => ipcRenderer.invoke('workspaces:add', folder_path),
    remove: (workspace_id) => ipcRenderer.invoke('workspaces:remove', workspace_id),
    pick_folder: () => ipcRenderer.invoke('workspaces:pick_folder'),
  },
  terminals: {
    create: (opts) => ipcRenderer.invoke('terminals:create', opts),
    write: (terminal_id, data) => ipcRenderer.send('terminals:write', terminal_id, data),
    resize: (terminal_id, cols, rows) => ipcRenderer.send('terminals:resize', terminal_id, cols, rows),
    kill: (terminal_id) => ipcRenderer.invoke('terminals:kill', terminal_id),
    close: (terminal_id, options) => ipcRenderer.invoke('terminals:close', terminal_id, options || {}),
    list: (workspace_id) => ipcRenderer.invoke('terminals:list', workspace_id),
    on_data: (callback) => subscribe_channel('terminals:data', callback),
    on_exit: (callback) => subscribe_channel('terminals:exit', callback),
    on_status: (callback) => subscribe_channel('terminals:status', callback),
    // Panes created or closed by the phone (mobile_server.js -> ipc_mobile.js broadcast).
    on_created: (callback) => subscribe_channel('terminals:created', callback),
    on_closed: (callback) => subscribe_channel('terminals:closed', callback),
    get_status: () => ipcRenderer.invoke('terminals:get_status'),
  },
  sessions: {
    list_saved: (workspace_id) => ipcRenderer.invoke('sessions:list_saved', workspace_id),
    discard: (record_id) => ipcRenderer.invoke('sessions:discard', record_id),
    note_error: (record_id, message) => ipcRenderer.invoke('sessions:note_error', record_id, message),
  },
  git: {
    is_repo: (folder_path) => ipcRenderer.invoke('git:is_repo', folder_path),
  },
  agents: {
    check: (commands) => ipcRenderer.invoke('agents:check', commands),
  },
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (preset) => ipcRenderer.invoke('presets:save', preset),
    remove: (preset_id) => ipcRenderer.invoke('presets:remove', preset_id),
  },
  clipboard: {
    read_text: () => ipcRenderer.invoke('clipboard:read_text'),
    write_text: (text) => ipcRenderer.invoke('clipboard:write_text', text),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    save: (provider) => ipcRenderer.invoke('providers:save', provider),
    remove: (provider_id) => ipcRenderer.invoke('providers:remove', provider_id),
  },
  files: {
    list: (root_path, rel) => ipcRenderer.invoke('files:list', root_path, rel),
    read: (root_path, rel) => ipcRenderer.invoke('files:read', root_path, rel),
    render_document: (root_path, rel) => ipcRenderer.invoke('files:render_document', root_path, rel),
    open_external: (root_path, rel) => ipcRenderer.invoke('files:open_external', root_path, rel),
    reveal: (root_path, rel) => ipcRenderer.invoke('files:reveal', root_path, rel),
    copy_in: (root_path, sources) => ipcRenderer.invoke('files:copy_in', root_path, sources),
    cancel_copy: (job_id) => ipcRenderer.invoke('files:cancel_copy', job_id),
    import_mapped: (root_path, source_path, rel) => ipcRenderer.invoke('files:import_mapped', root_path, source_path, rel),
    write: (root_path, rel, content, expected_mtime) => ipcRenderer.invoke('files:write', root_path, rel, content, expected_mtime),
    search: (root_path, query) => ipcRenderer.invoke('files:search', root_path, query),
    watch: (root_path) => ipcRenderer.invoke('files:watch', root_path),
    unwatch: (root_path) => ipcRenderer.invoke('files:unwatch', root_path),
    on_changed: (callback) => subscribe_channel('files:changed', callback),
    path_for_file: (file) => {
      try {
        if (webUtils && typeof webUtils.getPathForFile === 'function') return webUtils.getPathForFile(file) || '';
      } catch (error) {
        return '';
      }
      return typeof file === 'object' && file ? file.path || '' : '';
    },
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  mobile: {
    get_state: () => ipcRenderer.invoke('mobile:get_state'),
    set_enabled: (enabled) => ipcRenderer.invoke('mobile:set_enabled', enabled),
    set_bind_all: (bind_all) => ipcRenderer.invoke('mobile:set_bind_all', bind_all),
    set_keep_awake: (keep_awake) => ipcRenderer.invoke('mobile:set_keep_awake', keep_awake),
    rotate_token: () => ipcRenderer.invoke('mobile:rotate_token'),
  },
});
