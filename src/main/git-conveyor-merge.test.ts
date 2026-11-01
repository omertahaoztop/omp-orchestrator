import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { GitSwitchRefusal, mergeBranchIntoBase } from './git-conveyor'

type GitRunner = (args: string[], cwd?: string) => string

const BRANCH = 'pi/feature-1'

/** A repository on `main` with one commit and a linked worktree on BRANCH. */
async function withWorktree(fn: (repo: string, worktree: string, git: GitRunner) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-merge-'))
  const repo = join(root, 'repo')
  const worktree = join(root, 'wt')
  const git = (args: string[], cwd = repo): string => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
    assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`)
    return result.stdout.trim()
  }
  git(['init', '-b', 'main', repo], root)
  git(['config', 'user.email', 'pi-desktop@example.test'])
  git(['config', 'user.name', 'Pi Desktop Tests'])
  await writeFile(join(repo, 'app.ts'), 'base\n')
  git(['add', '.'])
  git(['commit', '-m', 'initial'])
  git(['worktree', 'add', '-b', BRANCH, worktree])
  try {
    await fn(repo, worktree, git)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function commitIn(git: GitRunner, cwd: string, file: string, content: string): Promise<void> {
  await writeFile(join(cwd, file), content)
  git(['add', file], cwd)
  git(['commit', '-m', `edit ${file}`], cwd)
}

test('mergeBranchIntoBase merges a worktree branch into main in the main checkout', async () => {
  await withWorktree(async (repo, worktree, git) => {
    await commitIn(git, worktree, 'feature.ts', 'feature\n')
    const result = await mergeBranchIntoBase(repo, worktree)
    assert.equal(result.branch, BRANCH)
    assert.equal(result.baseBranch, 'main')
    assert.equal(result.head, git(['rev-parse', 'HEAD']))
    assert.equal(await readFile(join(repo, 'feature.ts'), 'utf-8'), 'feature\n')
    assert.equal(git(['branch', '--show-current']), 'main')
  })
})

test('mergeBranchIntoBase aborts a conflicting merge and leaves main as it was', async () => {
  await withWorktree(async (repo, worktree, git) => {
    await commitIn(git, worktree, 'app.ts', 'from branch\n')
    await commitIn(git, repo, 'app.ts', 'from main\n')
    const before = git(['rev-parse', 'HEAD'])
    await assert.rejects(mergeBranchIntoBase(repo, worktree), GitSwitchRefusal)
    assert.equal(git(['rev-parse', 'HEAD']), before)
    assert.equal(git(['status', '--porcelain']), '')
    assert.equal(existsSync(join(repo, '.git', 'MERGE_HEAD')), false)
    assert.equal(await readFile(join(repo, 'app.ts'), 'utf-8'), 'from main\n')
  })
})

test('mergeBranchIntoBase refuses a dirty main checkout without touching it', async () => {
  await withWorktree(async (repo, worktree, git) => {
    await commitIn(git, worktree, 'feature.ts', 'feature\n')
    await writeFile(join(repo, 'app.ts'), 'uncommitted\n')
    const before = git(['rev-parse', 'HEAD'])
    await assert.rejects(mergeBranchIntoBase(repo, worktree), GitSwitchRefusal)
    assert.equal(git(['rev-parse', 'HEAD']), before)
    assert.equal(await readFile(join(repo, 'app.ts'), 'utf-8'), 'uncommitted\n')
    assert.equal(existsSync(join(repo, 'feature.ts')), false)
  })
})

test('mergeBranchIntoBase refuses uncommitted worktree edits, a main checkout off base, and nothing to merge', async () => {
  await withWorktree(async (repo, worktree, git) => {
    await assert.rejects(mergeBranchIntoBase(repo, worktree), GitSwitchRefusal, 'nothing to merge')
    await commitIn(git, worktree, 'feature.ts', 'feature\n')
    await writeFile(join(worktree, 'feature.ts'), 'uncommitted\n')
    await assert.rejects(mergeBranchIntoBase(repo, worktree), GitSwitchRefusal, 'worktree has uncommitted edits')
    git(['checkout', '--', 'feature.ts'], worktree)
    git(['switch', '-c', 'other'])
    await assert.rejects(mergeBranchIntoBase(repo, worktree), GitSwitchRefusal, 'main checkout is not on main')
    assert.equal(existsSync(join(repo, 'feature.ts')), false)
  })
})

test('mergeBranchIntoBase merges the branch the worktree has now and refuses a detached HEAD', async () => {
  await withWorktree(async (repo, worktree, git) => {
    git(['switch', '-c', 'pi/renamed'], worktree)
    await commitIn(git, worktree, 'renamed.ts', 'renamed\n')
    const result = await mergeBranchIntoBase(repo, worktree)
    assert.equal(result.branch, 'pi/renamed')
    assert.equal(await readFile(join(repo, 'renamed.ts'), 'utf-8'), 'renamed\n')
    git(['switch', '--detach'], worktree)
    await assert.rejects(mergeBranchIntoBase(repo, worktree), GitSwitchRefusal)
  })
})
