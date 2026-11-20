// ARCHIVE — reference only. District-deployed Apps Script sink (v1). Extracted verbatim from the
// EMBEDDED_APPS_SCRIPT_TEMPLATE string in dist/ui/options.js line 820 @ commit 989c95a.
// Known problems: see README.md (anyone can write; full-sheet scan under a lock per request).

/**
 * RaiseMark AI Search Guard — District-Owned Zero-PII Analytics Sink
 *
 * Deployment Instructions:
 * 1. Create a Google Sheet inside your school district's Google Workspace.
 * 2. Open Extensions -> Apps Script and paste this entire file into Code.gs.
 * 3. (Optional) Set SHARED_TOKEN below to match `analyticsSharedToken` in your
 *    Google Admin Console extension policy JSON.
 * 4. Click Deploy -> New deployment -> Web app:
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5. Copy the resulting https://script.google.com/macros/s/<ID>/exec URL into
 *    the RaiseMark AI Search Guard Admin Policy Generator.
 *
 * Privacy Guarantee:
 * - Strictly allowlists aggregate counts only (zero PII, zero search queries,
 *   zero student emails, zero device IDs, zero IP logging).
 * - Rejects any payload containing unexpected or non-allowlisted fields.
 */

var SHARED_TOKEN = '';
var DAILY_SHEET_NAME = 'Daily_Rollup';
var ERROR_SHEET_NAME = 'Error_Summary';
var MAX_COUNT_PER_BATCH = 100000;

var ALLOWED_TOP_LEVEL_KEYS = [
  'schemaVersion',
  'extensionVersion',
  'token',
  'gradeBand',
  'dateBucket',
  'metrics',
  'errors',
];

var ALLOWED_GRADE_BANDS = ['K-2', '3-5', '6-8', '9-12', 'Staff', 'Unassigned'];

var ALLOWED_METRIC_KEYS = [
  'overviewsHidden',
  'aiModeUiHidden',
  'aiModeRedirects',
  'omniboxFallbackRedirects',
  'auxAiHidden',
];

var ALLOWED_ERROR_CODES = [
  'ERR_POLICY_INVALID',
  'ERR_DNR_SYNC_FAILED',
  'ERR_SELECTOR_SYNTAX',
  'ERR_SAFETY_GUARD_TRIPPED',
  'ERR_ANALYTICS_ENDPOINT_INVALID',
  'ERR_ANALYTICS_FLUSH_FAILED',
  'ERR_STORAGE_FAILURE',
  'WARN_NO_MANAGED_POLICY',
  'WARN_OMNIBOX_POLICY_MISSING',
];

var DAILY_HEADERS = [
  'Date',
  'GradeBand',
  'ExtensionVersion',
  'OverviewsHidden',
  'AiModeUiHidden',
  'AiModeRedirects',
  'OmniboxFallbackRedirects',
  'AuxAiHidden',
  'ReportingBatches',
];

var ERROR_HEADERS = ['Date', 'GradeBand', 'ErrorCode', 'Count'];

function doGet() {
  return jsonResponse_({
    status: 'ok',
    service: 'RaiseMark AI Search Guard Analytics Sink',
    message: 'Endpoint is active. Submit anonymous daily aggregates via HTTP POST.',
  });
}

function doPost(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    return jsonResponse_({ status: 'error', code: 'EMPTY_BODY' });
  }

  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (_err) {
    return jsonResponse_({ status: 'error', code: 'INVALID_JSON' });
  }

  if (!isPlainObject_(payload)) {
    return jsonResponse_({ status: 'error', code: 'INVALID_PAYLOAD' });
  }

  if (typeof SHARED_TOKEN === 'string' && SHARED_TOKEN.length > 0) {
    if (typeof payload.token !== 'string' || payload.token !== SHARED_TOKEN) {
      return jsonResponse_({ status: 'error', code: 'UNAUTHORIZED' });
    }
  }

  var validation = validatePayload_(payload);
  if (!validation.ok) {
    return jsonResponse_({
      status: 'error',
      code: validation.code,
      message: validation.message,
    });
  }

  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    lock.waitLock(15000);
    lockAcquired = true;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    upsertDailyRollup_(ss, validation.data);
    upsertErrorSummary_(ss, validation.data);

    return jsonResponse_({ status: 'ok' });
  } catch (err) {
    return jsonResponse_({
      status: 'error',
      code: lockAcquired ? 'WRITE_FAILED' : 'LOCK_TIMEOUT',
      message: err && err.message ? String(err.message) : 'Unexpected server error',
    });
  } finally {
    if (lockAcquired) {
      lock.releaseLock();
    }
  }
}

function isPlainObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidCount_(value) {
  return (
    typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value &&
    value >= 0 &&
    value <= MAX_COUNT_PER_BATCH
  );
}

function validatePayload_(payload) {
  var topKeys = Object.keys(payload);
  for (var i = 0; i < topKeys.length; i++) {
    if (ALLOWED_TOP_LEVEL_KEYS.indexOf(topKeys[i]) === -1) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Unexpected field rejected by zero-PII allowlist',
      };
    }
  }

  if (payload.schemaVersion !== 1) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Unsupported schemaVersion' };
  }

  if (
    typeof payload.extensionVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(payload.extensionVersion)
  ) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid extensionVersion' };
  }

  if (payload.token !== undefined && typeof payload.token !== 'string') {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid token type' };
  }

  if (
    typeof payload.gradeBand !== 'string' ||
    ALLOWED_GRADE_BANDS.indexOf(payload.gradeBand) === -1
  ) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid gradeBand' };
  }

  if (typeof payload.dateBucket !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.dateBucket)) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid dateBucket' };
  }

  if (!isPlainObject_(payload.metrics)) {
    return { ok: false, code: 'INVALID_PAYLOAD', message: 'Missing or invalid metrics object' };
  }

  var metricKeys = Object.keys(payload.metrics);
  for (var m = 0; m < metricKeys.length; m++) {
    if (ALLOWED_METRIC_KEYS.indexOf(metricKeys[m]) === -1) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Unexpected metric key rejected by allowlist',
      };
    }
  }

  var cleanMetrics = {};
  for (var k = 0; k < ALLOWED_METRIC_KEYS.length; k++) {
    var mKey = ALLOWED_METRIC_KEYS[k];
    var mVal = payload.metrics[mKey];
    if (mVal === undefined) {
      cleanMetrics[mKey] = 0;
    } else if (!isValidCount_(mVal)) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid metric value' };
    } else {
      cleanMetrics[mKey] = mVal;
    }
  }

  var cleanErrors = {};
  if (payload.errors !== undefined) {
    if (!isPlainObject_(payload.errors)) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid errors object' };
    }
    var errKeys = Object.keys(payload.errors);
    for (var eIdx = 0; eIdx < errKeys.length; eIdx++) {
      var errCode = errKeys[eIdx];
      if (ALLOWED_ERROR_CODES.indexOf(errCode) === -1) {
        return {
          ok: false,
          code: 'INVALID_PAYLOAD',
          message: 'Unexpected error code rejected by allowlist',
        };
      }
      var errVal = payload.errors[errCode];
      if (!isValidCount_(errVal)) {
        return { ok: false, code: 'INVALID_PAYLOAD', message: 'Invalid error count' };
      }
      if (errVal > 0) {
        cleanErrors[errCode] = errVal;
      }
    }
  }

  return {
    ok: true,
    data: {
      schemaVersion: 1,
      extensionVersion: payload.extensionVersion,
      gradeBand: payload.gradeBand,
      dateBucket: payload.dateBucket,
      metrics: cleanMetrics,
      errors: cleanErrors,
    },
  };
}

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function normalizeDateCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function upsertDailyRollup_(ss, data) {
  var sheet = getOrCreateSheet_(ss, DAILY_SHEET_NAME, DAILY_HEADERS);
  var lastRow = sheet.getLastRow();
  var m = data.metrics;

  if (lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, DAILY_HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (
        normalizeDateCell_(row[0]) === data.dateBucket &&
        String(row[1]) === data.gradeBand &&
        String(row[2]) === data.extensionVersion
      ) {
        var updated = [
          data.dateBucket,
          data.gradeBand,
          data.extensionVersion,
          (Number(row[3]) || 0) + m.overviewsHidden,
          (Number(row[4]) || 0) + m.aiModeUiHidden,
          (Number(row[5]) || 0) + m.aiModeRedirects,
          (Number(row[6]) || 0) + m.omniboxFallbackRedirects,
          (Number(row[7]) || 0) + m.auxAiHidden,
          (Number(row[8]) || 0) + 1,
        ];
        sheet.getRange(i + 2, 1, 1, DAILY_HEADERS.length).setValues([updated]);
        return;
      }
    }
  }

  sheet.appendRow([
    data.dateBucket,
    data.gradeBand,
    data.extensionVersion,
    m.overviewsHidden,
    m.aiModeUiHidden,
    m.aiModeRedirects,
    m.omniboxFallbackRedirects,
    m.auxAiHidden,
    1,
  ]);
}

function upsertErrorSummary_(ss, data) {
  var sheet = getOrCreateSheet_(ss, ERROR_SHEET_NAME, ERROR_HEADERS);
  var errorCodes = Object.keys(data.errors);
  if (errorCodes.length === 0) {
    return;
  }

  for (var idx = 0; idx < errorCodes.length; idx++) {
    var code = errorCodes[idx];
    var count = data.errors[code];
    if (!count || count <= 0) {
      continue;
    }

    var lastRow = sheet.getLastRow();
    var matched = false;
    if (lastRow > 1) {
      var rows = sheet.getRange(2, 1, lastRow - 1, ERROR_HEADERS.length).getValues();
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        if (
          normalizeDateCell_(row[0]) === data.dateBucket &&
          String(row[1]) === data.gradeBand &&
          String(row[2]) === code
        ) {
          var updated = [data.dateBucket, data.gradeBand, code, (Number(row[3]) || 0) + count];
          sheet.getRange(r + 2, 1, 1, ERROR_HEADERS.length).setValues([updated]);
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      sheet.appendRow([data.dateBucket, data.gradeBand, code, count]);
    }
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
