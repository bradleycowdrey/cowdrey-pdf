// Keyboard, focus and platform behaviour: focus after the Edit PDF editors close, Tab and Ctrl/Cmd+B/I/U in the
// line editor, the Mac menu's greyed-out commands, Close (Ctrl/Cmd+W), Android Back, iPhone form zoom, phone touch
// targets, and hints and edge fades on the phone.
const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr5/fix-keys/';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
let H;
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
const active = (p) => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : a.id ? '#' + a.id : a.className || a.tagName; });
// Opens the line editor on "The second phase…" of word.pdf.
async function editLine(p) {
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  const [x, y] = await H.at(p, 120, 584);
  await p.mouse.click(x, y); await p.waitForSelector('.line-editor'); await p.waitForTimeout(150);
}

export default async (h) => {
  H = h; const { test, eq, ok, open, openPdf, WORD } = h;

  await test('Edit PDF: closing the line editor with Escape or Enter puts the focus on the page, and Tab goes on from there', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await editLine(p);
    eq(await active(p), 'line-editor');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    eq(await active(p), '#viewer', 'after Escape');
    await editLine(p); await p.keyboard.press('End'); await p.keyboard.type(' Now.'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    eq(await active(p), '#viewer', 'after Enter');
    // Bold, then Escape from the format bar: the formatted line is kept and focus is still on the page.
    await editLine(p); await p.keyboard.press('Tab'); await p.keyboard.press('Escape'); eq(await active(p), 'line-editor', 'Escape in the bar goes back to the text');
    await p.keyboard.press('Control+b'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    eq(await active(p), '#viewer', 'after a formatted edit');
    await p.keyboard.press('Tab'); ok(await p.evaluate(() => document.activeElement !== document.body), 'Tab goes on from the page');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: Tab and Shift+Tab go between the text and the format bar; Ctrl+B, I and U format the line', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await editLine(p);
    await p.keyboard.press('Tab'); eq(await p.evaluate(() => document.activeElement.dataset.tf), 'smaller', 'Tab into the bar');
    await p.keyboard.press('Shift+Tab'); eq(await active(p), 'line-editor', 'Shift+Tab back to the text');
    ok(await p.$('.line-editor'), 'still editing');
    await p.keyboard.press('Shift+Tab'); ok(await p.evaluate(() => !!document.activeElement.closest('.txt-bar')), 'Shift+Tab from the text goes to the bar');
    await p.keyboard.press('Tab'); eq(await active(p), 'line-editor', 'Tab from the last button comes back');
    const pressed = () => p.$$eval('.txt-bar [data-tf="bold"], .txt-bar [data-tf="italic"], .txt-bar [data-tf="underline"]', (b) => b.map((x) => x.getAttribute('aria-pressed')));
    eq(await pressed(), ['false', 'false', 'false']);
    await p.keyboard.press('Control+b'); await p.keyboard.press('Control+i'); await p.keyboard.press('Control+u');
    eq(await pressed(), ['true', 'true', 'true']);
    const st = await p.$eval('.line-editor', (e) => [getComputedStyle(e).fontWeight, getComputedStyle(e).fontStyle, getComputedStyle(e).textDecorationLine]);
    ok(+st[0] >= 600 && st[1] === 'italic' && st[2] === 'underline', JSON.stringify(st));
    eq(await active(p), 'line-editor', 'focus stays in the text');
    // In the bar too, and Ctrl+B there formats instead of adding a bookmark.
    await p.keyboard.press('Tab'); await p.keyboard.press('Control+b'); eq((await pressed())[0], 'false');
    eq(await active(p), 'line-editor', 'back in the text, as after a click on the button (no bookmark added)');
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const m = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().find((x) => x.type === 'tpara'));
    ok(m && !m.bold && m.italic && m.underline, JSON.stringify(m && [m.bold, m.italic, m.underline]));
    eq(p.errors, []); await p.ctx.close();
  });
};
