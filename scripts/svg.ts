import {
  type Counts,
  hiddenPublicProjects,
  type ProjectCounts,
  type Summary,
} from "./activity.ts";

const colors = [
  "#7c3aed",
  "#0891b2",
  "#059669",
  "#d97706",
  "#db2777",
  "#2563eb",
  "#64748b",
];

/** Escapes text at the XML boundary, including names supplied by GitHub. */
export function xml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return character;
    }
  });
}

/** Rounds only presentation values; JSON retains the original rates. */
function number(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Names month buckets without depending on the viewer's locale. */
function monthLabel(key: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key}-15T12:00:00Z`));
}

/** Creates an accessible SVG that also renders as a plain external GitHub image. */
function frame(
  summary: Summary,
  title: string,
  description: string,
  height: number,
  body: string,
  dark: boolean,
): string {
  const palette = dark
    ? {
        background: "#0d1117",
        card: "#161b22",
        text: "#f0f6fc",
        muted: "#9da7b3",
        line: "#30363d",
        purple: "#a78bfa",
      }
    : {
        background: "#ffffff",
        card: "#f6f5fb",
        text: "#242038",
        muted: "#686477",
        line: "#e5e2ed",
        purple: "#7057ff",
      };
  const updated = new Intl.DateTimeFormat("en-GB", {
    timeZone: summary.timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(summary.updatedAt));
  const scope =
    summary.coverage === "public"
      ? "Public repositories"
      : "Public + accessible private repositories";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${height}" viewBox="0 0 840 ${height}" role="img" aria-labelledby="title description">
    <title id="title">${xml(title)}</title>
    <desc id="description">${xml(description)}</desc>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; fill: ${palette.text}; }
      .muted { fill: ${palette.muted}; } .accent { fill: ${palette.purple}; }
      .card { fill: ${palette.card}; } .line { stroke: ${palette.line}; } .track { fill: ${palette.line}; }
      .label { font-size: 14px; } .small { font-size: 12px; } .value { font-size: 38px; font-weight: 700; }
    </style>
    <rect x="0.5" y="0.5" width="839" height="${height - 1}" rx="16" fill="${palette.background}" class="line"/>
    ${body}
    <text x="28" y="${height - 20}" class="small muted">${xml(scope)} · ${xml(updated)} London</text>
  </svg>\n`;
}

/** Shows rates alongside actual monthly totals, with the partial month explicitly marked. */
export function activitySvg(summary: Summary, dark = false): string {
  const complete = summary.months.slice(0, -1);
  const last3 = complete.slice(-3);
  const range = (items: typeof complete) =>
    `${monthLabel(items[0]?.month ?? "")} to ${monthLabel(items.at(-1)?.month ?? "")}`;
  const cards = [
    {
      label: "This month",
      value: number(summary.current.total),
      detail: monthLabel(summary.current.month),
      foot:
        summary.pace === null
          ? "Pace available after day one"
          : `~${number(summary.pace)} month-end pace`,
    },
    {
      label: "Previous month",
      value: number(summary.previous.total),
      detail: monthLabel(summary.previous.month),
      foot: `${number(summary.previous.prs)} PRs + ${number(summary.previous.direct)} direct`,
    },
    {
      label: "Last 3 full months",
      value: number(summary.average3, 1),
      detail: "changes / month",
      foot: range(last3),
    },
    {
      label: "Last 12 full months",
      value: number(summary.average12, 1),
      detail: "changes / month",
      foot: range(complete),
    },
  ];
  const max = Math.max(1, ...summary.months.map((month) => month.total));
  const bars = summary.months
    .map((month, index) => {
      const x = 44 + index * 60;
      const height = (month.total / max) * 100;
      const isCurrent = index === summary.months.length - 1;
      const label = monthLabel(month.month).split(" ")[0];

      return `<g><title>${xml(monthLabel(month.month))}: ${month.total} changes, ${month.prs} PRs and ${month.direct} direct commits${isCurrent ? ", partial month" : ""}</title>
      <rect x="${x}" y="${354 - height}" width="28" height="${height}" rx="4" fill="${isCurrent ? "#7057ff" : "#b8a7ec"}"/>
      <text x="${x + 14}" y="${345 - height}" text-anchor="middle" class="small">${number(month.total)}</text>
      <text x="${x + 14}" y="375" text-anchor="middle" class="small ${isCurrent ? "accent" : "muted"}">${xml(label ?? "")}${isCurrent ? "*" : ""}</text>
    </g>`;
    })
    .join("\n");
  const cardBody = cards
    .map((card, index) => {
      const x = 28 + index * 198;

      return `<rect x="${x}" y="76" width="188" height="125" rx="10" class="card"/>
      <text x="${x + 14}" y="101" class="label muted">${xml(card.label)}</text>
      <text x="${x + 14}" y="143" class="value">${xml(card.value)}</text>
      <text x="${x + 14}" y="164" class="small muted">${xml(card.detail)}</text>
      <text x="${x + 14}" y="186" class="small ${index === 0 ? "accent" : "muted"}">${xml(card.foot)}</text>`;
    })
    .join("\n");
  const description = `${summary.current.total} changes this month, including ${summary.current.prs} PRs opened and ${summary.current.direct} direct commits. Previous month ${summary.previous.total}. Three-month average ${number(summary.average3, 1)}. Twelve-month average ${number(summary.average12, 1)}. Rates use complete London calendar months.`;
  const body = `<text x="28" y="37" font-size="22" font-weight="700">Building, month by month</text>
    <text x="28" y="59" class="label muted">PRs opened + direct default-branch commits. PR commits count once.</text>
    ${cardBody}
    <text x="28" y="226" class="label" font-weight="600">Monthly changes</text>
    <text x="812" y="226" text-anchor="end" class="small muted">* current month is partial</text>
    <line x1="28" y1="355" x2="812" y2="355" class="line"/>
    ${bars}
    <text x="28" y="399" class="small muted">${xml(range(complete))} + current month · Current: ${summary.current.prs} PRs + ${summary.current.direct} direct commits</text>`;

  return frame(
    summary,
    "Ifiok's monthly development activity",
    description,
    440,
    body,
    dark,
  );
}

/** Keeps the chart legible without dropping small projects or revealing private names. */
export function projectSlices(
  projects: readonly ProjectCounts[],
): ProjectCounts[] {
  const publicProjects = projects.filter(
    (project) =>
      project.name !== "Private projects" &&
      project.name !== "Other public projects" &&
      !hiddenPublicProjects.has(project.name.toLowerCase()),
  );
  const top = publicProjects.slice(0, 5);
  const others = projects.filter(
    (project) => project.name !== "Private projects" && !top.includes(project),
  );
  const privateProjects = projects.find(
    (project) => project.name === "Private projects",
  );
  const sum = (key: keyof Counts) =>
    others.reduce((total, project) => total + project[key], 0);
  const slices = [...top];

  if (others.length > 0) {
    slices.push({
      name: "Other public projects",
      prs: sum("prs"),
      direct: sum("direct"),
      total: sum("total"),
    });
  }

  if (privateProjects) {
    slices.push(privateProjects);
  }

  return slices.sort(
    (left, right) =>
      right.total - left.total || left.name.localeCompare(right.name),
  );
}

/** Shows repository shares over the last 90 days, with counts so small slices remain readable. */
export function focusSvg(summary: Summary, dark = false): string {
  const projects = projectSlices(summary.focus.projects);
  const circumference = 2 * Math.PI * 76;
  let offset = 0;
  const slices = projects
    .map((project, index) => {
      const share =
        summary.focus.total > 0 ? project.total / summary.focus.total : 0;
      const length = share * circumference;
      const start = offset;
      const y = 105 + index * 32;
      const color = colors[index] ?? "#64748b";
      const label =
        project.name.length > 34
          ? `${project.name.slice(0, 32)}…`
          : project.name;
      offset += length;

      return `<circle cx="135" cy="202" r="76" fill="none" stroke="${color}" stroke-width="28" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-start}" transform="rotate(-90 135 202)"/>
      <g><title>${xml(project.name)}: ${project.total} changes, ${project.prs} PRs and ${project.direct} direct commits</title>
      <circle cx="280" cy="${y - 5}" r="4" fill="${color}"/>
      <text x="294" y="${y}" font-size="15">${xml(label)}</text>
      <text x="808" y="${y}" text-anchor="end" class="label muted">${number(project.total)} · ${number(share * 100, 1)}%</text>
      <rect x="294" y="${y + 7}" width="514" height="4" rx="2" class="track"/>
      <rect x="294" y="${y + 7}" width="${514 * share}" height="4" rx="2" fill="${color}"/>
      </g>`;
    })
    .join("\n");
  const empty =
    summary.focus.total === 0
      ? '<text x="294" y="180" class="label muted">No activity in this window.</text>'
      : "";
  const description = `Repository distribution over the last 90 days. ${projects.map((project) => `${project.name}: ${project.total}`).join(". ")}. Private repositories are grouped together.`;
  const body = `<text x="28" y="37" font-size="22" font-weight="700">Where my work is going</text>
    <text x="28" y="59" class="label muted">Share of PRs opened + direct commits over the last 90 days</text>
    <circle cx="135" cy="202" r="76" fill="none" class="line" stroke-width="28"/>
    ${slices}${empty}
    <text x="135" y="205" text-anchor="middle" font-size="32" font-weight="700">${number(summary.focus.total)}</text>
    <text x="135" y="227" text-anchor="middle" class="label muted">changes</text>`;

  return frame(
    summary,
    "Where Ifiok's development activity is going",
    description,
    368,
    body,
    dark,
  );
}
