const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ============================================================
// Re-implement helpers from main.js for direct testing
// ============================================================
function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function sanitizePath(p) {
  if (typeof p !== "string") return null;
  if (p.includes("\0")) return null;
  const resolved = path.resolve(p);
  if (p.includes("../") || p.includes("..\\")) return null;
  return resolved;
}

// Pipeline step validation (mirrors main.js exec-pipeline-step handler)
function validatePipelineStep(command, cwd) {
  if (typeof command !== "string" || command.trim().length === 0) {
    return { valid: false, error: "Invalid command" };
  }
  const resolvedCwd = cwd ? sanitizePath(cwd) : os.homedir();
  if (!resolvedCwd) {
    return { valid: false, error: "Invalid working directory" };
  }
  return { valid: true, command: command.trim(), cwd: resolvedCwd };
}

// Config merge with defaults (mirrors load-config behavior)
function mergeConfigWithDefaults(loaded) {
  const defaults = { theme: 0, fontSize: 13 };
  return { ...defaults, ...loaded };
}

// Port listing output format validation
function validatePortEntry(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.port === 'string' &&
    typeof entry.pid === 'string' &&
    typeof entry.process === 'string' &&
    typeof entry.protocol === 'string'
  );
}

const tmpDir = os.tmpdir();

// ============================================================
// Tests
// ============================================================

describe('readJSON / writeJSON', () => {
  it('reads valid JSON file', () => {
    const tmpFile = path.join(tmpDir, `terminator-ipc-test-${Date.now()}-1.json`);
    fs.writeFileSync(tmpFile, '{"key": "value"}');
    const result = readJSON(tmpFile, null);
    assert.deepStrictEqual(result, { key: 'value' });
    fs.unlinkSync(tmpFile);
  });

  it('returns fallback for corrupt JSON', () => {
    const tmpFile = path.join(tmpDir, `terminator-ipc-test-${Date.now()}-2.json`);
    fs.writeFileSync(tmpFile, '{broken json!!!');
    const result = readJSON(tmpFile, { fallback: true });
    assert.deepStrictEqual(result, { fallback: true });
    fs.unlinkSync(tmpFile);
  });

  it('returns fallback for missing file', () => {
    const result = readJSON(path.join(tmpDir, `nonexistent-${Date.now()}.json`), []);
    assert.deepStrictEqual(result, []);
  });

  it('roundtrips empty object', () => {
    const tmpFile = path.join(tmpDir, `terminator-ipc-test-${Date.now()}-3.json`);
    writeJSON(tmpFile, {});
    const result = readJSON(tmpFile, null);
    assert.deepStrictEqual(result, {});
    fs.unlinkSync(tmpFile);
  });

  it('roundtrips nested data', () => {
    const tmpFile = path.join(tmpDir, `terminator-ipc-test-${Date.now()}-4.json`);
    const data = { sessions: [{ id: 1, name: 'test', nested: { deep: true } }] };
    writeJSON(tmpFile, data);
    const result = readJSON(tmpFile, null);
    assert.deepStrictEqual(result, data);
    fs.unlinkSync(tmpFile);
  });

  it('roundtrips array data', () => {
    const tmpFile = path.join(tmpDir, `terminator-ipc-test-${Date.now()}-5.json`);
    const data = ['snippet1', 'snippet2'];
    writeJSON(tmpFile, data);
    const result = readJSON(tmpFile, null);
    assert.deepStrictEqual(result, data);
    fs.unlinkSync(tmpFile);
  });
});

describe('Session save/restore data format', () => {
  it('v2 session roundtrips through JSON serialization', () => {
    const session = {
      version: 2,
      layout: [{ flex: 1, cols: [{ flex: 1, paneId: 1 }] }],
      paneStates: [{ cwd: '/tmp', customName: 'test', color: 'red', locked: false, rawBuffer: 'hello\r\n' }],
      theme: 0,
      fontSize: 13,
      broadcastMode: false,
      skipPermissions: false,
    };
    const json = JSON.stringify(session);
    const restored = JSON.parse(json);
    assert.deepStrictEqual(restored, session);
    assert.strictEqual(restored.version, 2);
  });

  it('session with multiple panes preserves all pane states', () => {
    const session = {
      version: 2,
      layout: [{ flex: 1, cols: [{ flex: 1, paneId: 1 }, { flex: 1, paneId: 2 }] }],
      paneStates: [
        { cwd: '/home', customName: null, color: '', locked: false, rawBuffer: '' },
        { cwd: '/tmp', customName: 'logs', color: 'green', locked: true, rawBuffer: 'data' },
      ],
      theme: 3,
      fontSize: 15,
      broadcastMode: true,
      skipPermissions: false,
    };
    const restored = JSON.parse(JSON.stringify(session));
    assert.strictEqual(restored.paneStates.length, 2);
    assert.strictEqual(restored.paneStates[1].locked, true);
    assert.strictEqual(restored.broadcastMode, true);
  });

  it('v1 fallback format with cwds array', () => {
    const v1 = { cwds: ['/home/user', '/var/log'] };
    const restored = JSON.parse(JSON.stringify(v1));
    assert.ok(Array.isArray(restored.cwds));
    assert.strictEqual(restored.cwds.length, 2);
    assert.strictEqual(restored.version, undefined);
  });
});

describe('Config merge with defaults', () => {
  it('empty loaded config gets all defaults', () => {
    const result = mergeConfigWithDefaults({});
    assert.strictEqual(result.theme, 0);
    assert.strictEqual(result.fontSize, 13);
  });

  it('loaded values override defaults', () => {
    const result = mergeConfigWithDefaults({ theme: 3, fontSize: 16 });
    assert.strictEqual(result.theme, 3);
    assert.strictEqual(result.fontSize, 16);
  });

  it('partial load preserves unset defaults', () => {
    const result = mergeConfigWithDefaults({ theme: 5 });
    assert.strictEqual(result.theme, 5);
    assert.strictEqual(result.fontSize, 13);
  });

  it('extra keys from loaded config are preserved', () => {
    const result = mergeConfigWithDefaults({ fontFamily: 'Fira Code' });
    assert.strictEqual(result.fontFamily, 'Fira Code');
    assert.strictEqual(result.theme, 0);
  });
});

describe('Pipeline step validation', () => {
  it('accepts valid command with default cwd', () => {
    const result = validatePipelineStep('echo hello', null);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.command, 'echo hello');
    assert.strictEqual(result.cwd, os.homedir());
  });

  it('accepts valid command with explicit cwd', () => {
    const tmpDir = os.tmpdir();
    const result = validatePipelineStep('ls -la', tmpDir);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.cwd, path.resolve(tmpDir));
  });

  it('rejects empty string command', () => {
    const result = validatePipelineStep('', null);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Invalid command');
  });

  it('rejects whitespace-only command', () => {
    const result = validatePipelineStep('   ', null);
    assert.strictEqual(result.valid, false);
  });

  it('rejects null command', () => {
    const result = validatePipelineStep(null, null);
    assert.strictEqual(result.valid, false);
  });

  it('rejects numeric command', () => {
    const result = validatePipelineStep(42, null);
    assert.strictEqual(result.valid, false);
  });

  it('rejects traversal in cwd', () => {
    const result = validatePipelineStep('ls', '../../etc');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Invalid working directory');
  });
});

describe('Port listing output format', () => {
  it('validates well-formed port entry', () => {
    const entry = { port: '3000', pid: '1234', process: 'node', protocol: 'TCP' };
    assert.strictEqual(validatePortEntry(entry), true);
  });

  it('rejects entry with numeric port (must be string)', () => {
    const entry = { port: 3000, pid: '1234', process: 'node', protocol: 'TCP' };
    assert.strictEqual(validatePortEntry(entry), false);
  });

  it('rejects null entry', () => {
    assert.strictEqual(validatePortEntry(null), false);
  });

  it('rejects entry missing process field', () => {
    const entry = { port: '80', pid: '1', protocol: 'TCP' };
    assert.strictEqual(validatePortEntry(entry), false);
  });
});
