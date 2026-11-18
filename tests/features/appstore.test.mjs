// The Mac App Store build: its Rust side sets window.__COWDREY_APP_STORE__ before the page loads. The App Store
// updates the app, so it has no Check for updates and never checks GitHub or offers a download.
export default async (h) => {
  const { test, eq, ok, open, openPdf, macApp } = h;
  // The pretend Mac app, as the App Store build or the Developer ID build, with fetch recorded and a clock 2 days on
  // from the last update check, so the automatic check would run 8 seconds after launch.
  const mac = (store) => {
    const [fn, arg] = macApp();
    return [(o) => {
      (0, eval)(o.fn)(o.arg);
      if (o.store) window.__COWDREY_APP_STORE__ = true;
      window.__fetched = [];
      const f = window.fetch;
      window.fetch = (u, ...r) => { window.__fetched.push(String(u)); return f(u, ...r); };
      window.__TAURI__.updater = { check: async () => { window.__fetched.push('updater.check'); return null; } };
    }, { fn: fn.toString(), arg, store }];
  };
  const helpItems = (p) => p.evaluate(() => (window.__calls.filter(([c]) => c === 'set_menu').pop() || [, { menus: [] }])[1].menus.find((m) => m.title === 'Help').items.map((i) => i.id || i.kind));

  await test('Mac App Store build: no Check for updates in Help or the menu bar, and no update check', async () => {
    const p = await open({ init: mac(true) }); await openPdf(p);
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdShown('checkUpdates')), false, 'command hidden');
    await p.waitForFunction(() => window.__calls.some(([c]) => c === 'set_menu'));
    ok(!(await helpItems(p)).some((id) => /checkUpdates/.test(id)), 'not in the Help menu: ' + (await helpItems(p)));
    await p.click('#helpBtn').catch(() => {});
    ok(!(await p.$('#popover:not([hidden]) [data-cmd="checkUpdates"]')), 'not in the in-app Help menu');
    await p.keyboard.press('Escape');
    await p.evaluate(() => window.__cowdreyPdf.run && window.__cowdreyPdf.run('checkUpdates'));
    await p.waitForTimeout(300);
    eq(await p.evaluate(() => window.__fetched.filter((u) => /github|updater/.test(u))), [], 'never asks GitHub or the updater');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Developer ID build: Check for updates is still there and asks the updater', async () => {
    const p = await open({ init: mac(false) }); await openPdf(p);
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdShown('checkUpdates')), true, 'command shown');
    await p.evaluate(() => window.__cowdreyPdf.run('checkUpdates'));
    await p.waitForFunction(() => window.__fetched.includes('updater.check'));
    eq(p.errors, []); await p.ctx.close();
  });
};
