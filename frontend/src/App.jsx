
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { POSE_CONNECTIONS } from '@mediapipe/pose';
import { setupPose, startCamera } from './utils/camera';
import { calculateAngle, EXERCISE_CONFIGS, WorkoutStateMachine } from './utils/engine';
import { Activity, Play, Square, Settings, User, BarChart } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const socket = io(BACKEND_URL);

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [exercise, setExercise] = useState('SQUAT');
  const [reps, setReps] = useState(0);
  const [feedback, setFeedback] = useState('Aguardando início...');
  const [isWorkoutActive, setIsWorkoutActive] = useState(false);
  const [accuracy, setAccuracy] = useState(100);
  const [currentAngle, setCurrentAngle] = useState(180);

  const stateMachineRef = useRef(new WorkoutStateMachine(EXERCISE_CONFIGS.SQUAT));
  const sessionIdRef = useRef(null);
  const [isBodyDetected, setIsBodyDetected] = useState(false);
  const lastDetectionRef = useRef(Date.now());

  // Voice Feedback
  const speak = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Interrupt current speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      window.speechSynthesis.speak(utterance);
    }
  };

  const startWorkout = async () => {
    try {
      const resp = await fetch('http://localhost:3001/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise })
      });
      const data = await resp.json();
      sessionIdRef.current = data.id;

      stateMachineRef.current = new WorkoutStateMachine(EXERCISE_CONFIGS[exercise]);
      setReps(0);
      setIsWorkoutActive(true);
      speak('Iniciando treino de ' + EXERCISE_CONFIGS[exercise].name);
    } catch (err) {
      console.error("Backend error:", err);
      // Fallback for local-only if backend is down
      setIsWorkoutActive(true);
    }
  };

  const [summary, setSummary] = useState(null);

  const stopWorkout = async () => {
    setIsWorkoutActive(false);
    speak('Treino finalizado. Bom trabalho!');

    if (sessionIdRef.current) {
      try {
        const resp = await fetch(`http://localhost:3001/api/session/${sessionIdRef.current}/summary`);
        const data = await resp.json();
        setSummary(data);
      } catch (err) {
        console.error("Summary error:", err);
      }
    }
  };

  const [statusColor, setStatusColor] = useState('#00f2fe');

  const onPoseResults = (results) => {
    if (!canvasRef.current || !videoRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    const width = canvasRef.current.width = videoRef.current.videoWidth;
    const height = canvasRef.current.height = videoRef.current.videoHeight;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Draw the camera frame
    ctx.drawImage(results.image, 0, 0, width, height);

    if (results.poseLandmarks && results.poseLandmarks.length > 0) {
      setIsBodyDetected(true);
      lastDetectionRef.current = Date.now();
      const isError = stateMachineRef.current.isCorrecting || feedback.includes('!');
      const color = isError ? '#ff4d4d' : '#00ff88';
      setStatusColor(color);

      // Draw Skeleton with Dynamic Color
      drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: color, lineWidth: 3 });
      drawLandmarks(ctx, results.poseLandmarks, { color: '#ffffff', lineWidth: 1, radius: 2 });

      if (isWorkoutActive) {
        const landmarks = results.poseLandmarks;
        const config = EXERCISE_CONFIGS[exercise];

        const p1 = landmarks[config.joints.p1];
        const p2 = landmarks[config.joints.p2];
        const p3 = landmarks[config.joints.p3];

        if (p1 && p2 && p3) {
          const angle = calculateAngle(p1, p2, p3);
          setCurrentAngle(Math.round(angle));

          const oldReps = stateMachineRef.current.reps;
          stateMachineRef.current.update(angle, landmarks);

          if (stateMachineRef.current.reps > oldReps) {
            setReps(stateMachineRef.current.reps);
            speak(stateMachineRef.current.reps.toString());

            if (sessionIdRef.current) {
              fetch(`http://localhost:3001/api/session/${sessionIdRef.current}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rep: stateMachineRef.current.reps, angle, isError })
              });
            }
          }

          if (stateMachineRef.current.feedback !== feedback) {
            setFeedback(stateMachineRef.current.feedback);
            if (isError) speak(stateMachineRef.current.feedback);
          }
        }
      }
    } else {
      // Body not detected
      if (Date.now() - lastDetectionRef.current > 1000) {
        setIsBodyDetected(false);
        if (isWorkoutActive && feedback !== 'Corpo não detectado!') {
          setFeedback('Corpo não detectado!');
          setStatusColor('#ffa500'); // Orange warning
        }
      }
    }
    ctx.restore();
  };

  useEffect(() => {
    const pose = setupPose(onPoseResults);
    const camera = startCamera(videoRef.current, pose);

    return () => {
      camera.stop();
      pose.close();
    };
  }, [exercise, isWorkoutActive]);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Activity color="#00f2fe" size={32} />
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>AI Trainer</h2>
        </div>

        <nav style={{ flex: 1, marginTop: '20px' }}>
          <div className="stat-card" style={{ marginBottom: '15px' }}>
            <div className="stat-label">Exercício</div>
            <select
              value={exercise}
              onChange={(e) => setExercise(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.1rem', cursor: 'pointer', width: '100%', marginTop: '5px' }}
            >
              <option value="SQUAT">Agachamento</option>
              <option value="PUSHUP">Flexão</option>
              <option value="LUNGE">Afundo</option>
              <option value="PLANK">Prancha (Beta)</option>
              <option value="BICEP_CURL">Rosca Direta</option>
            </select>
          </div>

          <div className="stat-card" style={{ marginBottom: '15px' }}>
            <div className="stat-label">Repetições</div>
            <div className="stat-value">{reps}</div>
          </div>

          <div className="stat-card" style={{ marginBottom: '15px' }}>
            <div className="stat-label">Ângulo Atual</div>
            <div className="stat-value">{currentAngle}°</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Precisão Técnica</div>
            <div className="stat-value" style={{ color: '#00ff88' }}>{accuracy}%</div>
          </div>
        </nav>

        <div style={{ display: 'flex', gap: '10px' }}>
          {!isWorkoutActive ? (
            <button className="btn" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={startWorkout}>
              <Play size={18} /> Iniciar
            </button>
          ) : (
            <button className="btn" style={{ flex: 1, background: 'var(--error)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={stopWorkout}>
              <Square size={18} /> Parar
            </button>
          )}
        </div>
      </aside>

      <main className="main-view">
        {feedback && isWorkoutActive && (
          <div className={`feedback-overlay ${feedback.includes('!') ? 'feedback-red' : 'feedback-green'}`}>
            {feedback}
          </div>
        )}

        <video
          ref={videoRef}
          className="camera-feed"
          style={{ visibility: 'hidden', position: 'absolute' }}
          playsInline
        />
        <canvas ref={canvasRef} className="canvas-overlay" />

        {isWorkoutActive && !isBodyDetected && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(255, 165, 0, 0.2)', color: '#ffa500', padding: '20px', borderRadius: '15px', border: '2px solid #ffa500', backdropFilter: 'blur(10px)', zIndex: 20, textAlign: 'center' }}>
            <Activity size={48} style={{ marginBottom: '10px' }} />
            <h3 style={{ margin: 0 }}>Corpo não detectado</h3>
            <p style={{ margin: '5px 0 0' }}>Posicione-se em frente à câmera</p>
          </div>
        )}

        {!isWorkoutActive && (
          <div style={{ position: 'absolute', zIndex: 5, textAlign: 'center', background: 'rgba(0,0,0,0.85)', padding: '40px', borderRadius: '30px', backdropFilter: 'blur(15px)', maxWidth: '400px', border: '1px solid rgba(255,255,255,0.1)' }}>
            {!summary ? (
              <>
                <h1 style={{ margin: 0, fontSize: '2.5rem', background: 'linear-gradient(to right, #00f2fe, #4facfe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Pronto para o treino?</h1>
                <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: '10px' }}>Escolha um exercício e clique em iniciar para que a IA analise seus movimentos em tempo real.</p>
              </>
            ) : (
              <>
                <h1 style={{ margin: 0, fontSize: '2.5rem', color: 'var(--success)' }}>Treino Concluído!</h1>
                <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', textAlign: 'left' }}>
                  <div className="stat-card">
                    <div className="stat-label">Total Reps</div>
                    <div className="stat-value" style={{ fontSize: '1.5rem' }}>{summary.totalReps}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Precisão</div>
                    <div className="stat-value" style={{ fontSize: '1.5rem', color: 'var(--success)' }}>{summary.averageAccuracy}%</div>
                  </div>
                </div>
                <button className="btn" style={{ marginTop: '20px', width: '100%' }} onClick={() => { setSummary(null); setReps(0); }}>Novo Treino</button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
