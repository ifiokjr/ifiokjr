# Profile activity

The profile tracks PRs opened plus direct commits on a repository's default branch. One authored PR counts once, whether it is open, closed, or merged. One authored commit counts once if GitHub does not associate it with a PR. This includes merge commits and commits introduced through fast-forward merges. Commits within PRs do not count again.

This is a count of activity, not a count of pushes or a measure of time spent. A direct push containing five commits counts as five direct commits. A fast-forward merge does not leave a merge commit, so GitHub history cannot reliably recover historical push batches. Direct commits use their commit timestamp, which can precede the time they reach the default branch.

The current month shows its actual count and an approximate month-end pace based on elapsed time. Pace appears after the first 24 hours. The previous month is its actual total. The three- and twelve-month rates are averages across complete calendar months, excluding the current month. Calendar boundaries use `Europe/London`, including daylight saving time.

The repository chart shows shares over the last 90 days. The five largest public projects have their own slices, remaining public projects share a slice, and private projects share one anonymous slice. The downloadable JSON includes aggregate counts and public project names only.

## Automatic refresh

The Profile activity workflow refreshes the SVGs at minute 17 of each hour, on changes to `main`, and on manual runs. It deploys generated files through GitHub Pages without adding generated commits or changing the README on every refresh. GitHub's image cache and search indexing can delay visible updates.

GitHub can delay scheduled runs and disables scheduled workflows after 60 days without activity in this repository. Re-enable the workflow from Actions if that happens. See [GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

API failures, missing commit associations, and changing pagination fail the job. The previous published SVG remains available. Searches exceeding GitHub's 1,000-result limit or returning incomplete commit results split into smaller time windows. If even an hour-long commit search remains incomplete, the job fails rather than publishing a partial count.

## Private repositories

The built-in workflow token reads public repositories. To include private work, add the repository secret `ACTIVITY_READ_TOKEN` with a GitHub token that can read the relevant repositories and use GitHub's search and GraphQL APIs. Resolve the token through Monosecret when configuring it locally. The collector uses it only in the trusted publishing job, never in PR checks. Coverage is labelled on each SVG. Inaccessible repositories cannot be included.

Private repository names, PR titles, commit messages, identifiers, and URLs are neither written to generated files nor printed in collector progress messages. Keep token access read-only and limited to the repositories you intend to include.

## Local development

Use Node.js 24 or newer and an authenticated GitHub CLI.

```sh
npm ci
npm run check
npm test
npm run refresh
```

For a local snapshot including repositories accessible to the CLI account:

```sh
ACTIVITY_VISIBILITY=accessible npm run refresh
```

Generated files go in the ignored `site/` directory. Only that directory is uploaded to Pages.
