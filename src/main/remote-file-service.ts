import { posix } from 'path'
import { FileService, IGNORED_DIRS, isPathInsideWorkspace, type FileChangeCallback, type FileTreeNode, type SearchResult } from './file-service'
import { runRemote } from './ssh-remote'
import { t } from '../shared/i18n'

const REMOTE_OUTPUT_MAX_BUFFER_BYTES = 64 * 1024 * 1024
const REMOTE_LIST_TIMEOUT_MS = 20_000
const GREP_NO_MATCH_EXIT = 1

/** `( -name a -o -name b … ) -prune -o`: skip the same heavy folders the local tree skips. */
function pruneArgs(): string[] {
  const names = [...IGNORED_DIRS].flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name]))
  return ['(', ...names, ')', '-prune', '-o']
}

/** `-exec printf … {} +` rather than GNU `-printf`, so BSD and busybox find work too. */
const TREE_PRINT_ARGS = ['-type', 'd', '-exec', 'printf', 'd\\t%s\\0', '{}', '+', '-o', '-exec', 'printf', 'f\\t%s\\0', '{}', '+']

/**
 * Build the tree view from `<d|f>\t./path\0` records. The two printf batches
 * arrive in any order, so directories are placed first, shortest path first.
 */
export function buildRemoteTree(rootPath: string, output: string): FileTreeNode {
  const root: FileTreeNode = { name: posix.basename(rootPath) || rootPath, path: rootPath, relativePath: '', type: 'directory', children: [] }
  const byPath = new Map<string, FileTreeNode>([['', root]])
  const records = output.split('\0')
    .map((record) => ({ tab: record.indexOf('\t'), record }))
    .filter(({ tab }) => tab >= 0)
    .map(({ tab, record }) => ({ directory: record.slice(0, tab) === 'd', relativePath: record.slice(tab + 1).replace(/^\.\//, '') }))
    .sort((a, b) => (a.directory === b.directory ? (a.directory ? a.relativePath.length - b.relativePath.length : 0) : a.directory ? -1 : 1))
  for (const { directory, relativePath } of records) {
    const parent = byPath.get(posix.dirname(relativePath) === '.' ? '' : posix.dirname(relativePath))
    if (!relativePath || !parent?.children) continue
    const node: FileTreeNode = {
      name: posix.basename(relativePath),
      path: posix.join(rootPath, relativePath),
      relativePath,
      type: directory ? 'directory' : 'file',
      ...(directory ? { children: [] } : {}),
    }
    parent.children.push(node)
    if (directory) byPath.set(relativePath, node)
  }
  for (const node of byPath.values()) {
    node.children!.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
  }
  return root
}

/** Parse `grep -n --null` output (`file\0line:text` per line) into one hit per file. */
export function parseRemoteGrep(rootPath: string, output: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  for (const line of output.split('\n')) {
    if (results.length >= maxResults) break
    const nul = line.indexOf('\0')
    if (nul < 0) continue
    const relativePath = line.slice(0, nul).replace(/^\.\//, '')
    const rest = line.slice(nul + 1)
    const colon = rest.indexOf(':')
    results.push({
      path: posix.join(rootPath, relativePath),
      relativePath,
      name: posix.basename(relativePath),
      matchType: 'content',
      line: Number(rest.slice(0, colon)) || undefined,
      snippet: rest.slice(colon + 1).trim().slice(0, 200),
    })
  }
  return results
}

/**
 * The read-only file side of a workspace that lives on an SSH host: tree,
 * search, file view, git status/branch/diff. Writes and watching are refused;
 * the renderer's safety poll keeps the tree fresh instead.
 */
export class RemoteFileService extends FileService {
  constructor(private readonly host: string, workspacePath: string) {
    super(workspacePath)
  }

  private run(argv: string[], timeout = REMOTE_LIST_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
    return runRemote(this.host, this.workspacePath, argv, { timeout, maxBuffer: REMOTE_OUTPUT_MAX_BUFFER_BYTES })
  }

  protected override git(args: string[], options: { timeout: number; maxBuffer?: number }): Promise<{ stdout: string; stderr: string }> {
    return runRemote(this.host, this.workspacePath, ['git', ...args], options)
  }

  protected override async readWorkspaceFile(relativePath: string): Promise<string> {
    return (await this.run(['cat', '--', relativePath])).stdout
  }

  override async getFileTree(maxDepth = 4): Promise<FileTreeNode> {
    const { stdout } = await this.run(['find', '.', '-mindepth', '1', '-maxdepth', String(maxDepth), ...pruneArgs(), ...TREE_PRINT_ARGS])
    return buildRemoteTree(this.workspacePath, stdout)
  }

  override async searchFiles(query: string, maxResults = 50): Promise<SearchResult[]> {
    const { stdout } = await this.run(['find', '.', ...pruneArgs(), '-type', 'f', '-print0'])
    const lowerQuery = query.toLowerCase()
    return stdout.split('\0')
      .map((relativePath) => relativePath.replace(/^\.\//, ''))
      .filter((relativePath) => relativePath && posix.basename(relativePath).toLowerCase().includes(lowerQuery))
      .slice(0, maxResults)
      .map((relativePath) => ({
        path: posix.join(this.workspacePath, relativePath),
        relativePath,
        name: posix.basename(relativePath),
        matchType: 'filename' as const,
      }))
  }

  override async searchContent(query: string, maxResults = 30): Promise<SearchResult[]> {
    const excludes = [...IGNORED_DIRS].map((name) => `--exclude-dir=${name}`)
    try {
      const { stdout } = await this.run(['grep', '-rIiFn', '--null', '-m', '1', ...excludes, '-e', query, '--', '.'])
      return parseRemoteGrep(this.workspacePath, stdout, maxResults)
    } catch (err) {
      if ((err as { code?: unknown }).code === GREP_NO_MATCH_EXIT) return []
      throw err
    }
  }

  // shortcut: lexical containment only; a symlink inside the remote folder can still point outside it. Check `realpath` remotely if remote writes are ever added.
  override async readFileContent(filePath: string): Promise<string> {
    if (!isPathInsideWorkspace(this.workspacePath, filePath)) throw new Error(t('errors.fileService.refusedRead'))
    const relativePath = posix.isAbsolute(filePath) ? posix.relative(this.workspacePath, filePath) : filePath
    return this.readWorkspaceFile(relativePath)
  }

  override async writeFileContent(): Promise<void> {
    throw new Error(t('errors.remote.unsupported'))
  }

  override async discardFileDiff(): Promise<void> {
    throw new Error(t('errors.remote.unsupported'))
  }

  override startWatching(_callback: FileChangeCallback): void {}

  override startGitWatching(_callback: FileChangeCallback): void {}
}
