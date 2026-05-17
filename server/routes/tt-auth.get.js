// GET /tt-auth — TikTok paste-cookies login page.
//
// Same paste-cookies pattern as /fb-auth. The user logs into tiktok.com,
// copies sessionid (and ideally tt-target-idc) from DevTools, pastes them
// here, and we POST to /api/tt-login.
export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8');
  return `<!DOCTYPE html><html><head><title>Login with TikTok</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#f5f3f8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:16px;padding:36px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.08)}
h2{font-size:1.2rem;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.desc{font-size:.82rem;color:#666;margin-bottom:20px;line-height:1.6}
.steps{background:#f0f2f5;border-radius:10px;padding:16px 20px;margin-bottom:20px;font-size:.78rem;color:#555;line-height:1.8}
.steps ol{padding-left:20px}
.steps code{background:#fff;border:1px solid #ddd;padding:1px 6px;border-radius:4px;font-size:.75rem;font-family:monospace}
.steps .warn{color:#e67e22;font-weight:600;margin-top:6px;font-size:.72rem}
textarea{width:100%;height:80px;padding:12px;border:2px solid #e0e0e0;border-radius:10px;font-size:.82rem;font-family:monospace;resize:vertical;outline:none;transition:border-color .2s}
textarea:focus{border-color:#000}
textarea::placeholder{font-family:'Inter',sans-serif;color:#aaa}
.actions{margin-top:14px;display:flex;gap:8px;align-items:center}
.tt-btn{display:inline-flex;align-items:center;gap:8px;background:#000;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-size:.88rem;font-weight:600;cursor:pointer;transition:opacity .2s}
.tt-btn:hover{opacity:.85}
.tt-btn:disabled{opacity:.5;cursor:not-allowed}
.cancel{border:none;background:none;color:#666;font-size:.82rem;cursor:pointer;padding:8px}
.cancel:hover{color:#333}
.status{margin-top:14px;font-size:.8rem;display:none}
.status.show{display:block}
.status.error{color:#e53935}
.status.success{color:#2e7d32}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #ccc;border-top-color:#000;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.open-tt{display:inline-flex;align-items:center;gap:6px;background:#000;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;text-decoration:none;margin-bottom:14px;transition:opacity .2s}
.open-tt:hover{opacity:.85}
</style></head><body>
<div class="card">
<h2>
<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M19 7.5a5 5 0 01-3-1v6.5a5 5 0 11-5-5v3a2 2 0 102 2V3h2.5A2.5 2.5 0 0018 5.5L19 7.5z" fill="#000"/></svg>
Login with TikTok
</h2>
<p class="desc">Connect your TikTok account to download private or age-restricted videos.</p>

<a class="open-tt" href="https://www.tiktok.com" target="_blank">
<svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
Open TikTok (log in first)
</a>

<div class="steps">
<ol>
<li>Click the button above and <strong>log in</strong> to TikTok</li>
<li>Once logged in, press <code>F12</code> to open DevTools</li>
<li>Go to <strong>Application</strong> tab &rarr; <strong>Cookies</strong> &rarr; <code>tiktok.com</code></li>
<li>Find <code>sessionid</code> and <code>tt-target-idc</code> cookies and copy their values</li>
<li>Paste both below as: <code>sessionid=VALUE; tt-target-idc=VALUE</code></li>
</ol>
<p class="warn">Your credentials never leave your browser. Only session cookies are stored locally.</p>
</div>

<textarea id="cookies" placeholder="sessionid=abc123...; tt-target-idc=useast2a"></textarea>
<div class="actions">
<button class="tt-btn" id="connectBtn" onclick="doConnect()">Connect</button>
<button class="cancel" onclick="window.close()">Cancel</button>
</div>
<div class="status" id="status"></div>
</div>
<script>
async function doConnect(){
  const raw=document.getElementById('cookies').value.trim();
  const status=document.getElementById('status');
  const btn=document.getElementById('connectBtn');
  if(!raw){status.className='status show error';status.textContent='Please paste your cookies.';return}
  if(!/sessionid=/.test(raw)){
    status.className='status show error';
    status.textContent='Must include sessionid cookie.';
    return;
  }
  btn.disabled=true;
  status.className='status show';
  status.innerHTML='<span class="spinner"></span>Connecting...';
  try{
    const res=await fetch('/api/tt-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookies:raw})});
    const data=await res.json();
    if(!res.ok){status.className='status show error';status.textContent=data.error||'Connection failed.';btn.disabled=false;return}
    status.className='status show success';
    status.textContent='Connected as @'+(data.username||'unknown')+'! Closing...';
    if(window.opener){window.opener.postMessage({type:'tt-login-success',username:data.username},'*')}
    setTimeout(()=>window.close(),1500);
  }catch(e){status.className='status show error';status.textContent='Connection failed.';btn.disabled=false}
}
</script></body></html>`;
});
