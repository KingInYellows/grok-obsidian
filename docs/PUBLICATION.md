# Publication checklist

This repository separates reusable code and synthetic tests from private operator material. Preparing these files does not authorize a commit, push, history rewrite, service deployment or visibility change.

## Included material

- `src/`, the TypeScript tests, package manifests and compiler configuration.
- Placeholder environment and service examples, including the intake-only configuration.
- The MIT license, public README, security policy, configuration guide, status summary and this checklist.
- The explicitly allowed generic planning records in `outputs/`.

## Kept private

Actual host addresses, vault paths, service recovery instructions, personal automation settings, detailed execution receipts, local agent instructions and host-specific deployment helpers stay in ignored local files. Preserve them for the operator. Do not use `git add -f` or broad staging commands to bypass the exclusions.

Ignoring a path does not remove earlier commits, published artifacts or remote copies. Check the index and every publishable ref before release, not only the working tree. Reconcile tracked changes against the canonical development checkout without copying an older deployed source directory over it.

## Review before public release

1. Scan every tracked file and all reachable history for credentials, and review non-secret personal information such as commit-author emails, hostnames, automation details and private source URLs. Review any scanner detections with values redacted.
2. Inspect the exact proposed commit, tracked paths, branches, tags, pull requests, issues, releases and Actions artifacts/logs. Recheck if anything changes after the audit.
3. Confirm the license and copyright attribution. MIT permits commercial reuse and redistribution while requiring preservation of its notice. The package's `private: true` only prevents accidental npm publication.
4. Run the documented validation suite with native dependencies. Compare the resulting application artifacts with the running release when claiming they represent the deployed version. Distinguish code identity from live client acceptance.
5. Resolve author-email privacy before publishing existing history. Retaining that metadata or rewriting history is an explicit owner decision. Never silently rewrite, force-push or create a replacement repository.
6. Obtain explicit authorization for committing/pushing and for changing visibility. Publishing source does not authorize any deployment or expose the operated service.

At the first 2026-08-31 review, the initial commit used one non-noreply email for author/committer metadata. With explicit owner approval, local `main` was rewritten to `2e247a478721dc6132c0b29ed24c2eddac77c4b7` using the account-linked GitHub noreply address for both fields. The file tree, names, timestamps and message were preserved. The owner subsequently approved committing/pushing the reviewed publication set. That approval does not change repository visibility or establish that GitHub has purged the original commit.

The owner approved publication with the MIT license. See [Choose a License](https://choosealicense.com/licenses/mit/) for its permissions and conditions, and [GitHub visibility guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility) for publication consequences. Public forks can remain public even if the original repository becomes private again.

## Publishing the rewritten branch

Review the exact local `main` tip, create any separately authorized publication commit with the same noreply email for both author and committer, and replace remote `main` only through an explicitly approved workflow with an exact expected-old-commit lease. Branch protection may require an additional owner decision. Do not weaken protection automatically or push all refs with `--mirror`.

Original history is retained in private recovery material. Do not publish that material or assume rewriting local `main` erased the original from GitHub. Repository/global Git identity settings were not changed; future commits must select the approved noreply identity explicitly.
