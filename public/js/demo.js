'use strict';
// Live demo codes on the landing page.
(() => {
  const rows = [...document.querySelectorAll('.preview .code-row')];
  async function tick() {
    for (const r of rows) {
      const rem = VaultTOTP.remaining(30);
      r.querySelector('.digits').textContent = VaultTOTP.format(await VaultTOTP.code(r.dataset.secret));
      r.querySelector('.secs').textContent = rem + 's';
      r.querySelector('.secs').classList.toggle('warn', rem <= 5);
      r.querySelector('.bar').style.setProperty('--p', (rem / 30).toFixed(3));
      r.querySelector('.bar').classList.toggle('warn', rem <= 5);
    }
  }
  tick(); setInterval(tick, 1000);
})();
