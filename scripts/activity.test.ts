import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Activity,
  calendarMonths,
  monthKey,
  summarize,
} from "./activity.ts";
import { activitySvg, focusSvg, projectSlices, xml } from "./svg.ts";

/** Defines explicit events so expected metrics are independent of the counting implementation. */
function event(
  id: string,
  date: string,
  kind: Activity["kind"] = "pr",
  privateProject = false,
): Activity {
  return {
    id,
    date: new Date(date),
    kind,
    repository: {
      nameWithOwner: privateProject
        ? "secret-owner/never-publish-this-name"
        : "ifiokjr/example",
      isPrivate: privateProject,
    },
  };
}

test("London month boundaries include the daylight-saving offset and year rollover", () => {
  const months = calendarMonths(new Date("2026-10-10T12:00:00Z"));
  assert.equal(months[0]?.key, "2025-10");
  assert.equal(months[0]?.start.toISOString(), "2025-09-30T23:00:00.000Z");
  assert.equal(months.at(-1)?.start.toISOString(), "2026-09-30T23:00:00.000Z");
  assert.equal(months.at(-1)?.end.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(monthKey(new Date("2026-09-30T23:30:00Z")), "2026-10");
  assert.equal(
    calendarMonths(new Date("2024-01-15T12:00:00Z"))[0]?.key,
    "2023-01",
  );
});

test("rates use complete months, leap-year pace and a fixed snapshot", () => {
  const activities = [
    event("nov", "2023-11-01T12:00:00Z"),
    event("dec1", "2023-12-01T12:00:00Z", "direct", true),
    event("dec2", "2023-12-02T12:00:00Z", "direct", true),
    event("dec3", "2023-12-03T12:00:00Z", "pr", true),
    event("jan1", "2024-01-01T12:00:00Z"),
    event("jan2", "2024-01-02T12:00:00Z", "direct"),
    event("feb1", "2024-02-01T12:00:00Z"),
    event("feb2", "2024-02-02T12:00:00Z", "direct"),
    event("feb2", "2024-02-02T12:00:00Z", "direct"),
    event("future", "2024-02-16T12:00:00Z"),
    event("old", "2023-01-01T12:00:00Z"),
  ];
  const summary = summarize(
    activities,
    new Date("2024-02-15T12:00:00Z"),
    "accessible",
  );
  assert.deepEqual(summary.current, {
    month: "2024-02",
    prs: 1,
    direct: 1,
    total: 2,
  });
  assert.deepEqual(summary.previous, {
    month: "2024-01",
    prs: 1,
    direct: 1,
    total: 2,
  });
  assert.equal(summary.average3, 2);
  assert.equal(summary.average12, 0.5);
  assert.equal(summary.pace, 4);
  assert.equal(summary.focus.total, 7);
  assert.equal(
    summary.focus.projects.find(
      (project) => project.name === "Private projects",
    )?.total,
    3,
  );

  for (const output of [
    JSON.stringify(summary),
    activitySvg(summary),
    focusSvg(summary, true),
  ]) {
    assert.doesNotMatch(
      output,
      /secret-owner|never-publish-this-name|dec1|dec2/,
    );
  }
});

test("public-only summaries exclude private records and empty data never produces NaN", () => {
  const now = new Date("2024-02-01T00:00:00Z");
  const summary = summarize(
    [event("private", "2024-01-02T12:00:00Z", "direct", true)],
    now,
    "public",
  );
  assert.equal(summary.previous.total, 0);
  assert.equal(summary.average12, 0);
  assert.equal(summary.pace, null);
  assert.equal(summary.focus.total, 0);
  assert.match(focusSvg(summary), /No activity in this window/);
  assert.doesNotMatch(activitySvg(summary) + focusSvg(summary), /NaN|Infinity/);
});

test("private and small project slices preserve the complete total", () => {
  const projects = [
    { name: "Private projects", total: 10, prs: 2, direct: 8 },
    { name: "ifiokjr/monokit", total: 9, prs: 9, direct: 0 },
    ...Array.from({ length: 7 }, (_, index) => ({
      name: `ifiokjr/project${index}`,
      total: 7 - index,
      prs: 7 - index,
      direct: 0,
    })),
  ];
  const slices = projectSlices(projects);
  assert.equal(
    slices.reduce((total, project) => total + project.total, 0),
    47,
  );
  assert.equal(
    slices.find((project) => project.name === "Other public projects")?.total,
    12,
  );
  assert.equal(
    slices.find((project) => project.name === "Private projects")?.total,
    10,
  );
  assert.ok(slices.length <= 7);
  assert.ok(!slices.some((project) => /monokit/i.test(project.name)));
});

test("SVG content escapes XML and includes an accessible description", () => {
  assert.equal(xml('A&B <"test">'), "A&amp;B &lt;&quot;test&quot;&gt;");
  const summary = summarize([], new Date("2024-02-15T12:00:00Z"), "public");
  assert.match(activitySvg(summary), /aria-labelledby="title description"/);
  assert.match(activitySvg(summary), /<desc id="description">/);
  assert.match(focusSvg(summary, true), /fill="#0d1117"/);
});
