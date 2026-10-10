import assert from "node:assert/strict";
import { test } from "node:test";
import { type Api, directCommits, pullRequests } from "./github.ts";

const start = new Date("2024-02-01T00:00:00Z");
const end = new Date("2024-03-01T00:00:00Z");
const repository = { full_name: "ifiokjr/example", private: false };

test("date queries use one bounded qualifier, avoiding GitHub's repeated-qualifier OR semantics", async () => {
  await pullRequests(
    async (args) => {
      const search = args.find((argument) => argument.startsWith("search="));
      assert.equal(
        search,
        "search=is:pr author:ifiokjr created:2024-02-01T00:00:00Z..2024-02-29T23:59:59Z sort:created-asc",
      );

      return {
        data: {
          search: {
            issueCount: 0,
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    },
    "is:pr author:ifiokjr",
    start,
    end,
  );
});

test("PR commits are excluded and direct commits keep their repository visibility", async () => {
  const api: Api = async (args) =>
    args[0] === "search/commits"
      ? {
          total_count: 2,
          incomplete_results: false,
          items: [
            {
              sha: "a".repeat(40),
              commit: { committer: { date: "2024-02-02T12:00:00Z" } },
              repository,
            },
            {
              sha: "b".repeat(40),
              commit: { committer: { date: "2024-02-03T12:00:00Z" } },
              repository: { full_name: "secret-owner/private", private: true },
            },
          ],
        }
      : {
          data: {
            c0: { object: { associatedPullRequests: { totalCount: 1 } } },
            c1: { object: { associatedPullRequests: { totalCount: 0 } } },
          },
        };
  const direct = await directCommits(api, "author:ifiokjr", start, end);
  assert.equal(direct.length, 1);
  assert.equal(direct[0]?.id, `secret-owner/private:${"b".repeat(40)}`);
  assert.equal(direct[0]?.repository.isPrivate, true);
  assert.equal(direct[0]?.date.toISOString(), "2024-02-03T12:00:00.000Z");
});

test("missing associations and incomplete search results fail instead of counting zeros", async () => {
  const candidate = {
    total_count: 1,
    incomplete_results: false,
    items: [
      {
        sha: "a".repeat(40),
        commit: { committer: { date: "2024-02-02T12:00:00Z" } },
        repository,
      },
    ],
  };
  await assert.rejects(
    directCommits(
      async (args) => (args[0] === "search/commits" ? candidate : { data: {} }),
      "author:ifiokjr",
      start,
      end,
    ),
    /omitted commit association/,
  );
  await assert.rejects(
    directCommits(
      async () => ({ ...candidate, incomplete_results: true }),
      "author:ifiokjr",
      start,
      new Date("2024-02-01T01:00:00Z"),
    ),
    /remains incomplete/,
  );
  await assert.rejects(
    directCommits(
      async () => ({ ...candidate, items: [] }),
      "author:ifiokjr",
      start,
      end,
    ),
    /incomplete results/,
  );
});

test("searches over 1,000 PRs split into disjoint windows and paginate completely", async () => {
  const nodes = Array.from({ length: 1_001 }, (_, index) => ({
    id: `pr${index}`,
    createdAt: index < 600 ? "2024-02-02T12:00:00Z" : "2024-02-28T12:00:00Z",
    repository: { nameWithOwner: "ifiokjr/example", isPrivate: false },
  }));
  const api: Api = async (args) => {
    const search =
      args.find((argument) => argument.startsWith("search=")) ?? "";
    const from = search.match(/created:(\S+)\.\.(\S+)/)?.[1];
    const until = search.match(/created:(\S+)\.\.(\S+)/)?.[2];
    assert.ok(from && until);
    const filtered = nodes.filter(
      (node) =>
        new Date(node.createdAt) >= new Date(from) &&
        new Date(node.createdAt) <= new Date(until),
    );
    const cursor = Number(
      args.find((argument) => argument.startsWith("cursor="))?.slice(7) ?? 0,
    );
    const next = cursor + 100;

    return {
      data: {
        search: {
          issueCount: filtered.length,
          nodes: filtered.slice(cursor, next),
          pageInfo: {
            hasNextPage: next < filtered.length,
            endCursor: String(next),
          },
        },
      },
    };
  };
  const prs = await pullRequests(api, "is:pr author:ifiokjr", start, end);
  assert.equal(prs.length, 1_001);
  assert.equal(new Set(prs.map((pr) => pr.id)).size, 1_001);
});

test("incomplete commit searches use complete smaller windows and discard the partial payload", async () => {
  const candidates = [
    {
      sha: "a".repeat(40),
      commit: { committer: { date: "2024-02-02T12:00:00Z" } },
      repository,
    },
    {
      sha: "b".repeat(40),
      commit: { committer: { date: "2024-02-28T12:00:00Z" } },
      repository,
    },
  ];
  const api: Api = async (args) => {
    if (args[0] === "graphql") {
      return {
        data: {
          c0: { object: { associatedPullRequests: { totalCount: 0 } } },
          c1: { object: { associatedPullRequests: { totalCount: 0 } } },
        },
      };
    }

    const search = args.find((argument) => argument.startsWith("q=")) ?? "";
    const from = search.match(/committer-date:(\S+)\.\.(\S+)/)?.[1];
    const until = search.match(/committer-date:(\S+)\.\.(\S+)/)?.[2];
    assert.ok(from && until);
    const fullMonth =
      from === "2024-02-01T00:00:00Z" && until === "2024-02-29T23:59:59Z";
    const matching = candidates.filter(
      (item) =>
        new Date(item.commit.committer.date) >= new Date(from) &&
        new Date(item.commit.committer.date) <= new Date(until),
    );

    return {
      total_count: matching.length,
      incomplete_results: fullMonth,
      items: fullMonth ? matching.slice(0, 1) : matching,
    };
  };
  const direct = await directCommits(api, "author:ifiokjr", start, end);
  assert.equal(direct.length, 2);
  assert.equal(new Set(direct.map((item) => item.id)).size, 2);
});

test("responses outside the requested dates are rejected", async () => {
  await assert.rejects(
    directCommits(
      async () => ({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            sha: "a".repeat(40),
            commit: { committer: { date: "2023-01-01T12:00:00Z" } },
            repository,
          },
        ],
      }),
      "author:ifiokjr",
      start,
      end,
    ),
    /outside the requested time window/,
  );
});

test("partial PR payloads and stuck pagination fail visibly", async () => {
  await assert.rejects(
    pullRequests(
      async () => ({
        errors: [{ message: "partial failure" }],
        data: {
          search: {
            issueCount: 0,
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
      "is:pr",
      start,
      end,
    ),
  );
  await assert.rejects(
    pullRequests(
      async () => ({ errors: [{ message: "rate limited" }] }),
      "is:pr",
      start,
      end,
    ),
  );
  await assert.rejects(
    pullRequests(
      async () => ({
        data: {
          search: {
            issueCount: 1,
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
      "is:pr",
      start,
      end,
    ),
    /incomplete results/,
  );
  await assert.rejects(
    pullRequests(
      async () => ({
        data: {
          search: {
            issueCount: 1,
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: "same" },
          },
        },
      }),
      "is:pr",
      start,
      end,
    ),
    /invalid PR pagination/,
  );
});
