// Versyka GitHub Action: flags AI model IDs that are retired or retiring, and API SDKs that are major
// versions behind. No dependencies, so there is nothing to install or bundle.
//
// Your source code never leaves the runner: the model scan runs here against the public retirement
// list. Only dependency manifests (package.json, requirements*.txt, pyproject.toml, Pipfile) are sent to
// the Versyka upgrade check, which reads package names and versions and stores nothing.
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MARKER = "<!-- versyka-action -->";
const MAX_FILES = 20000;
export const MAX_SCAN_BYTES = 512 * 1024;
const MAX_MANIFESTS = 25;

// Keep these rules in step with src/core/model-scan.ts (tests/github-action.test.ts checks they agree).
const SCANNED = /\.(py|ipynb|ts|tsx|js|jsx|mjs|cjs|go|java|kt|rb|php|cs|rs|swift|scala|ya?ml|json|toml|ini|cfg|env|properties|tf)$|(^|\/)\.env(\.[\w-]+)?$/i;
const SKIPPED_DIR = /^(node_modules|dist|build|out|\.next|vendor|\.venv|venv|env|site-packages|__pycache__|\.tox|\.git|coverage|target)$/;
const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Pipfile\.lock|uv\.lock|composer\.lock|Gemfile\.lock|Cargo\.lock|go\.sum)$/;
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|Pipfile|requirements[^/]*\.txt)$/;
const GATEWAY_PREFIX = /^(?:models|openai|anthropic|google|gemini|vertex_ai|vertexai|azure|azure_ai|bedrock|mistral|mistralai|cohere|openrouter|litellm)[/:]/;
const BEDROCK = /^(?:(?:us|eu|apac|global|us-gov)\.)?anthropic\.(.+?)(?:-v\d+(?::\d+)?)?$/;
const BEDROCK_ID = /^(?:(?:us|eu|apac|global|us-gov)\.)?([a-z0-9-]+\.[a-z0-9][a-z0-9.:-]*)$/;
const TOKEN = /[A-Za-z0-9][A-Za-z0-9._:@/-]{1,120}/g;
const QUOTE = /["'`]/;

export const shouldScanPath = (p) => SCANNED.test(p) && !LOCKFILES.test(p) && !/\.min\.js$/.test(p);

export function normalizeModelId(raw) {
  let id = raw.trim().toLowerCase().replace(/[.:/-]+$/, "");
  for (let i = 0; i < 3 && GATEWAY_PREFIX.test(id); i++) id = id.replace(GATEWAY_PREFIX, "");
  const bedrock = id.match(BEDROCK);
  if (bedrock) id = bedrock[1];
  return id.replace("@", "-");
}

/** A Bedrock model ID as Bedrock lists it ("meta.llama3-70b-instruct-v1:0"), without a cross-Region prefix; null otherwise. */
export function bedrockModelId(raw) {
  return raw.trim().toLowerCase().match(BEDROCK_ID)?.[1] ?? null;
}

// Same as the site's retirementIndex (src/core/model-scan.ts): undated names for 8-digit-dated IDs.
export function retirementIndex(models) {
  const index = new Map();
  for (const r of models) {
    // Rows marked scan: false are for reference only (ambiguous IDs); two dates for one ID keep the later one.
    if (r.scan === false) continue;
    for (const id of r.ids) {
      // Bedrock IDs keep their "provider.…-v1:0" form, so Bedrock's dates apply on Bedrock and Anthropic's elsewhere.
      const key = r.vendor === "Amazon Bedrock" ? bedrockModelId(id) ?? normalizeModelId(id) : normalizeModelId(id);
      const prev = index.get(key);
      if (!prev || r.shutdown >= prev.shutdown) index.set(key, r);
    }
  }
  const undated = new Map();
  for (const [id, r] of index) {
    const base = id.replace(/-\d{8}$/, "");
    if (base === id || index.has(base)) continue;
    const prev = undated.get(base);
    if (!prev || r.shutdown > prev.shutdown) undated.set(base, r);
  }
  for (const [base, r] of undated) index.set(base, r);
  return index;
}

export function daysUntil(date, today = new Date()) {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 86_400_000);
}

/** Every line in one file that names a model from the index. IDs without a hyphen must be quoted. */
export function scanSource(text, path, index) {
  if (text.length > MAX_SCAN_BYTES) return [];
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const seen = new Set();
    const line = lines[i];
    for (const m of line.matchAll(TOKEN)) {
      const bedrock = bedrockModelId(m[0]);
      const id = bedrock && index.has(bedrock) ? bedrock : normalizeModelId(m[0]);
      if (!index.has(id) || seen.has(id)) continue;
      if (!id.includes("-") && !(QUOTE.test(line[m.index - 1] ?? "") && QUOTE.test(line[m.index + m[0].length] ?? ""))) continue;
      // Capitals ("GPT-4") are how prose names a model: only a quoted value, or one after "=", counts.
      if (/[A-Z]/.test(m[0]) && !((QUOTE.test(line[m.index - 1] ?? "") && QUOTE.test(line[m.index + m[0].length] ?? "")) || /=\s*$/.test(line.slice(0, m.index)))) continue;
      seen.add(id);
      hits.push({ id, path, line: i + 1 });
    }
  }
  return hits;
}

/** Hits grouped by model with their status, soonest first. */
export function findings(hits, index, soonDays, today = new Date()) {
  const byId = new Map();
  for (const h of hits) byId.set(h.id, [...(byId.get(h.id) ?? []), h]);
  return [...byId.entries()]
    .map(([id, list]) => {
      const r = index.get(id);
      const daysLeft = daysUntil(r.shutdown, today);
      const status = daysLeft <= 0 ? "retired" : daysLeft <= soonDays ? "soon" : "scheduled";
      return { id, vendor: r.vendor, shutdown: r.shutdown, earliest: Boolean(r.earliest), replacement: r.replacement, source: r.source, daysLeft, status, locations: list };
    })
    .sort((a, b) => a.shutdown.localeCompare(b.shutdown) || a.id.localeCompare(b.id));
}

function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIR.test(entry.name)) visit(join(dir, entry.name));
      } else if (entry.isFile()) {
        out.push(relative(root, join(dir, entry.name)).split(sep).join("/"));
      }
    }
  };
  visit(root);
  return out;
}

const md = (s) => String(s).replace(/\|/g, "\\|");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The Markdown for the job summary and the pull request comment. */
export function renderReport({ models, deps, verifiedOn, blobUrl, siteUrl, soonDays }) {
  const retired = models.filter((m) => m.status === "retired");
  const soon = models.filter((m) => m.status === "soon");
  const lines = [MARKER, "### Versyka check", ""];
  if (models.length === 0 && deps.length === 0) {
    lines.push("No retired or retiring AI models, and no API SDKs behind. All clear.");
  } else {
    lines.push(`**${plural(retired.length, "retired model")} · ${plural(soon.length, "model")} retiring within ${soonDays} days · ${plural(deps.length, "SDK")} behind**`, "");
  }
  if (models.length) {
    lines.push("| Model | Status | Date | Replace with | Where |", "| --- | --- | --- | --- | --- |");
    for (const m of models) {
      const status = m.status === "retired" ? "**Retired**: calls fail" : `${m.status === "soon" ? "**" : ""}${m.earliest ? "from " : ""}${m.daysLeft} days left${m.status === "soon" ? "**" : ""}`;
      const where = m.locations.slice(0, 5).map((l) => `[${md(l.path)}:${l.line}](${blobUrl(l.path, l.line)})`).join("<br>") + (m.locations.length > 5 ? `<br>and ${m.locations.length - 5} more` : "");
      lines.push(`| \`${m.id}\` (${m.vendor}) | ${status} | [${m.shutdown}${m.earliest ? " (earliest)" : ""}](${m.source}) | ${m.replacement ? md(m.replacement) : "not named"} | ${where} |`);
    }
    lines.push("");
  }
  if (deps.length) {
    lines.push("| SDK | File | You have | Latest | Status |", "| --- | --- | --- | --- | --- |");
    for (const d of deps) {
      const status = d.deprecated ? "Deprecated" : d.majorsBehind > 0 ? `${plural(d.majorsBehind, "major")} behind` : `Replaced: ${md(d.note ?? "")}`;
      lines.push(`| \`${d.name}\` | ${md(d.path)} | ${md(d.spec)} | ${d.latest ?? "?"} | ${d.releaseNotes ? `[${status}](${d.releaseNotes})` : status} |`);
    }
    lines.push("");
  }
  lines.push(
    `<sub>Model dates from the vendors' deprecation pages, checked ${verifiedOn}: [retirement calendar](${siteUrl}/model-retirements). ` +
      (retired.length + soon.length + deps.length ? `Want these migrated with tested pull requests? [Versyka](${siteUrl}/upgrade-check).` : "") +
      "</sub>",
  );
  return lines.join("\n");
}

function input(name, fallback = "") {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? fallback).trim() || fallback;
}

const escapeData = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
const command = (kind, msg, props) =>
  console.log(`::${kind}${props ? " " + Object.entries(props).map(([k, v]) => `${k}=${escapeProp(v)}`).join(",") : ""}::${escapeData(msg)}`);

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} returned ${res.status}`);
  return res.json();
}

async function upsertComment({ body, hasFindings, token }) {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const number = event.pull_request?.number;
  if (!number || !token) return;
  const api = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${process.env.GITHUB_REPOSITORY}`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
  const comments = await getJson(`${api}/issues/${number}/comments?per_page=100`, { headers });
  const mine = comments.find((c) => typeof c.body === "string" && c.body.startsWith(MARKER));
  // Comment only when there is something to say; once there is a comment, keep it current (including "all clear").
  if (mine) await getJson(`${api}/issues/comments/${mine.id}`, { method: "PATCH", headers, body: JSON.stringify({ body }) });
  else if (hasFindings) await getJson(`${api}/issues/${number}/comments`, { method: "POST", headers, body: JSON.stringify({ body }) });
}

export async function run() {
  const failOn = input("fail-on", "retired");
  const soonDays = Number(input("days", "90")) || 90;
  const root = input("path", ".");
  const siteUrl = input("api-url", "https://www.versyka.com").replace(/\/+$/, "");
  const token = input("github-token");

  let data;
  try {
    data = await getJson(`${siteUrl}/api/model-retirements`);
  } catch (err) {
    command("warning", `Versyka couldn't load the model retirement list (${err.message}). Skipping this run.`);
    return;
  }
  // `calendarOnly` holds rows older versions of this action must not read (see /api/model-retirements); this version
  // applies the same rules as the site to them: scan: false rows are skipped, Bedrock rows keep their own IDs.
  const index = retirementIndex([...data.models, ...(data.calendarOnly ?? [])]);

  const files = walk(root);
  const hits = [];
  const manifests = [];
  for (const path of files) {
    const isManifest = MANIFEST.test(path);
    if (!isManifest && !shouldScanPath(path)) continue;
    const full = join(root, path);
    if (statSync(full).size > MAX_SCAN_BYTES) continue;
    const text = readFileSync(full, "utf8");
    if (shouldScanPath(path)) hits.push(...scanSource(text, path, index));
    if (isManifest && manifests.length < MAX_MANIFESTS) manifests.push({ path, text });
  }
  const models = findings(hits, index, soonDays);

  let deps = [];
  if (manifests.length) {
    try {
      const report = await getJson(`${siteUrl}/api/ci`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifests }) });
      deps = report.manifests.flatMap((m) => m.reports.filter((r) => r.majorsBehind > 0 || r.deprecated || r.note).map((r) => ({ ...r, path: m.path })));
    } catch (err) {
      command("warning", `Versyka's upgrade check didn't answer (${err.message}); only models were checked.`);
    }
  }

  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const sha = event.pull_request?.head?.sha ?? process.env.GITHUB_SHA ?? "HEAD";
  const repoUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}`;
  // Paths in links and annotations are relative to the repository root, wherever `path` points.
  const fromRepo = relative(process.env.GITHUB_WORKSPACE ?? process.cwd(), resolve(root)).split(sep).join("/");
  const prefix = !fromRepo || fromRepo.startsWith("..") || isAbsolute(fromRepo) ? "" : `${fromRepo}/`;
  const blobUrl = (path, line) => `${repoUrl}/blob/${sha}/${prefix}${path}#L${line}`;

  for (const m of models) {
    if (m.status === "scheduled") continue;
    const msg = m.status === "retired" ? `${m.id} was retired by ${m.vendor} on ${m.shutdown}; calls to it fail.` : `${m.id} retires ${m.earliest ? "as early as" : "on"} ${m.shutdown} (${m.daysLeft} days).`;
    for (const l of m.locations.slice(0, 10)) command(m.status === "retired" ? "error" : "warning", `${msg}${m.replacement ? ` Replace with ${m.replacement}.` : ""}`, { file: `${prefix}${l.path}`, line: l.line, title: "Versyka: model retirement" });
  }

  const body = renderReport({ models, deps, verifiedOn: data.verifiedOn, blobUrl, siteUrl, soonDays });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body.replace(MARKER, "") + "\n");
  console.log(body.replace(MARKER, ""));

  const retired = models.filter((m) => m.status === "retired").length;
  const soon = models.filter((m) => m.status === "soon").length;
  setOutput("retired", retired);
  setOutput("soon", soon);
  setOutput("behind", deps.length);

  if (input("comment", "true") === "true") {
    try {
      await upsertComment({ body, hasFindings: models.length + deps.length > 0, token });
    } catch (err) {
      command("warning", `Couldn't comment on the pull request (${err.message}). Give the job "pull-requests: write" permission, or set comment: false.`);
    }
  }

  const fail = { none: false, retired: retired > 0, soon: retired + soon > 0, behind: retired + soon + deps.length > 0 }[failOn] ?? retired > 0;
  if (fail) {
    command("error", `Versyka: ${plural(retired, "retired model")}, ${plural(soon, "model")} retiring within ${soonDays} days, ${plural(deps.length, "SDK")} behind (fail-on: ${failOn}).`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    command("error", `Versyka action failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
