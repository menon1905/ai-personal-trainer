
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173", // Vite default port
        methods: ["GET", "POST"]
    }
});

let sessionData = [];

// API Endpoints
app.post('/api/session/start', (req, res) => {
    const session = {
        id: Date.now(),
        startTime: new Date(),
        exercise: req.body.exercise,
        logs: []
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

app.get('/api/session/:id/summary', (req, res) => {
    const session = sessionData.find(s => s.id == req.params.id);
    if (session) {
        const totalReps = session.logs.length;
        // Calculate accuracy based on reps vs errors (simplified)
        const errors = session.logs.filter(l => l.isError).length;
        const averageAccuracy = totalReps > 0 ? Math.round(((totalReps - (errors * 0.5)) / totalReps) * 100) : 0;

        res.json({
            id: session.id,
            exercise: session.exercise,
            totalReps,
            averageAccuracy: Math.max(0, averageAccuracy),
            duration: (new Date() - session.startTime) / 1000
        });
    } else {
        res.status(404).send('Session not found');
    }
});

// Socket.io for real-time (optional telemetry)
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('workout_telemetry', (data) => {
        // Broadcast for trainer view if implemented
        socket.broadcast.emit('trainer_view', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
