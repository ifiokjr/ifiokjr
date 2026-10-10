import type { Summary } from "./activity.ts";
import { xml } from "./svg.ts";

/** Provides readable tables alongside the SVGs, including for screen-reader users. */
export function countsHtml(summary: Summary): string {
  const number = (value: number) =>
    value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  const changes = (value: number) => {
    const text = number(value);

    return `${text} ${text === "1" ? "change" : "changes"}`;
  };
  const rates = [
    ["This month", `${changes(summary.current.total)} so far`],
    ["Previous month", changes(summary.previous.total)],
    ["Last 3 complete months", `${changes(summary.average3)} per month`],
    ["Last 12 complete months", `${changes(summary.average12)} per month`],
    [
      "Current month-end pace",
      summary.pace === null
        ? "Available after the first 24 hours"
        : `Approximately ${changes(summary.pace)}`,
    ],
  ];
  const rateRows = rates
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${xml(label ?? "")}</th><td>${xml(value ?? "")}</td></tr>`,
    )
    .join("\n");
  const monthRows = summary.months
    .map(
      (month) =>
        `<tr><th scope="row">${month.month}</th><td>${number(month.prs)}</td><td>${number(month.direct)}</td><td>${number(month.total)}</td></tr>`,
    )
    .join("\n");
  const projectRows = summary.focus.projects
    .map((project) => {
      const label = xml(project.name);
      const link = /^[\w.-]+\/[\w.-]+$/.test(project.name)
        ? `<a href="https://github.com/${label}">${label}</a>`
        : label;
      const share =
        summary.focus.total > 0
          ? (project.total / summary.focus.total) * 100
          : 0;

      return `<tr><th scope="row">${link}</th><td>${number(project.prs)}</td><td>${number(project.direct)}</td><td>${number(project.total)}</td><td>${number(share)}%</td></tr>`;
    })
    .join("\n");
  const updated = new Intl.DateTimeFormat("en-GB", {
    timeZone: summary.timeZone,
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(summary.updatedAt));
  const scope =
    summary.coverage === "public"
      ? "Public repositories"
      : "Public and accessible private repositories";

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ifiok's activity</title>
<style>body{color-scheme:light dark;max-width:840px;margin:24px auto;padding:0 16px;font:16px/1.5 system-ui;background:light-dark(#fff,#0d1117);color:light-dark(#242038,#f0f6fc)}img{width:100%;height:auto}a{color:light-dark(#7057ff,#b8a7ec)}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:8px;text-align:left;border-bottom:1px solid light-dark(#e5e2ed,#30363d)}th{overflow-wrap:anywhere}caption{text-align:left;font-weight:bold;padding:8px}section{overflow-x:auto}</style></head>
<body><h1>Ifiok's development activity</h1>
<p>${xml(scope)}. Data as of ${xml(updated)} London time.</p>
<p>PRs I open plus authored commits on default branches that GitHub does not associate with a PR. Private projects are grouped together.</p>
<picture><source media="(prefers-color-scheme:dark)" srcset="activity-dark.svg"><img src="activity.svg" alt="Monthly activity chart; all counts are listed below."></picture>
<section><table><caption>Monthly rates</caption><thead><tr><th scope="col">Period</th><th scope="col">Activity</th></tr></thead><tbody>${rateRows}</tbody></table></section>
<p>Current-month pace is an estimate based on elapsed time. Averages use complete London calendar months.</p>
<section><table><caption>Monthly counts</caption><thead><tr><th scope="col">Month</th><th scope="col">PRs opened</th><th scope="col">Direct commits</th><th scope="col">Total</th></tr></thead><tbody>${monthRows}</tbody></table></section>
<h2>Where my work is going</h2>
<picture><source media="(prefers-color-scheme:dark)" srcset="focus-dark.svg"><img src="focus.svg" alt="Repository shares chart; all counts are listed below."></picture>
<section><table><caption>Repository activity over the last 90 days</caption><thead><tr><th scope="col">Project</th><th scope="col">PRs opened</th><th scope="col">Direct commits</th><th scope="col">Total</th><th scope="col">Share</th></tr></thead><tbody>${projectRows}</tbody></table></section>
<p><a href="activity.json">Download counts</a> · <a href="https://github.com/ifiokjr/ifiokjr/blob/main/docs/activity.md">How this is counted</a></p>
</body></html>\n`;
}
