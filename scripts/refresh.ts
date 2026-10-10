import { mkdir, writeFile } from "node:fs/promises";
import { summarize } from "./activity.ts";
import { collect, githubApi } from "./github.ts";
import { activitySvg, focusSvg } from "./svg.ts";

const coverage = process.env.ACTIVITY_VISIBILITY ?? "public";

if (coverage !== "public" && coverage !== "accessible") {
  throw new Error("ACTIVITY_VISIBILITY must be public or accessible.");
}

const now = new Date();
const activities = await collect(githubApi(), now, coverage);
const summary = summarize(activities, now, coverage);
await mkdir("site", { recursive: true });
await writeFile("site/activity.json", `${JSON.stringify(summary, null, 2)}\n`);

for (const dark of [false, true]) {
  const suffix = dark ? "-dark" : "";
  await writeFile(`site/activity${suffix}.svg`, activitySvg(summary, dark));
  await writeFile(`site/focus${suffix}.svg`, focusSvg(summary, dark));
}

await writeFile(
  "site/index.html",
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ifiok\'s activity</title><style>body{max-width:840px;margin:24px auto;padding:0 12px;font:16px system-ui}img{width:100%;height:auto}</style><h1>Ifiok\'s development activity</h1><p>PRs opened plus authored default-branch commits that GitHub does not associate with a PR.</p><p>Current-month pace is an extrapolation. Three- and twelve-month rates use complete London calendar months. Repository shares cover the last 90 days.</p><img src="activity.svg" alt="Monthly development activity"><img src="focus.svg" alt="Repository activity shares"><p><a href="activity.json">Counts and timestamps</a> · <a href="https://github.com/ifiokjr/ifiokjr/blob/main/docs/activity.md">How this is counted</a></p></html>\n',
);
