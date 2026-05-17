// GET /fb-auth — Facebook paste-cookies login page.
//
// FB blocks scripted password logins; the user opens facebook.com in
// another tab, copies the c_user/xs/datr/sb/fr cookies from DevTools,
// pastes them here, and we forward to POST /api/fb-login. Lives in
// server/routes/ (not server/api/) because Nitro maps server/routes/X
// to /X — anything other than /api/* belongs here.
export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8');
  return `<!DOCTYPE html><html><head><title>Login with Facebook</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#f5f3f8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:16px;padding:36px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.08)}
h2{font-size:1.2rem;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.desc{font-size:.82rem;color:#666;margin-bottom:20px;line-height:1.6}
.steps{background:#f0f2f5;border-radius:10px;padding:16px 20px;margin-bottom:20px;font-size:.78rem;color:#555;line-height:1.8}
.steps ol{padding-left:20px}
.steps code{background:#fff;border:1px solid #ddd;padding:1px 6px;border-radius:4px;font-size:.75rem;font-family:monospace}
.steps .warn{color:#e67e22;font-weight:600;margin-top:6px;font-size:.72rem}
.fields{margin-bottom:6px}
.field{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.field label{width:62px;font-size:.76rem;color:#555;font-family:monospace;flex-shrink:0;text-align:right}
.field label.req{color:#222;font-weight:600}
.field label.req::after{content:"*";color:#e53935;margin-left:2px}
.field input{flex:1;min-width:0;padding:9px 12px;border:2px solid #e0e0e0;border-radius:8px;font-size:.78rem;font-family:monospace;outline:none;transition:border-color .2s}
.field input:focus{border-color:#1877F2}
.field input::placeholder{font-family:'Inter',sans-serif;color:#bbb;font-style:italic}
.field-foot{font-size:.7rem;color:#888;margin:6px 0 0 72px}
.actions{margin-top:14px;display:flex;gap:8px;align-items:center}
.fb-btn{display:inline-flex;align-items:center;gap:8px;background:#1877F2;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-size:.88rem;font-weight:600;cursor:pointer;transition:background .2s}
.fb-btn:hover{background:#1565c0}
.fb-btn:disabled{opacity:.5;cursor:not-allowed}
.cancel{border:none;background:none;color:#666;font-size:.82rem;cursor:pointer;padding:8px}
.cancel:hover{color:#333}
.status{margin-top:14px;font-size:.8rem;display:none}
.status.show{display:block}
.status.error{color:#e53935}
.status.success{color:#2e7d32}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #ccc;border-top-color:#1877F2;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<div class="card">
<h2>
<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M16.5 12.5h-2.5v7h-3v-7H9v-2.5h2v-1.5c0-2.2 1-3.5 3.3-3.5h2.2v2.5h-1.4c-1 0-1.1.4-1.1 1v1.5h2.5l-.5 2.5z" fill="#fff"/></svg>
Login with Facebook
</h2>
<p class="desc">Connect your Facebook account to view profiles and download profile pictures.</p>

<div class="steps">
<ol>
<li>Open <a href="https://www.facebook.com" target="_blank" rel="noopener">facebook.com</a> in another tab and log in</li>
<li>Press <code>F12</code> &rarr; <strong>Application</strong> &rarr; <strong>Cookies</strong> &rarr; <code>facebook.com</code></li>
<li>Copy each cookie's value into the matching field below</li>
</ol>
<p class="warn">Required fields are marked <span style="color:#e53935">*</span>. The others aren't strictly required, but FB usually rejects bare <code>c_user</code>/<code>xs</code> pairs as "unknown device".</p>
</div>

<div class="fields">
<div class="field"><label for="ck-c_user" class="req">c_user</label><input id="ck-c_user" type="text" placeholder="123456789" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="ck-xs" class="req">xs</label><input id="ck-xs" type="text" placeholder="42:AbCd...:2:1700000000" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="ck-datr">datr</label><input id="ck-datr" type="text" placeholder="optional but recommended" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="ck-sb">sb</label><input id="ck-sb" type="text" placeholder="optional but recommended" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="ck-fr">fr</label><input id="ck-fr" type="text" placeholder="optional but recommended" autocomplete="off" spellcheck="false"></div>
</div>

<div class="actions">
<button class="fb-btn" id="connectBtn" onclick="doConnect()">Connect</button>
<button class="cancel" onclick="window.close()">Cancel</button>
</div>
<div class="status" id="status"></div>
</div>
<script>
var FIELDS = ['c_user', 'xs', 'datr', 'sb', 'fr'];

function buildCookieString(){
  var parts = [];
  for (var i = 0; i < FIELDS.length; i++) {
    var k = FIELDS[i];
    var v = (document.getElementById('ck-' + k).value || '').trim();
    if (v) parts.push(k + '=' + v);
  }
  return parts.join('; ');
}

async function doConnect(){
  const status=document.getElementById('status');
  const btn=document.getElementById('connectBtn');
  const cUser=(document.getElementById('ck-c_user').value||'').trim();
  const xs=(document.getElementById('ck-xs').value||'').trim();
  if(!cUser||!xs){
    status.className='status show error';
    status.textContent='c_user and xs are required.';
    return;
  }
  const raw=buildCookieString();
  btn.disabled=true;
  status.className='status show';
  status.innerHTML='<span class="spinner"></span>Connecting...';
  try{
    const res=await fetch('/api/fb-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookies:raw,userAgent:navigator.userAgent})});
    const data=await res.json();
    if(!res.ok){status.className='status show error';status.textContent=data.error||'Connection failed.';btn.disabled=false;return}
    status.className='status show success';
    if(data.validated){
      status.textContent='Connected as '+data.username+'! Closing...';
    } else {
      status.innerHTML='Saved session for <strong>'+data.username+'</strong>. Couldn\\'t verify it from here — if downloads fail, paste fresh cookies.';
    }
    if(window.opener){try{window.opener.postMessage({type:'fb-login-success',username:data.username},'*')}catch(_){}}
    setTimeout(()=>window.close(), data.validated ? 1500 : 4500);
  }catch(e){status.className='status show error';status.textContent='Connection failed.';btn.disabled=false}
}
</script></body></html>`;
});
