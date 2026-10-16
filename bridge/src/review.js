import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, readlink, realpath, access } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
const inside = (root, path) => { const p = relative(root, path); return p === '' || (!p.startsWith('..') && !isAbsolute(p)); };
const MAX_FILES = 300, MAX_FILE = 16 * 1024 * 1024, MAX_PREVIEW = 200000;
async function git(cwd, args, allowed = [0]) {
  try {
    const { stdout } = await exec('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'status.renames=false', ...args], {
      timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', GIT_OPTIONAL_LOCKS: '0' }
    });
    return { stdout, code: 0 };
  } catch (e) {
    if (allowed.includes(e.code)) return { stdout: e.stdout ?? '', code: e.code };
    // Never expose Git stderr/remote URLs or log file contents.
    throw error(409, 'Git review operation failed. Check repository state and Git identity; refresh before retrying.');
  }
}
const out = async (cwd, args) => (await git(cwd, args)).stdout.trim();
async function pathFor(workspace, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path) || path.split('/').some(p => p === '..' || p === '.')) throw error(400, 'Invalid file path');
  const full = join(workspace.path, path);
  let ancestor = dirname(full), parent;
  while (true) {
    try { parent = await realpath(ancestor); break; }
    catch (e) { if (e.code !== 'ENOENT' || ancestor === dirname(ancestor)) throw e; ancestor = dirname(ancestor); }
  }
  if (!inside(workspace.path, parent)) throw error(409, 'File parent escapes this worktree; inspect it manually');
  return full;
}
async function content(workspace, path) {
  const full = await pathFor(workspace, path);
  let stat;
  try { stat = await lstat(full); } catch (e) { if (e.code === 'ENOENT') return { type: 'deleted', mode: 0, data: Buffer.alloc(0) }; throw e; }
  if (stat.isSymbolicLink()) return { type: 'symlink', mode: stat.mode & 0o7777, data: Buffer.from(await readlink(full)) };
  if (!stat.isFile()) return { type: 'special', mode: stat.mode & 0o7777, data: Buffer.alloc(0) };
  if (stat.size > MAX_FILE) throw error(413, 'A changed file exceeds the 16 MiB review limit. Review large files manually.');
  return { type: 'file', mode: stat.mode & 0o7777, data: await readFile(full) };
}
async function inProgress(path) {
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const marker = await out(path, ['rev-parse', '--path-format=absolute', '--git-path', name]);
    try { await access(marker); return true; } catch { /* not present */ }
  }
  return false;
}

/** Read snapshots and apply only explicitly confirmed, revision-bound repository actions. */
export function createReview({ workspaces }) {
  // Navigation-only indicator: no content reads/hashes, no checkout creation.
  async function summary(sessionId) {
    let workspace;
    try { workspace = await workspaces.existing(sessionId); }
    catch (e) { if (e.status === 404) return { hasChanges: false, fileCount: 0, workingCount: 0, committedCount: 0 }; throw e; }
    const raw = (await git(workspace.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout;
    const working = raw.split('\0').filter(Boolean).map(line => line.slice(3));
    const target = await git(workspace.path, ['rev-parse', '--verify', 'refs/heads/' + workspace.baseBranch + '^{commit}'], [0, 128]);
    const committed = target.code === 0
      ? (await git(workspace.path, ['diff', '--name-only', '-z', '--no-renames', target.stdout.trim() + '...HEAD', '--'])).stdout.split('\0').filter(Boolean) : [];
    const fileCount = new Set([...working, ...committed]).size;
    return { hasChanges: fileCount > 0, fileCount, workingCount: working.length, committedCount: committed.length };
  }
  async function snapshot(sessionId) {
    const workspace = await workspaces.existing(sessionId);
    const root = workspace.path;
    const head = await out(root, ['rev-parse', 'HEAD']);
    const status = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout;
    const entries = status.split('\0').filter(Boolean);
    if (entries.length > MAX_FILES) throw error(413, 'More than 300 changed files; narrow the changes before using mobile review.');
    const files = [], hashes = [];
    let totalBytes = 0;
    for (const entry of entries) {
      const path = entry.slice(3), state = entry.slice(0, 2);
      const file = await content(workspace, path);
      totalBytes += file.data.length;
      if (totalBytes > 32 * 1024 * 1024) throw error(413, 'Changed files exceed the 32 MiB mobile review limit. Review large changes manually.');
      files.push({ path, status: state, selectable: file.type !== 'special' && !state.includes('U') && !['AA', 'DD'].includes(state), type: file.type, bytes: file.data.length });
      hashes.push([path, state, file.type, file.mode, digest(file.data)]);
    }
    const staged = (await git(root, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD', '--'])).stdout;
    const codeRevision = digest(JSON.stringify([workspace.repositoryRoot, workspace.path, workspace.branch, head, hashes, staged]));
    const targetRef = 'refs/heads/' + workspace.baseBranch;
    const targetProbe = await git(root, ['rev-parse', '--verify', targetRef + '^{commit}'], [0, 128]);
    const targetHead = targetProbe.code === 0 ? targetProbe.stdout.trim() : null;
    let ahead = 0, behind = 0, committedFiles = [];
    if (targetHead) {
      [behind, ahead] = (await out(root, ['rev-list', '--left-right', '--count', targetHead + '...' + head])).split(/\s+/).map(Number);
      const names = (await git(root, ['diff', '--name-status', '-z', '--no-renames', targetHead + '...' + head, '--'])).stdout.split('\0');
      for (let i = 0; i + 1 < names.length; i += 2) committedFiles.push({ status: names[i], path: names[i + 1] });
      if (committedFiles.length > MAX_FILES) throw error(413, 'More than 300 committed file changes; review this branch manually.');
    }
    const sourceBranch = await out(workspace.repositoryRoot, ['branch', '--show-current']);
    const targetStatus = (await git(workspace.repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout;
    const merging = await inProgress(root);
    const targetMerging = await inProgress(workspace.repositoryRoot);
    const mergeBlock = !targetHead ? 'Local default branch is missing' : sourceBranch !== workspace.baseBranch ? 'Original checkout is not on ' + workspace.baseBranch : targetStatus ? 'Original checkout has uncommitted/untracked changes' : targetMerging ? 'Original checkout has an unfinished Git operation' : merging ? 'Chat has an unfinished Git operation' : files.length ? 'Commit or manually clean this chat’s working changes first' : ahead === 0 ? 'No commits to integrate' : null;
    return { workspace, head, targetHead, ahead, behind, files, committedFiles, codeRevision,
      revision: digest(JSON.stringify([codeRevision, targetHead, sourceBranch, targetStatus, merging, targetMerging])),
      canCommit: !merging && files.some(f => f.selectable), mergeBlock,
      tests: null };
  }
  async function diff(sessionId, { revision, path, scope }) {
    const current = await snapshot(sessionId);
    if (current.revision !== revision) throw error(409, 'Files or branch state changed. Refresh Changes before reviewing.');
    const files = scope === 'working' ? current.files : scope === 'committed' ? current.committedFiles : null;
    const file = files?.find(f => f.path === path);
    if (!file) throw error(400, 'Select a file from the current review');
    let text;
    if (scope === 'working' && file.status === '??') {
      const data = await content(current.workspace, path);
      if (data.type === 'symlink') text = 'New symbolic link → ' + data.data.toString('utf8');
      else if (data.data.includes(0)) text = 'Binary file · ' + data.data.length + ' bytes · SHA-256 ' + digest(data.data);
      else text = 'New file: ' + path + '\n' + data.data.toString('utf8').slice(0, MAX_PREVIEW).split('\n').map(line => '+' + line).join('\n');
    } else {
      const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--unified=3'];
      args.push(scope === 'working' ? 'HEAD' : current.targetHead + '...' + current.head, '--', path);
      text = (await git(current.workspace.path, args)).stdout || 'No net working-file diff against HEAD (the index may differ).';
    }
    return { path, scope, text: text.slice(0, MAX_PREVIEW), truncated: text.length > MAX_PREVIEW };
  }
  async function execute(sessionId, input, signal) {
    const current = await snapshot(sessionId);
    if (current.revision !== input.revision) throw error(409, 'Review is stale. Refresh and confirm the current changes.');
    signal.throwIfAborted();
    const root = current.workspace.path;
    if (input.action === 'commit') {
      if (!current.canCommit || !Array.isArray(input.paths) || !input.paths.length || input.paths.length > MAX_FILES || new Set(input.paths).size !== input.paths.length || input.paths.some(path => !current.files.some(f => f.path === path && f.selectable))) throw error(400, 'Choose supported changed files to commit');
      if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000) throw error(400, 'Provide a commit message (1–2000 characters)');
      await git(root, ['add', '--', ...input.paths]);
      signal.throwIfAborted();
      // --only excludes unrelated pre-staged files, including partially staged edits.
      await git(root, ['commit', '--only', '-m', input.message.trim(), '--', ...input.paths]);
      return { message: 'Selected files committed on this chat’s branch. Nothing pushed.', commit: await out(root, ['rev-parse', 'HEAD']) };
    }
    if (input.action === 'merge') {
      if (current.mergeBlock) throw error(409, current.mergeBlock);
      const preview = await git(root, ['merge-tree', '--write-tree', current.targetHead, current.head], [0, 1]);
      if (preview.code !== 0) throw error(409, 'Merge conflicts detected. The default checkout was not changed. Resolve conflicts manually, then refresh.');
      const mergeTree = preview.stdout.split('\n')[0].trim();
      if (!/^[a-f0-9]{40,64}$/.test(mergeTree)) throw error(409, 'Could not verify the merge preview');
      const incoming = (await git(root, ['diff', '--name-only', '-z', current.targetHead, mergeTree, '--'])).stdout.split('\0').filter(Boolean);
      // Git's --no-overwrite-ignore protects fast-forwards, but not all no-ff strategies.
      // Inspect exact target paths ourselves so ignored local data is never silently replaced.
      for (const path of incoming) {
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          try {
            if ((await lstat(join(current.workspace.repositoryRoot, ...parts.slice(0, i)))).isSymbolicLink()) throw error(409, 'An incoming path crosses a target symlink. Integrate this branch manually.');
          } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
        try { await lstat(join(current.workspace.repositoryRoot, path)); }
        catch (e) { if (e.code === 'ENOENT') continue; throw e; }
        const tracked = (await git(current.workspace.repositoryRoot, ['ls-files', '--stage', '-z', '--', path])).stdout.split('\0')
          .some(entry => entry.slice(entry.indexOf('\t') + 1) === path);
        if (!tracked) throw error(409, 'Incoming changes would overwrite a local untracked/ignored path. Move or review that path manually before merging.');
      }
      signal.throwIfAborted();
      const fresh = await snapshot(sessionId);
      if (fresh.revision !== current.revision) throw error(409, 'Repository changed during merge preview. Refresh and review again.');
      try { await git(current.workspace.repositoryRoot, ['merge', '--no-ff', '--no-edit', '--no-verify', '--no-overwrite-ignore', current.head]); }
      catch { throw error(409, 'Merge did not finish. Inspect the original checkout before retrying; no automatic reset/abort was performed.'); }
      return { message: 'Merged into local ' + current.workspace.baseBranch + '. Nothing pushed.', commit: await out(current.workspace.repositoryRoot, ['rev-parse', 'HEAD']) };
    }
    if (input.action === 'test') {
      if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 4000) throw error(400, 'Provide a test command (1–4000 characters)');
      const startedAt = Date.now();
      const result = await runTests(current.workspace.cwd, input.command, signal);
      const after = await snapshot(sessionId);
      return { message: result.exitCode === 0 ? 'Test command exited successfully.' : 'Test command failed.',
        test: { ...result, command: input.command, startedAt, finishedAt: Date.now(), codeRevision: current.codeRevision,
          changedDuringRun: after.codeRevision !== current.codeRevision || current.files.some(f => f.type === 'special') || after.files.some(f => f.type === 'special') } };
    }
    throw error(400, 'Unknown repository action');
  }
  return { summary, snapshot, diff, execute };
}

function runTests(cwd, command, signal) {
  return new Promise((resolve, reject) => {
    let output = '', truncated = false, timedOut = false, closed = false;
    const child = spawn('bash', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let force;
    const kill = () => {
      if (closed) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* exited */ }
      force = setTimeout(() => { if (!closed) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } }, 1500);
      force.unref();
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, 120000);
    const append = chunk => { const text = chunk.toString(); if (output.length + text.length > MAX_PREVIEW) truncated = true; output = (output + text).slice(-MAX_PREVIEW); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    signal.addEventListener('abort', kill, { once: true });
    child.on('error', () => { closed = true; clearTimeout(timer); clearTimeout(force); signal.removeEventListener('abort', kill); reject(error(500, 'Could not start the test command')); });
    child.on('close', code => {
      closed = true; clearTimeout(timer); clearTimeout(force); signal.removeEventListener('abort', kill);
      if (signal.aborted) reject(error(409, 'Test command cancelled; any earlier side effects remain.'));
      else resolve({ exitCode: code ?? -1, output, truncated, timedOut });
    });
    if (signal.aborted) kill();
  });
}
