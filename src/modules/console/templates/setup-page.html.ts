/**
 * GET /setup — the one-time page that creates the first CEO account, served
 * by the app itself. The bootstrap secret and the first CEO password go
 * straight from this page to POST /staff/bootstrap on the same address; they
 * never pass through another website (DEPLOY.md, Step 7).
 *
 * No outside scripts, fonts or images; nothing is stored in the browser. The
 * request only works while no staff account exists, so after the first CEO the
 * page just answers "already set up".
 */
export function renderSetupPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Laboura first set-up</title>
<style>
  :root { --bg:#f5f7fb; --card:#fff; --ink:#0d1b3d; --muted:#5b6782; --line:#d9e0ee; --navy:#032b73; --bad:#b3261e; --badbg:#fbeceb; --good:#1c7a52; --goodbg:#e7f6ee; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1422; --card:#171e31; --ink:#e8ecf6; --muted:#9aa6c2; --line:#2a3550; --navy:#7fa6ff; --bad:#ff8a80; --badbg:#3a2220; --good:#6fd3a3; --goodbg:#16302a; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px 16px; }
  main { max-width: 520px; margin: 0 auto; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p { color: var(--muted); margin: 0 0 16px; }
  label { display: block; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  small { color: var(--muted); display: block; margin-top: 4px; }
  button { margin-top: 20px; width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--navy); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: wait; }
  .msg { display: none; margin-top: 16px; padding: 12px; border-radius: 8px; }
  .msg.bad { display: block; background: var(--badbg); color: var(--bad); }
  .msg.good { display: block; background: var(--goodbg); color: var(--good); }
  code { font-size: 18px; font-weight: 700; }
</style>
</head>
<body>
<main>
  <h1>Create the first CEO account</h1>
  <p>Use this page once, right after Laboura is first put online. It works only while no staff account exists. Everything you type goes straight to this Laboura address and nowhere else.</p>
  <form id="setup" autocomplete="off" novalidate>
    <label for="name">CEO name</label>
    <input id="name" name="name" required maxlength="100">
    <label for="email">CEO email</label>
    <input id="email" name="email" type="email" required maxlength="200">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required minlength="12" autocomplete="new-password">
    <small>At least 12 characters. Keep it in a password manager.</small>
    <label for="password2">Password again</label>
    <input id="password2" name="password2" type="password" required autocomplete="new-password">
    <label for="secret">Bootstrap secret</label>
    <input id="secret" name="secret" type="password" required autocomplete="off">
    <small>From Render: the web service, Environment, STAFF_BOOTSTRAP_SECRET (click the eye icon, copy).</small>
    <button id="submit" type="submit">Create the CEO account</button>
  </form>
  <div id="msg" class="msg" role="status" aria-live="polite"></div>
</main>
<script>
(function () {
  var form = document.getElementById('setup');
  var msg = document.getElementById('msg');
  var button = document.getElementById('submit');
  function show(kind, text, code) {
    msg.className = 'msg ' + kind;
    msg.textContent = text;
    if (code) {
      var line = document.createElement('div');
      line.appendChild(document.createTextNode('Staff code: '));
      var c = document.createElement('code');
      c.textContent = code;
      line.appendChild(c);
      msg.appendChild(line);
    }
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var value = function (id) { return document.getElementById(id).value; };
    if (!value('name').trim() || !value('email').trim() || !value('password') || !value('secret')) {
      show('bad', 'Fill in every box.');
      return;
    }
    if (value('password').length < 12) { show('bad', 'The password needs at least 12 characters.'); return; }
    if (value('password') !== value('password2')) { show('bad', 'The two passwords are not the same.'); return; }
    button.disabled = true;
    try {
      var res = await fetch('/staff/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ name: value('name').trim(), email: value('email').trim(), password: value('password'), secret: value('secret') })
      });
      var data = {};
      try { data = await res.json(); } catch (e) { data = {}; }
      if (res.ok) {
        form.reset();
        form.style.display = 'none';
        show('good', 'Done. Write the staff code down, then go to /admin and log in with it and the password to set up the authenticator app.', data.code || '');
      } else {
        var text = Array.isArray(data.message) ? data.message.join(' ') : (data.message || ('The server answered ' + res.status + '.'));
        show('bad', text);
      }
    } catch (e) {
      show('bad', 'Could not reach Laboura. Check the internet connection and try again.');
    } finally {
      button.disabled = false;
      document.getElementById('secret').value = '';
    }
  });
})();
</script>
</body>
</html>`;
}
