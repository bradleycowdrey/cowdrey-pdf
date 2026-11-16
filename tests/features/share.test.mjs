// Sharing: Share app (the title bar, Help, More on a phone) and Share… for the document on the web.
export default async (h) => {
  const { test, eq, ok, open, openPdf, macApp, calls, waitPages, fixture } = h;
  const APP_URL = 'https://bradcowdrey.com/cowdrey-pdf', MAC_URL = 'https://github.com/bradleycowdrey/cowdrey-pdf/releases/latest', IOS_URL = 'https://testflight.apple.com/join/tr4eD534';
  const BLURB = 'Cowdrey.PDF is a free PDF editor by Bradley Cowdrey. Free. Forever. Pass it on to anyone who works with PDFs.';
  // A browser with a clipboard that records, and with or without a share sheet (and file sharing).
  const browser = (o = {}) => [(o) => {
    window.__clip = []; window.__shared = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip.push(t); } } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: o.share ? async (d) => {
      const f = d.files && d.files[0];
      window.__shared.push({ title: d.title, text: d.text, url: d.url, file: f && { name: f.name, type: f.type, size: f.size, head: new TextDecoder().decode(new Uint8Array(await f.arrayBuffer()).slice(0, 5)) } });
      if (o.fail && !(o.once && window.__shared.length > 1)) { const e = new Error(o.fail); e.name = o.fail; throw e; }
    } : undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: o.files ? (d) => !!(d && d.files && d.files.every((f) => f.type === 'application/pdf')) : o.share ? (d) => !(d && d.files) : undefined });
  }, o];
  const items = (p) => p.$$eval('#popover [data-share]', (b) => b.map((x) => [x.dataset.share, x.textContent.trim()]));
  const toastText = (p) => p.waitForFunction(() => document.querySelector('#toast').textContent).then(() => p.textContent('#toast'));

  await test('share: Share app sits between the theme and Open; its options copy the link, the Mac link and a message', async () => {
    const p = await open({ init: browser() }); await openPdf(p);
    const b = '#shareAppBtn';
    eq(await p.$eval(b, (x) => [x.previousElementSibling.id, x.nextElementSibling.dataset.cmd, x.textContent.trim(), x.title, x.getAttribute('aria-haspopup')]), ['themeBtn', 'open', 'Share app', 'Share Cowdrey.PDF with someone', 'menu']);
    await p.click(b); await p.waitForSelector('#popover:not([hidden])');
    eq(await p.$eval(b, (x) => x.getAttribute('aria-expanded')), 'true');
    eq(await p.textContent('#popover .share-head'), 'Share Cowdrey.PDF');
    eq(await p.textContent('#popover .share-blurb'), BLURB);
    eq(await p.$eval('#popover', (x) => [x.getAttribute('aria-label'), x.getAttribute('aria-describedby')]), ['Share Cowdrey.PDF', 'shareBlurb']);
    eq(await items(p), [['web', 'Copy link to the web app'], ['mac', 'Copy Mac download link'], ['message', 'Copy a message to send']], 'no Share… without a share sheet');
    eq(await p.evaluate(() => document.activeElement.dataset.share), 'web', 'focus in the menu');
    const pb = await p.locator('#popover').boundingBox(); ok(pb.x + pb.width <= 1440, 'in view');
    await p.keyboard.press('Escape');
    eq(await p.evaluate(() => [document.activeElement.id, document.querySelector('#shareAppBtn').getAttribute('aria-expanded')]), ['shareAppBtn', 'false'], 'Escape: focus back');
    const want = { web: [APP_URL, 'Link to Cowdrey.PDF copied'], mac: [MAC_URL, 'Mac download link copied'], message: [`Cowdrey.PDF is a free PDF editor by Bradley Cowdrey. Free. Forever.\n\nUse it in your browser: ${APP_URL}\nGet it for Mac: ${MAC_URL}\nGet it for iPhone and iPad: ${IOS_URL}`, 'Message copied, ready to paste'] };
    for (const [kind, [text, said]] of Object.entries(want)) {
      await p.evaluate(() => { window.__clip.length = 0; document.querySelector('#toast').textContent = ''; });
      await p.click(b); await p.click(`#popover [data-share="${kind}"]`);
      await p.waitForFunction(() => window.__clip.length);
      eq(await p.evaluate(() => window.__clip), [text], kind);
      eq(await toastText(p), said, kind + ' toast');
      ok(await p.$eval('#popover', (x) => x.hidden), kind + ': closed');
    }
    // the keyboard: Down opens it from the button
    await p.focus(b); await p.keyboard.press('ArrowDown'); await p.waitForSelector('#popover:not([hidden])');
    eq(await p.evaluate(() => document.activeElement.dataset.share), 'web');
    await p.keyboard.press('Escape');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('share: Share… in Share app only with a share sheet, and it shares the link; Help (?) has Share Cowdrey.PDF…', async () => {
    const p = await open({ init: browser({ share: true }) }); await openPdf(p);
    await p.click('#helpBtn'); await p.waitForSelector('#popover:not([hidden])');
    const help = await p.$$eval('#popover [data-cmd]', (b) => b.map((x) => [x.dataset.cmd, x.textContent.trim()]));
    eq(help[help.length - 1], ['shareApp', 'Share Cowdrey.PDF…'], 'last in Help');
    await p.click('#popover [data-cmd="shareApp"]'); await p.waitForSelector('#popover .share-head');
    eq(await p.$eval('#shareAppBtn', (x) => x.getAttribute('aria-expanded')), 'true', 'opens under Share app');
    eq((await items(p)).map(([k]) => k), ['native', 'web', 'mac', 'message']);
    eq(await p.textContent('#popover [data-share="native"]'), 'Share…');
    await p.click('#popover [data-share="native"]'); await p.waitForFunction(() => window.__shared.length);
    eq(await p.evaluate(() => window.__shared), [{ title: 'Cowdrey.PDF', text: 'Cowdrey.PDF is a free PDF editor by Bradley Cowdrey. Free. Forever.', url: APP_URL }]);
    eq(await p.evaluate(() => window.__clip), [], 'nothing copied');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('share: on the web, Share… for the document only where the browser shares PDF files; it shares the saved PDF', async () => {
    const shownIn = async (p) => {
      const r = { cmd: await p.evaluate(() => window.__cowdreyPdf.cmdShown('share')) };
      await p.click('#fileBtn'); await p.waitForSelector('#popover:not([hidden])');
      r.file = !!(await p.$('#popover [data-cmd="share"]')); await p.keyboard.press('Escape');
      await p.click('[data-rt="export"]'); r.ribbon = !!(await p.$('#ribbonBody [data-cmd="share"]'));
      return r;
    };
    for (const o of [{}, { share: true }]) {
      const p = await open({ init: browser(o) }); await openPdf(p);
      eq(await shownIn(p), { cmd: false, file: false, ribbon: false }, 'hidden: ' + JSON.stringify(o));
      eq(p.errors, []); await p.ctx.close();
    }
    const p = await open({ init: browser({ share: true, files: true }) }); await openPdf(p);
    eq(await shownIn(p), { cmd: true, file: true, ribbon: true }, 'shown where PDF files can be shared');
    await p.click('[data-rt="home"]'); await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(200);
    await p.click('[data-rt="export"]'); await p.click('#ribbonBody [data-cmd="share"]');
    await p.waitForFunction(() => window.__shared.length, null, { timeout: 10000 });
    const s = (await p.evaluate(() => window.__shared))[0];
    eq([s.title, s.file.name, s.file.type, s.file.head], ['Quarterly report', 'Quarterly report.pdf', 'application/pdf', '%PDF-']);
    ok(s.file.size > 1000, 'the whole PDF');
    eq(p.errors, []); await p.ctx.close();
    // cancelled: nothing said; failed: points to Save PDF
    for (const [fail, said] of [['AbortError', ''], ['DataError', 'Could not share this PDF. Use Save PDF to save it, then send it.']]) {
      const q = await open({ init: browser({ share: true, files: true, fail }) }); await openPdf(q);
      await q.evaluate(() => { document.querySelector('#toast').textContent = ''; });
      await q.evaluate(() => window.__cowdreyPdf.run('share')); await q.waitForFunction(() => window.__shared.length, null, { timeout: 10000 }); await q.waitForTimeout(300);
      eq(await q.textContent('#toast'), said, fail);
      ok(!(await q.$eval('#dialog', (d) => d.open)), fail + ': no dialog');
      await q.ctx.close();
    }
    // the click ran out while the PDF was built (NotAllowedError): a dialog asks again, and Share… there shares the same file
    for (const choice of ['Cancel', 'Share…']) {
      const q = await open({ init: browser({ share: true, files: true, fail: 'NotAllowedError', once: true }) }); await openPdf(q);
      await q.evaluate(() => { document.querySelector('#toast').textContent = ''; });
      await q.evaluate(() => window.__cowdreyPdf.run('share')); await q.waitForSelector('#dialog[open]', { timeout: 10000 });
      eq(await q.$eval('#dialog', (d) => [d.querySelector('h2').textContent, d.querySelector('.dlg-body').textContent, [...d.querySelectorAll('.dlg-foot button')].map((b) => b.textContent)]), ['Share PDF', 'Your PDF is ready to share.', ['Cancel', 'Share…']]);
      await q.click(`#dialog .dlg-foot button:text-is("${choice}")`); await q.waitForTimeout(300);
      const sh = await q.evaluate(() => window.__shared.map((x) => [x.file.name, x.file.size]));
      eq(sh.length, choice === 'Cancel' ? 1 : 2, choice);
      if (sh.length === 2) eq(sh[1], sh[0], 'the same file');
      eq(await q.textContent('#toast'), '', choice + ': no toast');
      ok(!(await q.$eval('#dialog', (d) => d.open)), 'closed');
      eq(q.errors, []); await q.ctx.close();
    }
  });

  await test('share: phone: More has Share… with the file items and Share Cowdrey.PDF… at the end; the title bar fits at 390px', async () => {
    const p = await open({ width: 390, height: 844, touch: true, init: browser({ share: true, files: true }) }); await openPdf(p);
    const fit = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const btns = [...document.querySelectorAll('.tb-actions button')].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect());
      return { right: Math.max(...btns.map((b) => b.right)) <= innerWidth, title: r('#docTitle').width, scroll: document.documentElement.scrollWidth <= innerWidth, bar: document.querySelector('.titlebar').scrollWidth <= document.querySelector('.titlebar').clientWidth, share: getComputedStyle(document.querySelector('#shareAppBtn')).display };
    });
    ok(fit.right && fit.scroll && fit.bar && fit.title > 80, JSON.stringify(fit));
    eq(fit.share, 'none', 'Share app is in More on a phone');
    await p.click('#moreBtn'); await p.waitForSelector('#popover:not([hidden])');
    const groups = await p.$$eval('#popover > [role="group"]', (g) => g.map((x) => [x.querySelector('.mh').textContent, [...x.querySelectorAll('[data-cmd]')].map((b) => b.dataset.cmd)]));
    const file = groups.find(([t]) => t === 'File')[1], help = groups[groups.length - 1];
    ok(file.includes('share'), 'Share… with the file items: ' + file);
    eq([help[0], help[1][help[1].length - 1]], ['Help', 'shareApp']);
    eq(await p.textContent('#popover [data-cmd="share"]'), 'Share…');
    await p.click('#popover [data-cmd="shareApp"]'); await p.waitForSelector('#popover .share-head');
    eq((await items(p)).map(([k]) => k), ['native', 'web', 'mac', 'message']);
    const pb = await p.locator('#popover').boundingBox(); ok(pb.x >= 0 && pb.x + pb.width <= 390, 'fits ' + JSON.stringify(pb));
    await p.keyboard.press('Escape'); eq(await p.evaluate(() => document.activeElement.id), 'moreBtn', 'focus back to More');
    await p.click('#moreBtn'); await p.click('#popover [data-cmd="share"]');
    await p.waitForFunction(() => window.__shared.length, null, { timeout: 10000 });
    eq(await p.evaluate(() => window.__shared[0].file.name), 'Quarterly report.pdf');
    eq(p.errors, []); await p.ctx.close();
    const q = await open({ width: 390, height: 844, touch: true, init: browser() }); await openPdf(q);
    await q.click('#moreBtn'); await q.waitForSelector('#popover:not([hidden])');
    const ids = await q.$$eval('#popover [data-cmd]', (b) => b.map((x) => x.dataset.cmd));
    ok(!ids.includes('share') && ids[ids.length - 1] === 'shareApp', 'no Share… where the browser cannot: ' + ids);
    await q.ctx.close();
  });

  await test('share: Mac app: Help in the menu bar has Share Cowdrey.PDF…, which shares the link with the Mac share menu', async () => {
    const p = await open({ init: macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] }) });
    await waitPages(p); await p.waitForTimeout(400);
    const menus = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu').pop()[1].menus);
    const help = menus.find((m) => m.title === 'Help').items, last = help[help.length - 1];
    eq([last.id, last.label, last.checked], ['cmd:shareApp', 'Share Cowdrey.PDF…', null]);
    ok(menus.find((m) => m.title === 'File').items.some((x) => x.id === 'cmd:share'), 'File has Share…');
    await p.evaluate(() => window.__cowdreyPdf.run('shareApp')); await p.waitForSelector('#popover .share-head');
    eq((await items(p)).map(([k]) => k), ['native', 'web', 'mac', 'message']);
    await p.click('#popover [data-share="native"]'); await p.waitForTimeout(200);
    const c = (await calls(p, /sharekit\|share_text/)).map(([, a]) => [a.text, !!a.position]);
    eq(c, [['Cowdrey.PDF is a free PDF editor by Bradley Cowdrey. Free. Forever. ' + APP_URL, true]]);
    eq(p.errors, []); await p.ctx.close();
  });
};
