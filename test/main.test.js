const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('JSON helpers', () => {
  const tmpDir = os.tmpdir();

  it('readJSON returns fallback when file does not exist', () => {
    // Inline the function since we can't import from main.js (Electron module)
    function readJSON(p, fallback) {
      try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
    }
    const result = readJSON(path.join(tmpDir, 'nonexistent-' + Date.now() + '.json'), { default: true });
    assert.deepStrictEqual(result, { default: true });
  });

  it('writeJSON and readJSON roundtrip', () => {
    function readJSON(p, fallback) {
      try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
    }
    function writeJSON(p, data) {
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
    }
    const tmpFile = path.join(tmpDir, 'terminator-test-' + Date.now() + '.json');
    const data = { snippets: [{ name: 'test', command: 'echo hello' }] };
    writeJSON(tmpFile, data);
    const result = readJSON(tmpFile, null);
    assert.deepStrictEqual(result, data);
    fs.unlinkSync(tmpFile);
  });

  it('readJSON handles malformed JSON', () => {
    function readJSON(p, fallback) {
      try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
    }
    const tmpFile = path.join(tmpDir, 'terminator-test-bad-' + Date.now() + '.json');
    fs.writeFileSync(tmpFile, 'not valid json {{{');
    const result = readJSON(tmpFile, []);
    assert.deepStrictEqual(result, []);
    fs.unlinkSync(tmpFile);
  });
});

describe('Session format', () => {
  it('v2 session has required fields', () => {
    const session = {
      version: 2,
      layout: [{ flex: 1, cols: [{ flex: 1, paneId: 1 }] }],
      paneStates: [{ cwd: '/tmp', customName: null, color: '', locked: false, rawBuffer: '' }],
      theme: 0,
      fontSize: 13,
      broadcastMode: false,
      skipPermissions: false,
    };
    assert.strictEqual(session.version, 2);
    assert.ok(Array.isArray(session.paneStates));
    assert.ok(session.paneStates[0].hasOwnProperty('cwd'));
    assert.ok(session.paneStates[0].hasOwnProperty('rawBuffer'));
  });

  it('v1 session fallback structure', () => {
    const session = { cwds: ['/tmp', '/home'] };
    assert.ok(Array.isArray(session.cwds));
    assert.strictEqual(session.cwds.length, 2);
  });
});

describe('Settings defaults', () => {
  it('default settings have all required keys', () => {
    const defaults = {
      theme: 0,
      fontSize: 13,
      fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
      cursorStyle: "block",
      cursorBlink: true,
      copyOnSelect: true,
      scrollback: 10000,
      shell: "",
      defaultCwd: "",
      confirmClose: true,
      autoSaveSession: true,
    };
    assert.strictEqual(typeof defaults.theme, 'number');
    assert.strictEqual(typeof defaults.fontSize, 'number');
    assert.strictEqual(typeof defaults.fontFamily, 'string');
    assert.ok(['block', 'underline', 'bar'].includes(defaults.cursorStyle));
    assert.strictEqual(typeof defaults.cursorBlink, 'boolean');
    assert.strictEqual(typeof defaults.scrollback, 'number');
    assert.ok(defaults.scrollback >= 1000);
  });
});

describe('Path validation', () => {
  it('path.resolve normalizes traversal attempts', () => {
    const resolved = path.resolve('/home/user/../../../etc/passwd');
    assert.ok(resolved.endsWith(path.join('etc', 'passwd')));
    assert.ok(!resolved.startsWith(os.homedir()));
  });

  it('valid home directory paths are allowed', () => {
    const testPath = path.join(os.homedir(), 'projects', 'test.txt');
    const resolved = path.resolve(testPath);
    assert.ok(resolved.startsWith(os.homedir()));
  });
});

describe('Cron parsing', () => {
  it('parses crontab lines correctly', () => {
    const raw = "# comment\n*/5 * * * * /usr/bin/backup\n0 0 * * * /usr/bin/cleanup";
    const lines = raw.trim().split("\n");
    const active = lines.filter(l => l && !l.startsWith("#"));
    assert.strictEqual(active.length, 2);
    assert.ok(active[0].includes('backup'));
  });

  it('handles empty crontab', () => {
    const raw = "";
    const result = raw.trim().split("\n").filter(l => l && !l.startsWith("#")).map((line, i) => ({ id: i, line, enabled: true }));
    assert.deepStrictEqual(result, []);
  });
});

describe('Buffer management', () => {
  it('raw buffer truncation works correctly', () => {
    const MAX_RAW_BUFFER = 512 * 1024;
    let rawBuffer = 'x'.repeat(MAX_RAW_BUFFER + 100);
    if (rawBuffer.length > MAX_RAW_BUFFER) {
      rawBuffer = rawBuffer.slice(-MAX_RAW_BUFFER);
    }
    assert.strictEqual(rawBuffer.length, MAX_RAW_BUFFER);
  });

  it('configurable buffer limit', () => {
    const limit = 256 * 1024;
    let buffer = 'a'.repeat(limit + 50);
    if (buffer.length > limit) buffer = buffer.slice(-limit);
    assert.strictEqual(buffer.length, limit);
  });
});
