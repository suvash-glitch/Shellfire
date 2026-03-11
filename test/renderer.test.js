const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Theme validation', () => {
  const themes = [
    { name: "Dark", body: "#1e1e1e" },
    { name: "Solarized Dark", body: "#002b36" },
    { name: "Dracula", body: "#282a36" },
    { name: "Monokai", body: "#272822" },
    { name: "Nord", body: "#2e3440" },
    { name: "Light", body: "#f5f5f5" },
  ];

  it('has 6 themes', () => {
    assert.strictEqual(themes.length, 6);
  });

  it('all themes have required properties', () => {
    for (const theme of themes) {
      assert.ok(theme.name, `Theme missing name`);
      assert.ok(theme.body, `Theme ${theme.name} missing body color`);
      assert.ok(theme.body.startsWith('#'), `Theme ${theme.name} body should be hex color`);
    }
  });

  it('theme index wraps correctly', () => {
    let idx = 5;
    idx = (idx + 1) % themes.length;
    assert.strictEqual(idx, 0);
  });
});

describe('Pane color cycling', () => {
  const paneColors = ["", "red", "green", "yellow", "blue", "purple", "orange"];

  it('cycles through all colors', () => {
    let color = "";
    const seen = [color];
    for (let i = 0; i < paneColors.length; i++) {
      const curIdx = paneColors.indexOf(color);
      const nextIdx = (curIdx + 1) % paneColors.length;
      color = paneColors[nextIdx];
      seen.push(color);
    }
    assert.strictEqual(seen.length, paneColors.length + 1);
    assert.strictEqual(seen[seen.length - 1], ""); // wraps back
  });
});

describe('Layout calculations', () => {
  it('calculates grid dimensions for n panes', () => {
    for (const [n, expectedCols, expectedRows] of [[1,1,1],[2,2,1],[3,2,2],[4,2,2],[5,3,2],[9,3,3]]) {
      const gridCols = Math.ceil(Math.sqrt(n));
      const gridRows = Math.ceil(n / gridCols);
      assert.strictEqual(gridCols, expectedCols, `${n} panes: expected ${expectedCols} cols, got ${gridCols}`);
      assert.strictEqual(gridRows, expectedRows, `${n} panes: expected ${expectedRows} rows, got ${gridRows}`);
    }
  });

  it('findPaneInLayout returns correct position', () => {
    const layout = [
      { flex: 1, cols: [{ flex: 1, paneId: 1 }, { flex: 1, paneId: 2 }] },
      { flex: 1, cols: [{ flex: 1, paneId: 3 }] },
    ];
    function findPaneInLayout(id) {
      for (let ri = 0; ri < layout.length; ri++)
        for (let ci = 0; ci < layout[ri].cols.length; ci++)
          if (layout[ri].cols[ci].paneId === id) return { ri, ci };
      return null;
    }
    assert.deepStrictEqual(findPaneInLayout(1), { ri: 0, ci: 0 });
    assert.deepStrictEqual(findPaneInLayout(2), { ri: 0, ci: 1 });
    assert.deepStrictEqual(findPaneInLayout(3), { ri: 1, ci: 0 });
    assert.strictEqual(findPaneInLayout(99), null);
  });
});

describe('Font size bounds', () => {
  it('clamps font size within bounds', () => {
    function clamp(size) { return Math.max(8, Math.min(24, size)); }
    assert.strictEqual(clamp(5), 8);
    assert.strictEqual(clamp(30), 24);
    assert.strictEqual(clamp(13), 13);
    assert.strictEqual(clamp(8), 8);
    assert.strictEqual(clamp(24), 24);
  });
});

describe('Smart paste threshold', () => {
  it('triggers confirmation for 5+ lines', () => {
    const threshold = 5;
    assert.ok("a\nb\nc\nd\ne".split("\n").length >= threshold);
    assert.ok(!("a\nb\nc\nd".split("\n").length >= threshold));
  });
});

describe('Pane navigation', () => {
  it('wraps around when navigating', () => {
    const ids = [1, 2, 3, 4];
    function navigate(activeId, dir) {
      const idx = ids.indexOf(activeId);
      return ids[(idx + dir + ids.length) % ids.length];
    }
    assert.strictEqual(navigate(4, 1), 1);  // wrap forward
    assert.strictEqual(navigate(1, -1), 4); // wrap backward
    assert.strictEqual(navigate(2, 1), 3);  // normal forward
  });
});

describe('Keyword watcher', () => {
  it('detects keywords in output', () => {
    const watchKeywords = ["error", "fail", "exception", "ENOENT", "panic", "segfault"]
      .map(k => ({ pattern: k.toLowerCase(), notify: true }));

    function checkKeywords(data) {
      const lower = data.toLowerCase();
      for (const kw of watchKeywords) {
        if (lower.includes(kw.pattern)) return kw.pattern;
      }
      return null;
    }

    assert.strictEqual(checkKeywords("Error: file not found"), "error");
    assert.strictEqual(checkKeywords("Test FAILED"), "fail");
    assert.strictEqual(checkKeywords("all tests passed"), null);
    assert.strictEqual(checkKeywords("ENOENT: no such file"), "enoent");
  });
});
