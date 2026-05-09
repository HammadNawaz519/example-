const puppeteer = require('puppeteer');
(async () => {
  try {
    const b = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGE ERROR:', e.message));
    p.on('console', m => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()));
    await p.goto('http://localhost:5173');
    await new Promise(r => setTimeout(r, 1000));
    await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.includes('MV-1'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 2000));
    await b.close();
  } catch (e) {
    console.log('TEST ERROR:', e.message);
    process.exit(1);
  }
})();
