const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// --- Uploads & Data folder (Railway Volume mount point) ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// --- Data file (stored inside uploads folder for persistence) ---
const DATA_FILE = path.join(UPLOAD_DIR, 'data.json');
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

// --- Multer (Video File Storage) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- Serve Static Files ---
app.use('/uploads', express.static(UPLOAD_DIR));

// --- Helper Functions ---
function readData() {
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- API Routes ---

// Get all videos (newest first)
app.get('/api/videos', (req, res) => {
  try {
    const videos = readData().sort((a, b) => 
      new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load videos' });
  }
});

// Upload video
app.post('/api/upload', upload.single('video'), (req, res) => {
  try {
    const { title, caption } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const videos = readData();
    const newVideo = {
      id: Date.now().toString(), // unique string ID
      title,
      caption,
      filename: req.file.filename,
      fileUrl: '/uploads/' + req.file.filename,
      uploadedAt: new Date().toISOString()
    };
    videos.push(newVideo);
    writeData(videos);

    res.json(newVideo);
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Delete video
app.delete('/api/videos/:id', (req, res) => {
  try {
    const id = req.params.id;
    let videos = readData();
    const index = videos.findIndex(v => v.id === id);
    if (index === -1) return res.status(404).json({ error: 'Video not found' });

    // Delete file from disk
    const video = videos[index];
    const filePath = path.join(UPLOAD_DIR, video.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    videos.splice(index, 1);
    writeData(videos);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// --- Serve Frontend (index.html) ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
