import { mkdir, writeFile } from "node:fs/promises";
import { summarize } from "./activity.ts";
import { collect, githubApi } from "./github.ts";
import { countsHtml } from "./html.ts";
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

await writeFile("site/index.html", countsHtml(summary));
