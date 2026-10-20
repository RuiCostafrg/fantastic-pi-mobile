import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const copy = value => JSON.parse(JSON.stringify(value)); // Durable transaction documents are proxies.
const inside = (root, path) => {
  const part = relative(root, path);
  return part === '' || (part !== '..' && !part.startsWith('../') && !isAbsolute(part));
};
async function git(cwd, ...args) {
  try {
    return (await exec('git', ['-C', cwd, ...args], {
      timeout: 10000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    })).stdout.trim();
  } catch {
    // Never expose Git stderr: it can contain private paths/remote credentials.
    throw fail('Project Git validation failed (' + args[0] + '). Check checkout and branch policy.');
  }
}

/** Validate trusted operator input only. No network, worktree creation or execution. */
export async function validateProject(input, directory) {
  if (!input || typeof input.source !== 'string' || !isAbsolute(input.source) || input.source.includes('\0') ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) {
    throw fail('Project requires an absolute source path and a name (1–120 characters).');
  }
  const policy = input.branchPolicy;
  if (!policy || !['local', 'remote'].includes(policy.kind) ||
      (policy.kind === 'local' ? typeof policy.branch !== 'string' || !policy.branch || policy.branch.startsWith('-') :
        typeof policy.remote !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(policy.remote))) {
    throw fail('Specify a local default branch or a named remote policy.');
  }
  let source;
  try { source = await realpath(input.source); } catch { throw fail('Project source is missing or inaccessible.'); }
  if (await git(source, 'rev-parse', '--is-bare-repository') !== 'false' ||
      await git(source, 'rev-parse', '--is-inside-work-tree') !== 'true') throw fail('Project must be a non-bare Git checkout.');
  const repositoryRoot = await realpath(await git(source, 'rev-parse', '--show-toplevel'));
  const commonDirectory = await realpath(await git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  if (!inside(repositoryRoot, source)) throw fail('Project source escapes its repository.');
  // Check both storage location and reserved branch identity (also catches other stores).
  const storage = await realpath(resolve(directory, 'worktrees')).catch(() => resolve(directory, 'worktrees'));
  const branch = await git(source, 'rev-parse', '--symbolic-full-name', 'HEAD');
  if (inside(storage, source) || /^refs\/heads\/pocket\/[a-f0-9]{24}\/[a-f0-9]{24}$/.test(branch)) {
    throw fail('Managed chat worktrees cannot be registered as project sources.');
  }
  await git(source, 'rev-parse', '--verify', 'HEAD^{commit}');
  let branchPolicy;
  if (policy.kind === 'local') {
    await git(source, 'check-ref-format', 'refs/heads/' + policy.branch);
    await git(source, 'rev-parse', '--verify', 'refs/heads/' + policy.branch + '^{commit}');
    branchPolicy = { kind: 'local', branch: policy.branch };
  } else {
    await git(source, 'remote', 'get-url', '--', policy.remote);
    branchPolicy = { kind: 'remote', remote: policy.remote };
  }
  const identity = await stat(commonDirectory, { bigint: true });
  return { name: input.name.trim(), source, repositoryRoot, commonDirectory,
    repositoryIdentity: { device: String(identity.dev), inode: String(identity.ino) },
    subdirectory: relative(repositoryRoot, source), branchPolicy };
}

/** Called within the existing Durable owner's transaction. Identities/policies are immutable. */
export function registerProject(document, candidate) {
  const existing = Object.values(document.items).find(project => project.commonDirectory === candidate.commonDirectory);
  if (existing) {
    if (existing.source !== candidate.source || JSON.stringify(existing.repositoryIdentity) !== JSON.stringify(candidate.repositoryIdentity) || JSON.stringify(existing.branchPolicy) !== JSON.stringify(candidate.branchPolicy)) {
      throw fail('Repository already registered with a different source or branch policy.', 409);
    }
    return copy(existing); // Alias/name changes never mutate an established record.
  }
  const project = { projectId: randomUUID(), ...candidate };
  document.items[project.projectId] = project;
  return copy(project);
}

export async function lookupProject(document, projectId, directory) {
  if (typeof projectId !== 'string' || !Object.hasOwn(document.items, projectId)) throw fail('Unknown project.', 404);
  const project = document.items[projectId];
  const current = await validateProject(project, directory);
  if (JSON.stringify(current.repositoryIdentity) !== JSON.stringify(project.repositoryIdentity)) {
    throw fail('Registered project repository identity changed; refusing to use it.', 409);
  }
  for (const key of ['source', 'repositoryRoot', 'commonDirectory', 'subdirectory']) {
    if (current[key] !== project[key]) throw fail('Registered project repository identity changed; refusing to use it.', 409);
  }
  return copy(project);
}
