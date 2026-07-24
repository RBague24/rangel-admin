const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files from uploads
app.use('/uploads', express.static('uploads'));

// MongoDB Media Schema
const mediaSchema = new mongoose.Schema({
  service: { type: String, required: true },
  file_path: { type: String, required: true, unique: true },
  file_type: { type: String, enum: ['image', 'video'], required: true },
  original_name: String,
  file_size: Number,
  display_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

const Media = mongoose.model('Media', mediaSchema);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images (JPG, PNG, WebP) and videos (MP4, WebM) allowed.'));
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// MongoDB Connection
async function initializeDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✓ Connected to MongoDB Atlas');
  } catch (error) {
    console.error('✗ Database connection error:', error.message);
    process.exit(1);
  }
}

// Routes

// Serve admin-index.html at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Upload image for admin panel
app.post('/api/upload-image', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { service, old_path } = req.body;
    
    if (!service) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Service type is required' });
    }

    const fileType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    const filePath = `/uploads/${req.file.filename}`;

    // If there was an old image, delete it from database
    if (old_path) {
      const oldFilePath = path.join(__dirname, old_path);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
      // Remove old record from database
      await Media.deleteOne({ file_path: old_path });
    }

    // Create new media record in MongoDB
    const media = new Media({
      service,
      file_path: filePath,
      file_type: fileType,
      original_name: req.file.originalname,
      file_size: req.file.size
    });

    const savedMedia = await media.save();

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      media: {
        id: savedMedia._id,
        file_path: filePath,
        file_type: fileType,
        service: service
      }
    });
  } catch (error) {
    console.error('Upload error:', error.message);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// Upload media
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { service } = req.body;
    
    if (!service) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Service type is required' });
    }

    const fileType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    const filePath = `/uploads/${req.file.filename}`;

    // Create new media record in MongoDB
    const media = new Media({
      service,
      file_path: filePath,
      file_type: fileType,
      original_name: req.file.originalname,
      file_size: req.file.size
    });

    const savedMedia = await media.save();

    res.json({
      success: true,
      message: 'File uploaded successfully',
      media: {
        id: savedMedia._id,
        file_path: filePath,
        file_type: fileType,
        service: service
      }
    });
  } catch (error) {
    console.error('Upload error:', error.message);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// Get media by service
app.get('/api/media/:service', async (req, res) => {
  try {
    const { service } = req.params;
    
    const media = await Media.find({ service })
      .sort({ display_order: 1, created_at: -1 });

    res.json({
      success: true,
      media: media
    });
  } catch (error) {
    console.error('Fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// Delete media
app.delete('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find media record
    const media = await Media.findById(id);

    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Delete file from filesystem
    const filePath = path.join(__dirname, media.file_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    await Media.findByIdAndDelete(id);

    res.json({ success: true, message: 'Media deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

// Update display order
app.put('/api/media/:id/reorder', async (req, res) => {
  try {
    const { id } = req.params;
    const { display_order } = req.body;
    
    await Media.findByIdAndUpdate(id, { display_order });

    res.json({ success: true, message: 'Order updated' });
  } catch (error) {
    console.error('Reorder error:', error.message);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// Start server
async function start() {
  await initializeDatabase();
  
  app.listen(PORT, () => {
    console.log(`\n🚀 Admin server running on port ${PORT}`);
    console.log(`📁 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🔌 API: http://localhost:${PORT}/api\n`);
  });
}

start();
