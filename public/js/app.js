// Jumıs AI — small progressive enhancements. Every page also works without JavaScript.
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  document.documentElement.classList.remove('no-js');

  // Theme toggle (light / dark)
  $$('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
  }));

  // Toasts disappear after a few seconds
  $$('#toasts .toast').forEach((t) => setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 4500));
  window.toast = (msg, error) => {
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4500);
  };

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    $$('details.dropdown[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  // Confirm before dangerous actions
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const msg = form.dataset.confirm;
    if (msg && !confirm(msg)) { e.preventDefault(); return; }
    // Busy state for slow actions (AI, uploads)
    const btn = e.submitter && e.submitter.dataset.busy !== undefined ? e.submitter : form.querySelector('[data-busy]');
    if (btn && !e.defaultPrevented) {
      setTimeout(() => {
        btn.setAttribute('aria-busy', 'true');
        btn.disabled = true;
        const label = btn.dataset.busy;
        if (label) btn.innerHTML = '<span class="spinner"></span><span></span>', btn.lastChild.textContent = label;
      }, 0);
    }
  });

  // Show chosen file names
  $$('.file-drop input[type=file]').forEach((inp) => inp.addEventListener('change', () => {
    const span = inp.parentElement.querySelector('[data-file-label]');
    if (span && inp.files.length) span.textContent = Array.from(inp.files).map((f) => f.name).join(', ');
  }));

  // Dialogs: <button data-open="id">, <button data-close>
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => { const d = document.getElementById(b.dataset.open); if (d) d.showModal(); }));
  $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog[data-autoopen]').forEach((d) => d.showModal());

  // Show/hide helper: <div data-show-for="fieldName" data-show-when="a,b"> is visible when that field's value is a or b
  const groups = new Set($$('[data-show-for]').map((el) => el.dataset.showFor));
  groups.forEach((name) => {
    const inputs = $$(`[name="${name}"]`);
    const value = () => { const r = inputs.find((i) => i.type === 'radio' ? i.checked : true); return r ? r.value : ''; };
    const apply = () => $$(`[data-show-for="${name}"]`).forEach((el) => { el.hidden = !el.dataset.showWhen.split(',').includes(value()); });
    inputs.forEach((i) => i.addEventListener('change', apply)); apply();
  });

  // ─── Quiz engine: one question at a time with a per-question timer ─────────
  const quiz = $('form[data-quiz]');
  if (quiz) {
    const qs = $$('.quiz-q', quiz);
    const per = Number(quiz.dataset.seconds || 30);
    const timerEl = $('[data-timer]', quiz);
    const progEl = $('[data-progress]', quiz);
    const countEl = $('[data-count]', quiz);
    const nextBtn = $('[data-qnext]', quiz);
    const startedAt = Date.now();
    let i = 0, left = per, iv;
    const show = () => {
      qs.forEach((q, k) => q.classList.toggle('on', k === i));
      if (countEl) countEl.textContent = `${i + 1} / ${qs.length}`;
      if (progEl) progEl.style.width = `${((i + 1) / qs.length) * 100}%`;
      nextBtn.querySelector('span').textContent = i === qs.length - 1 ? nextBtn.dataset.labelFinish : nextBtn.dataset.labelNext;
      left = per; tick();
    };
    const tick = () => { if (timerEl) { timerEl.textContent = `${left}s`; timerEl.classList.toggle('low', left <= 10); } };
    const finish = () => {
      clearInterval(iv);
      const tt = $('input[name=time_taken]', quiz); if (tt) tt.value = Math.round((Date.now() - startedAt) / 1000);
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<span class="spinner"></span><span></span>';
      nextBtn.lastChild.textContent = nextBtn.dataset.labelBusy || '…';
      quiz.submit();
    };
    const next = () => { if (i >= qs.length - 1) return finish(); i++; show(); };
    nextBtn.type = 'button';
    nextBtn.addEventListener('click', next);
    iv = setInterval(() => { left--; tick(); if (left <= 0) next(); }, 1000);
    show();
  }

  // ─── Lesson reminders: browser notification 1 minute before a scheduled lesson ─
  if (document.body.dataset.reminders !== undefined || $('[data-reminders]')) {
    const fired = new Set(JSON.parse(sessionStorage.getItem('remind-fired') || '[]'));
    const check = async () => {
      try {
        const res = await fetch('/api/schedule', { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const items = await res.json();
        const now = Date.now();
        items.forEach((s) => {
          const at = new Date(s.scheduled_at).getTime();
          const diff = at - now;
          if (diff <= 60000 && diff > -60000 && !fired.has(s.id)) {
            fired.add(s.id);
            sessionStorage.setItem('remind-fired', JSON.stringify([...fired]));
            if ('Notification' in window && Notification.permission === 'granted') new Notification('📅 Jumıs AI', { body: s.title });
            window.toast('📅 ' + s.title);
          }
        });
      } catch (e) {}
    };
    check(); setInterval(check, 30000);
    const askBtn = $('[data-ask-notify]');
    if (askBtn && 'Notification' in window && Notification.permission === 'default') {
      askBtn.hidden = false;
      askBtn.addEventListener('click', () => Notification.requestPermission().then(() => { askBtn.hidden = true; }));
    }
  }
})();
