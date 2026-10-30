// Git worktrees for panes that run "in their own worktree". Uses git through execFile (no shell).
// Layout: <parent of repo>\<repo name>.worktrees\<name>, branch agentsense/<name>-<base36 timestamp>.
// A worktree is removed only when it is clean and its branch has no commits beyond the base it was created from.
// Nothing here ever passes --force.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const { env_with_fresh_path } = require('./fresh_path');

const GIT_TIMEOUT_MS = 30000;
const REMOVE_ATTEMPTS = 6;
const REMOVE_RETRY_MS = 500;
const MAX_NAME_LENGTH = 60;
const MAX_SUFFIX = 50;
const WORKTREES_SUFFIX = '.worktrees';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs git with args in cwd. Resolves with trimmed stdout. Rejects with an Error that has .code and .stderr.
function run_git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: env_with_fresh_path(process.env) },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new Error((stderr || error.message || '').toString().trim() || 'git failed');
          failure.code = error.code;
          failure.stderr = (stderr || '').toString();
          return reject(failure);
        }
        return resolve(stdout.toString().trim());
      }
    );
  });
}

function first_line(text) {
  return String(text || '').split(/\r?\n/).find((line) => line.trim() !== '') || '';
}

function git_missing_error() {
  return new Error('git is not installed or not on PATH; worktrees need git');
}

// Safe folder / branch part: lowercase letters, digits, dot, dash, underscore.
function safe_name(name) {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[-.]+$/g, '');
  return cleaned || 'session';
}

function exists(file_path) {
  try {
    fs.statSync(file_path);
    return true;
  } catch (error) {
    return false;
  }
}

// True when folder_path is inside a git work tree. Never throws.
async function is_git_repo(folder_path) {
  if (typeof folder_path !== 'string' || folder_path.trim() === '') return false;
  try {
    const output = await run_git(['rev-parse', '--is-inside-work-tree'], folder_path);
    return output === 'true';
  } catch (error) {
    return false;
  }
}

async function repo_root_of(folder_path) {
  const top = await run_git(['rev-parse', '--show-toplevel'], folder_path);
  return path.normalize(top);
}

function worktrees_folder_for(repo_root) {
  return path.join(path.dirname(repo_root), `${path.basename(repo_root)}${WORKTREES_SUFFIX}`);
}

// Returns <folder>\<name>, or <folder>\<name>-2, -3 ... when that folder is already there (for example a kept
// worktree of an earlier pane with the same title).
function free_path_in(folder, name) {
  let candidate = path.join(folder, name);
  for (let index = 2; exists(candidate); index += 1) {
    if (index > MAX_SUFFIX) throw new Error(`too many worktrees named ${name} in ${folder}`);
    candidate = path.join(folder, `${name}-${index}`);
  }
  return candidate;
}

// Creates a worktree from the repo's current HEAD. Resolves with { path, branch, repo_path, base_commit }.
// Rejects with a readable Error when git is missing, the folder is not a repo, or the repo has no commits.
async function create_worktree({ repo_path, name }) {
  if (typeof repo_path !== 'string' || repo_path.trim() === '') throw new Error('repo_path is required');
  let root = null;
  try {
    root = await repo_root_of(repo_path);
  } catch (error) {
    if (error.code === 'ENOENT') throw git_missing_error();
    throw new Error(`not a git repository: ${repo_path}`);
  }

  let base_commit = null;
  try {
    base_commit = await run_git(['rev-parse', '--verify', 'HEAD'], root);
  } catch (error) {
    throw new Error('the repository has no commits yet; make a first commit before using worktrees');
  }

  const safe = safe_name(name);
  const folder = worktrees_folder_for(root);
  fs.mkdirSync(folder, { recursive: true });
  const target = free_path_in(folder, safe);
  const branch = `agentsense/${safe}-${Date.now().toString(36)}`;

  try {
    await run_git(['worktree', 'add', '-b', branch, target, 'HEAD'], root);
  } catch (error) {
    throw new Error(`git worktree add failed: ${first_line(error.stderr || error.message)}`);
  }
  return { path: target, branch, repo_path: root, base_commit };
}

// The folder must be a direct child of a <repo>.worktrees folder, which is where create_worktree puts it.
function is_managed_worktree_path(worktree_path) {
  const parent_name = path.basename(path.dirname(path.normalize(worktree_path)));
  return parent_name.toLowerCase().endsWith(WORKTREES_SUFFIX);
}

// Number of commits on branch that are not on base_commit. Rejects when git cannot tell.
async function commits_beyond_base(repo_path, base_commit, branch) {
  const output = await run_git(['rev-list', '--count', `${base_commit}..${branch}`], repo_path);
  const count = Number.parseInt(output, 10);
  if (!Number.isFinite(count)) throw new Error('could not count commits on the branch');
  return count;
}

// Removes the worktree and its branch only when: the folder is clean (git status --porcelain is empty) and the
// branch has no commits beyond base_commit. Otherwise nothing is touched. Resolves with
// { removed: boolean, reason: string|null, branch_deleted: boolean }.
async function remove_if_clean({ repo_path, path: worktree_path, branch, base_commit }) {
  const keep = (reason) => ({ removed: false, reason, branch_deleted: false });
  if (typeof repo_path !== 'string' || typeof worktree_path !== 'string' || typeof branch !== 'string') {
    return keep('worktree information is incomplete');
  }
  if (!is_managed_worktree_path(worktree_path)) {
    return keep('the folder is not a worktree that AgentSense created');
  }

  if (!exists(worktree_path)) {
    // The folder was removed by hand: forget the git entry, and delete the branch when it has nothing extra.
    try {
      await run_git(['worktree', 'prune'], repo_path);
    } catch (error) {
      // Pruning is best effort.
    }
    let branch_deleted = false;
    try {
      if (base_commit && (await commits_beyond_base(repo_path, base_commit, branch)) === 0) {
        await run_git(['branch', '-D', branch], repo_path);
        branch_deleted = true;
      }
    } catch (error) {
      branch_deleted = false;
    }
    return { removed: true, reason: null, branch_deleted };
  }

  let status_output = '';
  try {
    status_output = await run_git(['status', '--porcelain'], worktree_path);
  } catch (error) {
    return keep(`git status failed: ${first_line(error.stderr || error.message)}`);
  }
  if (status_output !== '') return keep('the worktree has uncommitted or untracked changes');

  if (!base_commit) return keep('the base commit is unknown, so commits on the branch cannot be checked');
  let ahead = 0;
  try {
    ahead = await commits_beyond_base(repo_path, base_commit, branch);
  } catch (error) {
    return keep(`could not check the branch: ${first_line(error.stderr || error.message)}`);
  }
  if (ahead > 0) return keep(`the branch has ${ahead} commit(s) that are not in the starting point`);

  // The pty may still hold the folder for a moment after it was killed on Windows, so retry.
  let last_error = null;
  for (let attempt = 1; attempt <= REMOVE_ATTEMPTS; attempt += 1) {
    try {
      await run_git(['worktree', 'remove', worktree_path], repo_path);
      last_error = null;
      break;
    } catch (error) {
      last_error = error;
      if (attempt < REMOVE_ATTEMPTS) await sleep(REMOVE_RETRY_MS);
    }
  }
  if (last_error) {
    return keep(`could not remove the worktree: ${first_line(last_error.stderr || last_error.message)}`);
  }

  let branch_deleted = false;
  try {
    await run_git(['branch', '-D', branch], repo_path);
    branch_deleted = true;
  } catch (error) {
    branch_deleted = false;
  }
  try {
    await run_git(['worktree', 'prune'], repo_path);
  } catch (error) {
    // Best effort.
  }
  return { removed: true, reason: null, branch_deleted };
}

module.exports = {
  is_git_repo,
  create_worktree,
  remove_if_clean,
  safe_name,
  is_managed_worktree_path,
  worktrees_folder_for,
};
