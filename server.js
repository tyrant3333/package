const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'desishit_secret_key',
  resave: false,
  saveUninitialized: false
}));

// --- Folders ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DATA_FILE = path.join(UPLOAD_DIR, 'data.json');
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));

const CONFIG_FILE = path.join(UPLOAD_DIR, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    telegramLink: 'https://t.me/your_channel',
    notificationEnabled: true,
    permanentNotification: false,
    botToken: '',
    channelId: ''
  }, null, 2));
}

const VISITORS_FILE = path.join(UPLOAD_DIR, 'visitors.json');
let uniqueIPs = new Set();
if (fs.existsSync(VISITORS_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8'));
    uniqueIPs = new Set(data);
  } catch (e) {}
}
function saveVisitors() {
  fs.writeFileSync(VISITORS_FILE, JSON.stringify([...uniqueIPs], null, 2));
}

// --- Data Helpers ---
function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// --- Active Users (Live Tracking) ---
const activeUsers = new Map();

app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  const ip = req.ip || req.connection.remoteAddress || '0.0.0.0';
  const ua = req.headers['user-agent'] || '';
  
  if (!uniqueIPs.has(ip)) {
    uniqueIPs.add(ip);
    saveVisitors();
  }

  const liveKey = ip + ua;
  const now = Date.now();
  if (activeUsers.has(liveKey)) {
    const val = activeUsers.get(liveKey);
    val.lastSeen = now;
  } else {
    activeUsers.set(liveKey, { lastSeen: now, currentVideo: null });
  }
  next();
});

setInterval(() => {
  const now = Date.now();
  for (let [key, val] of activeUsers) {
    if (now - val.lastSeen > 15000) {
      activeUsers.delete(key);
    }
  }
}, 10000);

// --- Multer (Dynamic Video Folder) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const title = req.body.title || 'video';
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
    const folderName = Date.now() + '_' + safeTitle;
    const dir = path.join(UPLOAD_DIR, folderName);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.use('/uploads', express.static(UPLOAD_DIR));

// --- Admin Auth Middleware (Redirect Loop Fix) ---
function isAdmin(req, res, next) {
  // Agar session admin hai, toh aage badho
  if (req.session && req.session.admin === true) {
    return next();
  }
  // Trailing slash hatao (safety check)
  const path = req.path.replace(/\/+$/, '') || '/';
  // Login aur API routes ko bina session ke allow karo
  if (path === '/admin/login' || path === '/admin/api/login') {
    return next();
  }
  // Baaki sab admin routes ko login pe redirect karo
  return res.redirect('/admin/login');
}
app.use('/admin', isAdmin);

// --- Public API ---
app.get('/api/videos', (req, res) => {
  try {
    const videos = readData().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json(videos);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/videos/:id/view', (req, res) => {
  try {
    const id = req.params.id;
    const videos = readData();
    const video = videos.find(v => v.id === id);
    if (video) {
      video.views = (video.views || 0) + 1;
      writeData(videos);
    }
    const ip = req.ip || '0.0.0.0';
    const ua = req.headers['user-agent'] || '';
    const liveKey = ip + ua;
    if (activeUsers.has(liveKey)) {
      activeUsers.get(liveKey).currentVideo = id;
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/config', (req, res) => {
  try {
    const config = readConfig();
    res.json(config);
  } catch (e) { res.status(500).json({ error: 'Config error' }); }
});

// --- Admin Login Page ---
app.get('/admin/login', (req, res) => {
  const error = req.query.error ? 'Invalid credentials' : '';
  res.send(`
    <!DOCTYPE html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin Login - DESI SHIT</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
      body { background:#0d0d1a; color:#f0f0ff; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; }
      .login-box { background:#18182e; padding:40px; border-radius:16px; width:100%; max-width:380px; border:1px solid rgba(255,255,255,0.06); }
      .login-box h1 { font-size:24px; margin-bottom:24px; text-align:center; }
      .login-box h1 i { color:#7c5cfc; }
      .form-group { margin-bottom:16px; }
      .form-group label { display:block; font-size:14px; color:#a0a0c0; margin-bottom:4px; }
      .form-group input { width:100%; padding:12px; background:#0d0d1a; border:1px solid rgba(255,255,255,0.06); border-radius:8px; color:#fff; }
      .form-group input:focus { outline:none; border-color:#7c5cfc; }
      .btn { width:100%; padding:12px; background:linear-gradient(135deg,#7c5cfc,#f57c9a); border:none; border-radius:8px; color:#fff; font-weight:bold; cursor:pointer; }
      .error { color:#ff6b6b; font-size:14px; margin-top:10px; text-align:center; }
    </style>
    </head><body>
      <div class="login-box">
        <h1><i class="fas fa-crown"></i> DESI SHIT</h1>
        <form method="POST" action="/admin/api/login">
          <div class="form-group"><label>Username</label><input type="text" name="username" required placeholder="IAMBITCOINMIN" /></div>
          <div class="form-group"><label>Password</label><input type="password" name="password" required placeholder="********" /></div>
          <button type="submit" class="btn">Login</button>
          ${error ? `<div class="error">${error}</div>` : ''}
        </form>
      </div>
    </body></html>
  `);
});

app.post('/admin/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'IAMBITCOINMIN' && password === '6887@@991') {
    req.session.admin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=1');
  }
});

app.post('/admin/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- Admin Dashboard ---
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>DESI SHIT Admin</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { background:#0d0d1a; color:#f0f0ff; font-family:sans-serif; padding:20px; }
      .admin-container { max-width:1200px; margin:0 auto; }
      .header { display:flex; justify-content:space-between; align-items:center; margin-bottom:30px; }
      .header h1 { font-size:24px; }
      .header h1 i { color:#7c5cfc; }
      .logout-btn { background:#ff6b6b; border:none; padding:8px 20px; border-radius:8px; color:#fff; cursor:pointer; }
      .stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:20px; margin-bottom:30px; }
      .stat-card { background:#18182e; padding:20px; border-radius:12px; border:1px solid rgba(255,255,255,0.06); }
      .stat-card .num { font-size:28px; font-weight:700; }
      .stat-card .label { color:#a0a0c0; font-size:14px; margin-top:4px; }
      .stat-card .icon { float:right; font-size:32px; color:#7c5cfc; opacity:0.3; }
      .section { background:#18182e; border-radius:12px; padding:20px; margin-bottom:30px; border:1px solid rgba(255,255,255,0.06); }
      .section h2 { font-size:18px; margin-bottom:16px; }
      .section h2 i { color:#7c5cfc; margin-right:8px; }
      .form-group { margin-bottom:16px; }
      .form-group label { display:block; color:#a0a0c0; margin-bottom:4px; font-size:14px; }
      .form-group input,.form-group textarea { width:100%; padding:10px; background:#0d0d1a; border:1px solid rgba(255,255,255,0.06); border-radius:8px; color:#fff; }
      .form-group textarea { min-height:60px; resize:vertical; }
      .form-group input[type="checkbox"] { width:auto; margin-right:8px; }
      .btn-upload { background:linear-gradient(135deg,#7c5cfc,#f57c9a); border:none; padding:10px 30px; border-radius:8px; color:#fff; font-weight:bold; cursor:pointer; }
      .btn-upload:disabled { opacity:0.5; }
      table { width:100%; border-collapse:collapse; }
      th,td { text-align:left; padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.04); }
      th { color:#a0a0c0; font-size:13px; }
      .del-btn { background:none; border:none; color:#ff6b6b; cursor:pointer; }
      .toast { position:fixed; bottom:20px; right:20px; padding:12px 24px; border-radius:8px; z-index:100; display:none; }
      .toast.success { background:#00b894; }
      .toast.error { background:#e17055; }
      .upload-progress { width:100%; height:4px; background:rgba(255,255,255,0.1); border-radius:4px; margin-top:10px; overflow:hidden; display:none; }
      .upload-progress .bar { height:100%; width:0%; background:#7c5cfc; transition:width 0.3s; }
      @media(max-width:600px){ .stats-grid { grid-template-columns:1fr 1fr; } }
    </style>
    </head><body>
      <div class="admin-container">
        <div class="header"><h1><i class="fas fa-crown"></i> DESI SHIT Admin</h1><button class="logout-btn" onclick="fetch('/admin/api/logout',{method:'POST'}).then(()=>location.href='/admin/login')">Logout</button></div>
        <div class="stats-grid" id="statsGrid">
          <div class="stat-card"><div class="icon"><i class="fas fa-users"></i></div><div class="num" id="totalUsers">0</div><div class="label">Total Users</div></div>
          <div class="stat-card"><div class="icon"><i class="fas fa-circle" style="color:#00b894;"></i></div><div class="num" id="liveUsers">0</div><div class="label">Live Users</div></div>
          <div class="stat-card"><div class="icon"><i class="fas fa-film"></i></div><div class="num" id="totalVideos">0</div><div class="label">Total Videos</div></div>
          <div class="stat-card"><div class="icon"><i class="fas fa-eye"></i></div><div class="num" id="totalViews">0</div><div class="label">Total Views</div></div>
        </div>

        <div class="section"><h2><i class="fas fa-upload"></i> Upload New Video</h2>
          <form id="uploadForm">
            <div class="form-group"><label>Video Title</label><input type="text" id="title" required /></div>
            <div class="form-group"><label>Caption</label><textarea id="caption"></textarea></div>
            <div class="form-group"><label>Video File</label><input type="file" id="videoFile" accept="video/*" required /></div>
            <button type="submit" class="btn-upload" id="submitBtn"><i class="fas fa-cloud-upload-alt"></i> Upload Video</button>
            <div class="upload-progress" id="uploadProgress"><div class="bar" id="progressBar"></div></div>
          </form>
        </div>

        <div class="section"><h2><i class="fas fa-chart-line"></i> Live Watching Now</h2>
          <table class="live-table"><thead><tr><th>Video</th><th>Viewers</th></tr></thead>
          <tbody id="liveBody"><tr><td colspan="2">Loading...</td></tr></tbody></table>
        </div>

        <div class="section"><h2><i class="fas fa-list"></i> All Videos</h2>
          <table><thead><tr><th>Title</th><th>Views</th><th>Uploaded</th><th>Action</th></tr></thead>
          <tbody id="videoBody"></tbody></table>
        </div>

        <div class="section" style="border-color: rgba(124,92,252,0.3);">
          <h2><i class="fab fa-telegram-plane"></i> Telegram Integration</h2>
          <form id="telegramForm">
            <div class="form-group">
              <label>Telegram Channel Link (for banner)</label>
              <input type="text" id="telegramLink" placeholder="https://t.me/your_channel" />
            </div>
            <div class="form-group">
              <label style="display:flex; align-items:center;">
                <input type="checkbox" id="notificationEnabled" /> Enable Notification Banner
              </label>
            </div>
            <div class="form-group">
              <label style="display:flex; align-items:center;">
                <input type="checkbox" id="permanentNotification" /> Permanent Banner
              </label>
            </div>
            <div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:16px; margin-bottom:16px;">
              <h3 style="font-size:15px; color:#a0a0c0; margin-bottom:12px;">Auto-Upload to Telegram Channel</h3>
              <div class="form-group">
                <label>Bot Token (from @BotFather)</label>
                <input type="text" id="botToken" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" />
              </div>
              <div class="form-group">
                <label>Channel ID (e.g., @desishit or -100123456789)</label>
                <input type="text" id="channelId" placeholder="@your_channel" />
              </div>
            </div>
            <button type="submit" class="btn-upload" id="telegramSaveBtn"><i class="fas fa-save"></i> Save Settings</button>
          </form>
        </div>

      </div>
      <div class="toast" id="toast"></div>

      <script>
        const toast = document.getElementById('toast');
        function showToast(msg,type='success'){ toast.textContent=msg; toast.className='toast '+type; toast.style.display='block'; setTimeout(()=>toast.style.display='none',3000); }
        async function fetchStats(){
          try {
            const res=await fetch('/admin/api/stats');
            const data=await res.json();
            document.getElementById('totalUsers').textContent=data.totalUsers;
            document.getElementById('liveUsers').textContent=data.liveUsers;
            document.getElementById('totalVideos').textContent=data.totalVideos;
            document.getElementById('totalViews').textContent=data.totalViews;
            const lb=document.getElementById('liveBody');
            lb.innerHTML='';
            if(data.liveVideoStats && data.liveVideoStats.length){
              data.liveVideoStats.forEach(item=>{ lb.innerHTML+='<tr><td>'+item.title+'</td><td>'+item.count+'</td></tr>'; });
            } else { lb.innerHTML='<tr><td colspan="2">No one watching right now</td></tr>'; }
          }catch(e){}
        }
        async function loadVideos(){
          const res=await fetch('/api/videos');
          const videos=await res.json();
          const body=document.getElementById('videoBody');
          body.innerHTML='';
          videos.forEach(v=>{
            body.innerHTML+='<tr><td>'+v.title+'</td><td>'+(v.views||0)+'</td><td>'+new Date(v.uploadedAt).toLocaleDateString()+'</td><td><button class="del-btn" onclick="deleteVideo(\''+v.id+'\')"><i class="fas fa-trash"></i></button></td></tr>';
          });
        }
        async function deleteVideo(id){ if(!confirm('Delete?'))return; const res=await fetch('/admin/api/videos/'+id,{method:'DELETE'}); if(res.ok){ showToast('Deleted'); loadVideos(); fetchStats(); } else showToast('Error','error'); }
        
        async function loadTelegramConfig() {
          try {
            const res = await fetch('/admin/api/config');
            const config = await res.json();
            document.getElementById('telegramLink').value = config.telegramLink || '';
            document.getElementById('notificationEnabled').checked = config.notificationEnabled !== false;
            document.getElementById('permanentNotification').checked = config.permanentNotification === true;
            document.getElementById('botToken').value = config.botToken || '';
            document.getElementById('channelId').value = config.channelId || '';
          } catch(e) { showToast('Failed to load config','error'); }
        }

        document.getElementById('telegramForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const btn = document.getElementById('telegramSaveBtn');
          btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
          const data = {
            telegramLink: document.getElementById('telegramLink').value.trim(),
            notificationEnabled: document.getElementById('notificationEnabled').checked,
            permanentNotification: document.getElementById('permanentNotification').checked,
            botToken: document.getElementById('botToken').value.trim(),
            channelId: document.getElementById('channelId').value.trim()
          };
          try {
            const res = await fetch('/admin/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            if(res.ok) { showToast('Settings saved!'); } else { showToast('Save failed','error'); }
          } catch(e) { showToast('Network error','error'); }
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
        });

        document.getElementById('uploadForm').addEventListener('submit',async(e)=>{
          e.preventDefault();
          const title=document.getElementById('title').value.trim();
          const caption=document.getElementById('caption').value.trim();
          const file=document.getElementById('videoFile').files[0];
          if(!file||!title){ showToast('Fill all fields','error'); return; }
          const btn=document.getElementById('submitBtn');
          const prog=document.getElementById('uploadProgress');
          const bar=document.getElementById('progressBar');
          btn.disabled=true; btn.innerHTML='Uploading...'; prog.style.display='block';
          const formData=new FormData(); formData.append('title',title); formData.append('caption',caption); formData.append('video',file);
          let p=0; const interval=setInterval(()=>{ p+=Math.random()*20; if(p>90)p=90; bar.style.width=p+'%'; },200);
          try {
            const res=await fetch('/admin/api/upload',{method:'POST',body:formData});
            clearInterval(interval);
            if(res.ok){ bar.style.width='100%'; showToast('Uploaded successfully!'); document.getElementById('uploadForm').reset(); setTimeout(()=>{ prog.style.display='none'; bar.style.width='0%'; },1000); loadVideos(); fetchStats(); }
            else { const err=await res.json(); showToast(err.error||'Upload failed','error'); prog.style.display='none'; }
          }catch(e){ showToast('Network error','error'); prog.style.display='none'; }
          btn.disabled=false; btn.innerHTML='<i class="fas fa-cloud-upload-alt"></i> Upload Video';
        });
        setInterval(fetchStats,5000);
        loadVideos(); fetchStats(); loadTelegramConfig();
      </script>
    </body></html>
  `);
});

// --- Admin API Routes ---
app.get('/admin/api/stats', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });
  const videos = readData();
  const totalViews = videos.reduce((sum, v) => sum + (v.views || 0), 0);
  const liveUsers = [...activeUsers.values()].filter(v => Date.now() - v.lastSeen < 15000).length;
  
  const liveMap = {};
  for (let [key, val] of activeUsers) {
    if (Date.now() - val.lastSeen < 15000 && val.currentVideo) {
      liveMap[val.currentVideo] = (liveMap[val.currentVideo] || 0) + 1;
    }
  }
  const liveVideoStats = [];
  for (let id in liveMap) {
    const v = videos.find(x => x.id === id);
    if (v) liveVideoStats.push({ id, title: v.title, count: liveMap[id] });
  }
  res.json({ totalUsers: uniqueIPs.size, liveUsers, totalVideos: videos.length, totalViews, liveVideoStats });
});

app.post('/admin/api/upload', upload.single('video'), async (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { title, caption } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file' });
    if (!title) return res.status(400).json({ error: 'Title required' });

    const videos = readData();
    const folderName = path.basename(path.dirname(req.file.path));
    
    // --- Upload to Telegram ---
    const config = readConfig();
    let telegramUrl = null;
    if (config.botToken && config.channelId) {
      try {
        const form = new FormData();
        form.append('chat_id', config.channelId);
        form.append('video', fs.createReadStream(req.file.path));
        form.append('caption', `📹 ${title}\n${caption || ''}`);
        
        const tgRes = await axios.post(`https://api.telegram.org/bot${config.botToken}/sendVideo`, form, {
          headers: form.getHeaders()
        });
        
        if (tgRes.data.ok) {
          const fileId = tgRes.data.result.video.file_id;
          const fileRes = await axios.get(`https://api.telegram.org/bot${config.botToken}/getFile?file_id=${fileId}`);
          if (fileRes.data.ok) {
            const filePath = fileRes.data.result.file_path;
            telegramUrl = `https://api.telegram.org/file/bot${config.botToken}/${filePath}`;
          }
        }
      } catch (teleErr) {
        console.warn('⚠️ Telegram upload failed (video still saved locally):', teleErr.message);
      }
    }

    const newVideo = {
      id: Date.now().toString(),
      title,
      caption,
      filename: req.file.originalname,
      fileUrl: '/uploads/' + folderName + '/' + req.file.originalname,
      telegramUrl: telegramUrl,
      uploadedAt: new Date().toISOString(),
      views: 0
    };
    videos.push(newVideo);
    writeData(videos);
    res.json(newVideo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.delete('/admin/api/videos/:id', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = req.params.id;
    let videos = readData();
    const index = videos.findIndex(v => v.id === id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    const video = videos[index];
    const folderPath = path.join(UPLOAD_DIR, path.basename(path.dirname(video.fileUrl)));
    if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
    videos.splice(index, 1);
    writeData(videos);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Delete failed' }); }
});

app.get('/admin/api/config', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const config = readConfig();
    res.json(config);
  } catch (e) { res.status(500).json({ error: 'Config error' }); }
});

app.post('/admin/api/config', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { telegramLink, notificationEnabled, permanentNotification, botToken, channelId } = req.body;
    const config = readConfig();
    config.telegramLink = telegramLink || '';
    config.notificationEnabled = notificationEnabled !== false;
    config.permanentNotification = permanentNotification === true;
    config.botToken = botToken || '';
    config.channelId = channelId || '';
    writeConfig(config);
    res.json(config);
  } catch (e) { res.status(500).json({ error: 'Config save error' }); }
});

// --- Public Frontend ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- Catch-All (Fix Redirect Loop) ---
app.get('*', (req, res) => {
  const normalizedPath = req.path.replace(/\/+$/, '') || '/';
  if (normalizedPath.startsWith('/admin')) {
    // Agar user /admin/login pe hai aur kisi wajah se specific route match nahi hua, toh redirect mat karo, bas login serve karo
    if (normalizedPath === '/admin/login') {
      return res.redirect('/admin/login?error=1'); // Redirect loop se bachne ke liye safety check
    }
    return res.redirect('/admin/login');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 DESI SHIT running on port ${PORT}`));
