import { z } from "zod";

export const timeZone = "Europe/London";
export const hiddenPublicProjects = new Set([
  "ifiokjr/lspee",
  "ifiokjr/monokit",
]);

export const repositorySchema = z.object({
  nameWithOwner: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  isPrivate: z.boolean(),
});

export type Repository = z.infer<typeof repositorySchema>;
export type Activity = {
  id: string;
  date: Date;
  kind: "pr" | "direct";
  repository: Repository;
};

export type Month = {
  key: string;
  start: Date;
  end: Date;
};

export type Counts = { prs: number; direct: number; total: number };
export type MonthlyCounts = Counts & { month: string };
export type ProjectCounts = Counts & { name: string };
export type Summary = {
  updatedAt: string;
  timeZone: string;
  coverage: "public" | "accessible";
  months: MonthlyCounts[];
  current: MonthlyCounts;
  previous: MonthlyCounts;
  average3: number;
  average12: number;
  pace: number | null;
  focus: { since: string; total: number; projects: ProjectCounts[] };
};

/** Identifies the calendar month in London, independent of the runner's timezone. */
export function monthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  if (!year || !month) {
    throw new Error("Could not identify the calendar month.");
  }

  return `${year}-${month}`;
}

/** Converts London midnight on the first into UTC, including British summer time. */
function monthStart(year: number, month: number): Date {
  const utc = new Date(Date.UTC(year, month, 1));
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(utc)
    .find((part) => part.type === "timeZoneName")?.value;

  if (offset !== "GMT" && offset !== "GMT+0" && offset !== "GMT+1") {
    throw new Error("Unexpected London timezone offset.");
  }

  return new Date(utc.getTime() - (offset === "GMT+1" ? 3_600_000 : 0));
}

/** Returns twelve complete months and the current month, with disjoint boundaries. */
export function calendarMonths(now: Date): Month[] {
  const [year, month] = monthKey(now).split("-").map(Number);

  if (year === undefined || month === undefined) {
    throw new Error("Invalid month.");
  }

  return Array.from({ length: 13 }, (_, index) => {
    const start = monthStart(year, month - 13 + index);

    return {
      key: monthKey(start),
      start,
      end: monthStart(year, month - 12 + index),
    };
  });
}

/** Keeps counts comparable while retaining the PR/direct-commit breakdown. */
function counts(activities: readonly Activity[]): Counts {
  const prs = activities.filter((activity) => activity.kind === "pr").length;
  const direct = activities.length - prs;

  return { prs, direct, total: activities.length };
}

/** Produces only publishable aggregates; private names and identifiers never leave here. */
export function summarize(
  activities: readonly Activity[],
  now: Date,
  coverage: Summary["coverage"],
): Summary {
  const windows = calendarMonths(now);
  const unique = [
    ...new Map(activities.map((item) => [item.id, item])).values(),
  ];
  const eligible = unique.filter(
    (item) =>
      item.date <= now &&
      (coverage === "accessible" || !item.repository.isPrivate),
  );
  const months = windows.map((window) => ({
    month: window.key,
    ...counts(
      eligible.filter(
        (item) => item.date >= window.start && item.date < window.end,
      ),
    ),
  }));
  const current = months.at(-1);
  const previous = months.at(-2);
  const currentWindow = windows.at(-1);

  if (!current || !previous || !currentWindow) {
    throw new Error("Missing monthly history.");
  }

  const completed = months.slice(0, -1);
  const average = (items: MonthlyCounts[]) =>
    items.reduce((total, item) => total + item.total, 0) / items.length;
  const elapsed = now.getTime() - currentWindow.start.getTime();
  const duration = currentWindow.end.getTime() - currentWindow.start.getTime();
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const recent = eligible.filter((item) => item.date >= since);
  const groups = new Map<string, Activity[]>();

  for (const item of recent) {
    const name = item.repository.isPrivate
      ? "Private projects"
      : hiddenPublicProjects.has(item.repository.nameWithOwner.toLowerCase())
        ? "Other public projects"
        : item.repository.nameWithOwner;
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }

  const projects = [...groups]
    .map(([name, items]) => ({ name, ...counts(items) }))
    .sort(
      (left, right) =>
        right.total - left.total || left.name.localeCompare(right.name),
    );

  return {
    updatedAt: now.toISOString(),
    timeZone,
    coverage,
    months,
    current,
    previous,
    average3: average(completed.slice(-3)),
    average12: average(completed),
    pace: elapsed >= 86_400_000 ? (current.total * duration) / elapsed : null,
    focus: { since: since.toISOString(), total: recent.length, projects },
  };
}
