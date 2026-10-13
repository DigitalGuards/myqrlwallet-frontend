#!/usr/bin/env node
// Dependency audit gate for CI.
//
// Runs `npm audit --omit=dev --json` and fails when an advisory at or above
// the chosen severity affects the production dependency graph. An advisory
// passes only when audit-allowlist.json holds a matching entry with a reason
// and an expiry date at most 90 days ahead. An expired entry fails the gate,
// so every exception gets a fresh review. A failed, offline or inconsistent
// audit also fails the gate.
//
// Usage: node scripts/audit-gate.mjs [--level low|moderate|high|critical]
//                                    [--dir <package dir>] [--allowlist <file>]
// Exit codes: 0 pass, 1 blocking advisories or expired entries, 2 setup error.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const ENTRY_KEYS = ['id', 'package', 'reason', 'expires'];
const GHSA_ID = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EXCEPTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const inActions = process.env.GITHUB_ACTIONS === 'true';

function fail(message) {
  console.error(`audit-gate: ${message}`);
  process.exit(2);
}

function warn(message) {
  const prefix = inActions ? '::warning::audit-gate:' : 'audit-gate: warning:';
  console.log(`${prefix} ${message}`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseArgs(argv) {
  const options = { level: 'high', dir: '.', allowlist: 'audit-allowlist.json' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--level', '--dir', '--allowlist'].includes(flag) || !isNonEmptyString(value)) {
      fail(`unknown or incomplete argument: ${String(flag)}`);
    }
    options[flag.slice(2)] = value;
  }
  if (!SEVERITIES.includes(options.level)) fail(`unknown level: ${options.level}`);
  return options;
}

function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  // An unknown severity counts as critical.
  return rank === -1 ? SEVERITIES.length - 1 : rank;
}

function isoDay(timeMs) {
  return new Date(timeMs).toISOString().slice(0, 10);
}

function isCalendarDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to March; the round trip rejects it.
  return !Number.isNaN(time) && isoDay(time) === value;
}

// Advisories are matched by GHSA id; an entry may give the id or its URL.
function advisoryId(idOrUrl) {
  const last = idOrUrl.split('/').pop();
  return typeof last === 'string' && GHSA_ID.test(last) ? last : idOrUrl;
}

function loadAllowlist(label, today, latestExpiry) {
  const file = path.resolve(label);
  if (!existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const keys = isRecord(parsed) ? Object.keys(parsed) : [];
  if (!isRecord(parsed) || !Array.isArray(parsed.exceptions) || keys.length !== 1) {
    fail(`${label} must be an object with one key, "exceptions", holding an array`);
  }
  return parsed.exceptions.map((entry, index) => {
    const where = `${label} exceptions[${index}]`;
    if (!isRecord(entry)) fail(`${where} must be an object`);
    const unknownKey = Object.keys(entry).find((key) => !ENTRY_KEYS.includes(key));
    if (unknownKey !== undefined) fail(`${where} has an unknown key "${unknownKey}"`);
    const { id, package: pkg, reason, expires } = entry;
    if (typeof id !== 'string' || !(GHSA_ID.test(id) || id.startsWith('https://'))) {
      fail(`${where}.id must be a GHSA id or the advisory URL`);
    }
    if (!isNonEmptyString(pkg)) fail(`${where}.package must name the affected package`);
    if (!isNonEmptyString(reason) || reason.trim().length < 20) {
      fail(`${where}.reason must explain the exception`);
    }
    if (typeof expires !== 'string' || !isCalendarDate(expires)) {
      fail(`${where}.expires must be a valid YYYY-MM-DD date`);
    }
    if (expires > latestExpiry) {
      fail(`${where}.expires may be at most ${MAX_EXCEPTION_DAYS} days ahead (${latestExpiry})`);
    }
    return { id: advisoryId(id), pkg, reason: reason.trim(), expires, expired: expires < today };
  });
}

function runAudit(dir) {
  // --no-offline: an offline audit returns an empty report and would pass.
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json', '--no-offline'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`could not run npm audit: ${result.error.message}`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    const stderr = String(result.stderr).slice(0, 500);
    fail(`npm audit did not return JSON (exit ${String(result.status)}): ${stderr}`);
  }
  if (!isRecord(report)) fail('npm audit returned an unexpected shape');
  if ('error' in report) {
    const message = typeof report.message === 'string' ? `${report.message} ` : '';
    fail(`npm audit failed: ${message}${JSON.stringify(report.error).slice(0, 500)}`);
  }
  if (report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)) {
    fail('unsupported npm audit report format (expected auditReportVersion 2)');
  }
  const totals = isRecord(report.metadata) ? report.metadata.vulnerabilities : undefined;
  const entryCount = Object.keys(report.vulnerabilities).length;
  if (!isRecord(totals) || totals.total !== entryCount) {
    fail('npm audit report totals do not match its vulnerability entries');
  }
  return report.vulnerabilities;
}

function collectAdvisories(vulnerabilities) {
  const advisories = new Map();
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!isRecord(entry) || !Array.isArray(entry.via) || entry.via.length === 0) {
      fail(`unexpected audit entry for ${name}`);
    }
    for (const via of entry.via) {
      // A string names another vulnerable package; its own entry lists the advisory.
      if (typeof via === 'string') {
        if (!Object.hasOwn(vulnerabilities, via)) {
          fail(`audit entry ${name} points at ${via}, which has no entry of its own`);
        }
        continue;
      }
      if (!isRecord(via) || !isNonEmptyString(via.url) || !isNonEmptyString(via.name)) {
        fail(`unexpected advisory record under ${name}`);
      }
      const id = advisoryId(via.url);
      const key = `${id} ${via.name}`;
      if (!advisories.has(key)) {
        advisories.set(key, {
          id,
          pkg: via.name,
          severity: typeof via.severity === 'string' ? via.severity : 'unknown',
          title: typeof via.title === 'string' ? via.title : '(no title)',
          url: via.url,
        });
      }
    }
  }
  return [...advisories.values()];
}

const options = parseArgs(process.argv.slice(2));
const now = Date.now();
const today = isoDay(now);
const latestExpiry = isoDay(now + MAX_EXCEPTION_DAYS * DAY_MS);
const allowlist = loadAllowlist(options.allowlist, today, latestExpiry);
const advisories = collectAdvisories(runAudit(path.resolve(options.dir)));
const threshold = severityRank(options.level);

const relevant = advisories.filter((advisory) => severityRank(advisory.severity) >= threshold);
const blocking = [];
const usedEntries = new Set();
let expired = 0;

for (const advisory of relevant) {
  const entry = allowlist.find((item) => item.id === advisory.id && item.pkg === advisory.pkg);
  const label = `${advisory.id} ${advisory.severity} ${advisory.pkg}: ${advisory.title}`;
  if (entry === undefined) {
    blocking.push(advisory);
    console.log(`  BLOCK  ${label} (${advisory.url})`);
    continue;
  }
  usedEntries.add(entry);
  if (entry.expired) {
    expired += 1;
    console.log(`  EXPIRED ${label}: allowlist entry expired ${entry.expires}, review it again`);
  } else {
    console.log(`  ALLOW  ${label}: until ${entry.expires}, ${entry.reason}`);
  }
}

for (const entry of allowlist) {
  if (!usedEntries.has(entry)) {
    warn(`allowlist entry ${entry.id} (${entry.pkg}) matches no current advisory; remove it`);
  }
}

const where = options.dir === '.' ? 'root' : options.dir;
const summary =
  `audit-gate: ${where}: ${advisories.length} production advisories, ` +
  `${relevant.length} at ${options.level} or above, ${blocking.length} blocking, ` +
  `${expired} expired exceptions`;
console.log(summary);
if (blocking.length > 0 || expired > 0) {
  const hint = 'Update the dependency, or add a dated entry with a reason to audit-allowlist.json.';
  console.error(`audit-gate: FAIL. ${hint}`);
  process.exit(1);
}
console.log('audit-gate: OK');
