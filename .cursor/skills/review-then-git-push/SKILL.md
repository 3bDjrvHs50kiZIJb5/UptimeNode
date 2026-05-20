---
name: review-then-git-push
description: Review local code changes, publish NuGet packages when applicable, then commit and push. Use when the user asks for code review followed by NuGet release and git push; also for "代码审核后 push", "review 后提交", "发布 nuget 后提交", "检查一下然后 git push", "commit and push after review", or "帮我审核并推送".
disable-model-invocation: true
---

# Review Then Git Push

## Core Rule

Treat the request as a review-and-release workflow, not as a blind push.

Always inspect the diff, identify risks, run appropriate verification, **publish to NuGet when the repo expects it**, and only then stage, commit, and push the intended changes. Preserve unrelated user changes.

## Workflow

1. Confirm repository state:
   - Run `git status --short --branch`.
   - Run `git diff --stat` and inspect the relevant diffs.
   - If untracked or modified files appear unrelated, leave them unstaged unless the user explicitly includes them.

2. Review the changes:
   - Look for correctness bugs, regressions, missing validation, security issues, data-loss risks, and missing tests.
   - Prioritize real findings over style remarks.
   - If the user asked only for review, stop after findings and do not publish, commit, or push.
   - If the user asked to push after review, continue only when there are no blocking findings.

3. Verify safely:
   - Choose commands from project docs, `package.json`, solution files, Makefiles, CI config, or local conventions.
   - Prefer targeted commands first, then broader build/test commands when risk is higher.
   - Do not use browser or Playwright tests unless the repository instructions or user explicitly ask for them.
   - Report any command that could not be run, failed for environment reasons, or was intentionally skipped.

4. Publish to NuGet (before git commit):
   - Read `AGENTS.md`, `README`, or repo docs for **which packages to publish**, `dotnet pack` / `dotnet nuget push` commands, and API key source (never invent keys; use repo docs or env vars the user already configured).
   - Determine whether this change set requires a NuGet release (e.g. edits under `NovaAdmin.Blazor/`, `NovaAdmin.Templates/`, or version bumps in packable `.csproj` files). If the user explicitly asked to publish, or repo convention says publish before commit, proceed; otherwise skip this step and say why.
   - For each packable project:
     1. Read `<Version>` from the `.csproj` (or `Directory.Build.props`).
     2. `dotnet pack -c Release` on the project (or solution path documented in the repo).
     3. `dotnet nuget push` the resulting `.nupkg` to `https://api.nuget.org/v3/index.json` with the documented API key.
   - **409 Conflict (version already exists):** bump `<Version>` in the relevant `.csproj` (patch +1 unless the user specified otherwise), rebuild/pack, push again. Include the version bump in the same commit as the code changes when those files are part of the release.
   - **Push failure for other reasons:** stop before commit; report the error and do not commit version bumps alone without a successful publish unless the user says otherwise.
   - After all required packages publish successfully, note package id, version, and nupkg path in the summary.

5. Commit only intended files:
   - Stage explicit paths, not `git add .`, when unrelated changes exist.
   - Include any version bumps from the NuGet step if they are part of this release.
   - Re-run `git status --short` after staging.
   - Use a concise Chinese commit message by default, unless the user or repo convention explicitly requires another language.
   - Keep the commit message action-oriented and specific, for example `发布 NovaAdmin.Blazor 1.0.13 并同步模板`.
   - Never include generated local databases, logs, secrets, or environment files unless the user explicitly asked and the repo already expects them.

6. Push:
   - Check current branch and upstream with `git branch --show-current` and `git status --short --branch`.
   - If the branch has no upstream, use `git push -u origin <branch>`.
   - If the branch has an upstream, use `git push`.
   - After a successful push, report branch name, commit hash, NuGet versions published, verification performed, and any residual risk.

## Stop Conditions

Stop and ask or report clearly before committing or pushing when:

- The review finds a likely bug, data-loss risk, secret exposure, or broken build.
- NuGet publish failed (except 409 handled by version bump + retry).
- The intended change set is ambiguous.
- The working tree contains unrelated changes that cannot be separated safely.
- The repository has no remote or no current branch.
- Verification fails and the failure appears related to the change.

## Output Style

Use Chinese by default when the user writes Chinese or the repo instructions prefer Chinese.

For review findings, lead with the issues first and include file and line references. If there are no blocking findings, say that clearly, then summarize NuGet publish results, verification, and git actions.
