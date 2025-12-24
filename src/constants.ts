import * as vscode from 'vscode';

// Supported control file types for diagnostics/recursion.
export const CONTROL_FILE_EXTENSIONS = new Set(['.tcf', '.tgc', '.tbc', '.trd', '.ecf', '.qcf', '.tef']);
// Severity used when summarizing child-file issues on the parent reference line.
export const ISSUE_SUMMARY_SEVERITY = vscode.DiagnosticSeverity.Warning;
// Extensions eligible for latest-version checks (control files only; data files are excluded). Data files are checked elsewhere.
export const LATEST_CHECK_CONTROL_EXTENSIONS = new Set(['.tcf', '.tgc', '.tbc', '.trd', '.ecf', '.qcf']);
// Matches scenario/event tokens embedded in filenames (e.g. ~s1~, ~e4~).
export const SCENARIO_EVENT_TOKEN_REGEX = /~[se][1-9]~/gi;
