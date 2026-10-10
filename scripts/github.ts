import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";
import {
  type Activity,
  calendarMonths,
  repositorySchema,
  type Summary,
} from "./activity.ts";

const execute = promisify(execFile);
const dateSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const countSchema = z.number().int().nonnegative();
const prPageSchema = z.object({
  errors: z.never().optional(),
  data: z.object({
    search: z.object({
      issueCount: countSchema,
      nodes: z.array(
        z.object({
          id: z.string(),
          createdAt: dateSchema,
          repository: repositorySchema,
        }),
      ),
      pageInfo: z.object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      }),
    }),
  }),
});
const commitSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  commit: z.object({ committer: z.object({ date: dateSchema }) }),
  repository: z.object({
    full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    private: z.boolean(),
  }),
});
const commitPageSchema = z.object({
  total_count: countSchema,
  incomplete_results: z.boolean(),
  items: z.array(commitSchema),
});
const associationsSchema = z.object({
  errors: z.never().optional(),
  data: z.record(
    z.string(),
    z.object({
      object: z.object({
        associatedPullRequests: z.object({ totalCount: countSchema }),
      }),
    }),
  ),
});
const failureSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  stderr: z.string().optional(),
});

export type Api = (args: string[]) => Promise<unknown>;

/** Uses the existing CLI authentication; errors deliberately omit private API payloads. */
export function githubApi(): Api {
  let lastSearch = 0;

  return async (args) => {
    if (args[0]?.startsWith("search/")) {
      await setTimeout(Math.max(0, 3_100 - (Date.now() - lastSearch)));
      lastSearch = Date.now();
    }

    try {
      const { stdout } = await execute("gh", ["api", ...args], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
      });
      const value: unknown = JSON.parse(stdout);

      return value;
    } catch (error: unknown) {
      // CLI errors can embed queries containing private repository names.
      const failure = failureSchema.safeParse(error);
      const status = failure.success
        ? failure.data.stderr?.match(/HTTP (\d{3})/)?.[1]
        : undefined;
      const code = failure.success ? failure.data.code : undefined;

      throw new Error(
        `GitHub API request failed${status ? ` with HTTP ${status}` : ""}${code !== undefined ? `, exit ${code}` : ""}. Check authentication, permissions and rate limits.`,
      );
    }
  };
}

/** Uses half-open, second-resolution windows so partitions neither overlap nor leave gaps. */
function dateRange(field: string, start: Date, end: Date): string {
  const iso = (date: Date) => date.toISOString().replace(".000Z", "Z");
  const inclusiveEnd = new Date(end.getTime() - 1_000);

  // GitHub combines repeated qualifiers with OR. A single range preserves both bounds.
  return `${field}:${iso(start)}..${iso(inclusiveEnd)}`;
}

/** Splits searches above GitHub's 1,000-result limit rather than silently truncating them. */
function midpoint(start: Date, end: Date): Date {
  const middle = new Date(
    Math.floor((start.getTime() + end.getTime()) / 2_000) * 1_000,
  );

  if (middle <= start || middle >= end) {
    throw new Error("Too many search results in a single second.");
  }

  return middle;
}

/** Collects authored PRs in all states, including complete pagination and repository visibility. */
export async function pullRequests(
  api: Api,
  query: string,
  start: Date,
  end: Date,
): Promise<Activity[]> {
  const search = `${query} ${dateRange("created", start, end)} sort:created-asc`;
  const graph = `query($search:String!,$cursor:String) {
    search(query:$search,type:ISSUE,first:100,after:$cursor) {
      issueCount nodes { ... on PullRequest { id createdAt repository { nameWithOwner isPrivate } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const items = new Map<string, Activity>();
  let cursor: string | null = null;
  let expected: number | undefined;

  while (true) {
    const args = ["graphql", "-f", `query=${graph}`, "-f", `search=${search}`];

    if (cursor) {
      args.push("-f", `cursor=${cursor}`);
    }

    const page = prPageSchema.parse(await api(args)).data.search;
    expected ??= page.issueCount;

    if (expected > 1_000) {
      const middle = midpoint(start, end);

      const partitioned = [
        ...(await pullRequests(api, query, start, middle)),
        ...(await pullRequests(api, query, middle, end)),
      ];

      if (partitioned.length !== expected) {
        throw new Error(
          "PR partitions do not match the complete search count.",
        );
      }

      return partitioned;
    }

    if (page.issueCount !== expected) {
      throw new Error(
        "PR search changed during pagination. Refusing to publish partial counts.",
      );
    }

    for (const node of page.nodes) {
      if (node.createdAt < start || node.createdAt >= end) {
        throw new Error(
          "GitHub returned a PR outside the requested time window.",
        );
      }

      items.set(node.id, {
        id: node.id,
        kind: "pr",
        date: node.createdAt,
        repository: node.repository,
      });
    }

    if (!page.pageInfo.hasNextPage) {
      break;
    }

    if (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor) {
      throw new Error("GitHub returned an invalid PR pagination cursor.");
    }

    cursor = page.pageInfo.endCursor;
  }

  if (items.size !== expected) {
    throw new Error("PR search returned incomplete results.");
  }

  return [...items.values()];
}

/** Searches authored default-branch commits by commit date, with no 1,000-result truncation. */
async function commits(
  api: Api,
  query: string,
  start: Date,
  end: Date,
): Promise<z.infer<typeof commitSchema>[]> {
  const search = `${query} ${dateRange("committer-date", start, end)}`;
  const items = new Map<string, z.infer<typeof commitSchema>>();
  let expected: number | undefined;

  for (let page = 1; ; page += 1) {
    const result = commitPageSchema.parse(
      await api([
        "search/commits",
        "-X",
        "GET",
        "-f",
        `q=${search}`,
        "-f",
        "per_page=100",
        "-f",
        "sort=committer-date",
        "-f",
        "order=asc",
        "-f",
        `page=${page}`,
      ]),
    );

    if (result.incomplete_results) {
      if (end.getTime() - start.getTime() <= 3_600_000) {
        throw new Error(
          "GitHub commit search remains incomplete for an hour-long window.",
        );
      }

      const middle = midpoint(start, end);

      return [
        ...(await commits(api, query, start, middle)),
        ...(await commits(api, query, middle, end)),
      ];
    }

    expected ??= result.total_count;

    if (expected > 1_000) {
      const middle = midpoint(start, end);

      const partitioned = [
        ...(await commits(api, query, start, middle)),
        ...(await commits(api, query, middle, end)),
      ];

      if (partitioned.length !== expected) {
        throw new Error(
          "Commit partitions do not match the complete search count.",
        );
      }

      return partitioned;
    }

    if (result.total_count !== expected) {
      throw new Error(
        "Commit search changed during pagination. Refusing to publish partial counts.",
      );
    }

    for (const item of result.items) {
      if (
        item.commit.committer.date < start ||
        item.commit.committer.date >= end
      ) {
        throw new Error(
          "GitHub returned a commit outside the requested time window.",
        );
      }

      items.set(`${item.repository.full_name}:${item.sha}`, item);
    }

    if (page * 100 >= expected) {
      break;
    }
  }

  if (items.size !== expected) {
    throw new Error("Commit search returned incomplete results.");
  }

  return [...items.values()];
}

/** Excludes commits introduced through a PR so the combined metric counts them only once. */
export async function directCommits(
  api: Api,
  query: string,
  start: Date,
  end: Date,
): Promise<Activity[]> {
  const candidates = await commits(api, query, start, end);
  const direct: Activity[] = [];

  for (let offset = 0; offset < candidates.length; offset += 40) {
    const batch = candidates.slice(offset, offset + 40);
    const fields = batch.map((item, index) => {
      const [owner, name] = item.repository.full_name.split("/");

      return `c${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
        object(expression:${JSON.stringify(item.sha)}) {
          ... on Commit { associatedPullRequests(first:1) { totalCount } }
        }
      }`;
    });
    const result = associationsSchema.parse(
      await api(["graphql", "-f", `query=query { ${fields.join("\n")} }`]),
    ).data;

    for (const [index, item] of batch.entries()) {
      const association = result[`c${index}`];

      if (!association) {
        throw new Error("GitHub omitted commit association data.");
      }

      if (association.object.associatedPullRequests.totalCount === 0) {
        direct.push({
          id: `${item.repository.full_name}:${item.sha}`,
          date: item.commit.committer.date,
          kind: "direct",
          repository: {
            nameWithOwner: item.repository.full_name,
            isPrivate: item.repository.private,
          },
        });
      }
    }
  }

  return direct;
}

/** Collects a fixed snapshot, preventing activity created mid-run from shifting current counts. */
export async function collect(
  api: Api,
  now: Date,
  coverage: Summary["coverage"],
): Promise<Activity[]> {
  const visibility = coverage === "public" ? " is:public" : "";
  const activities: Activity[] = [];
  const snapshotEnd = new Date(
    Math.floor(now.getTime() / 1_000) * 1_000 + 1_000,
  );

  for (const month of calendarMonths(now)) {
    process.stderr.write(`Collecting ${month.key}\n`);
    const end = month.end < snapshotEnd ? month.end : snapshotEnd;
    const prs = await pullRequests(
      api,
      `is:pr author:ifiokjr${visibility}`,
      month.start,
      end,
    );
    const direct = await directCommits(
      api,
      `author:ifiokjr${visibility}`,
      month.start,
      end,
    );
    activities.push(...prs, ...direct);
    process.stderr.write(
      `${month.key}: ${prs.length} PRs, ${direct.length} direct commits\n`,
    );
  }

  return activities;
}
