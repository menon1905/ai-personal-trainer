
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Serve uploaded videos statically
app.use('/uploads', express.static(uploadDir));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const sessionId = req.params.id;
        cb(null, `session_${sessionId}_${Date.now()}.webm`);
    }
});
const upload = multer({ storage });

let sessionData = [];

// API Endpoints
app.post('/api/session/start', (req, res) => {
    const session = {
        id: Date.now(),
        startTime: new Date(),
        exercise: req.body.exercise,
        logs: [],
        videoPath: null
    };
    sessionData.push(session);
    res.status(201).json(session);
});

app.post('/api/session/:id/log', (req, res) => {
    const session = sessionData.find(s => s.id == req.params.id);
    if (session) {
        session.logs.push({
            timestamp: new Date(),
            ...req.body
        });
        res.status(200).send('Logged');
    } else {
        res.status(404).send('Session not found');
    }
});

// Upload Video Route
app.post('/api/session/:id/video', upload.single('video'), (req, res) => {
    const session = sessionData.find(s => s.id == req.params.id);
    if (session && req.file) {
        session.videoPath = `/uploads/${req.file.filename}`;
        res.status(200).json({ path: session.videoPath });
    } else {
        res.status(404).send('Session or video file missing');
    }
});

app.get('/api/session/:id/summary', (req, res) => {
    const session = sessionData.find(s => s.id == req.params.id);
    if (session) {
        const totalReps = session.logs.filter(l => l.rep > 0).length;
        const errors = session.logs.filter(l => l.isError).length;
        const averageAccuracy = totalReps > 0 ? Math.round(((totalReps - (errors * 0.3)) / totalReps) * 100) : 0;

        res.json({
            id: session.id,
            exercise: session.exercise,
            totalReps,
            averageAccuracy: Math.max(0, averageAccuracy),
            duration: (new Date() - session.startTime) / 1000,
            videoUrl: session.videoPath ? `http://localhost:3001${session.videoPath}` : null
        });
    } else {
        res.status(404).send('Session not found');
    }
});

// Socket.io for real-time telemetry
io.on('connection', (socket) => {
    console.log('Trainer/User connected:', socket.id);
    socket.on('disconnect', () => console.log('User disconnected'));
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
