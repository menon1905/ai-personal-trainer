import React, { useEffect, useRef, useState } from 'react';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { POSE_CONNECTIONS } from '@mediapipe/pose';
import { setupPose, startCamera } from './utils/camera';
import { calculateAngle, EXERCISE_CONFIGS, WorkoutStateMachine } from './utils/engine';
import { Activity, Play, Square, Video, ShieldCheck, Download, AlertTriangle } from 'lucide-react';

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [exercise, setExercise] = useState('SQUAT');
  const [reps, setReps] = useState(0);
  const [feedback, setFeedback] = useState('Aguardando início...');
  const [isWorkoutActive, setIsWorkoutActive] = useState(false);
  const [currentAngle, setCurrentAngle] = useState(180);

  const stateMachineRef = useRef(new WorkoutStateMachine(EXERCISE_CONFIGS.SQUAT));
  const [isBodyDetected, setIsBodyDetected] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(true);
  const lastDetectionRef = useRef(Date.now());
  const lastFeedbackTimeRef = useRef(0);
  const [videoBlob, setVideoBlob] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);

  const speak = (text, priority = false) => {
    if ('speechSynthesis' in window) {
      const now = Date.now();
      if (!priority && now - lastFeedbackTimeRef.current < 2500) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
      lastFeedbackTimeRef.current = now;
    }
  };

  const startWorkout = async () => {
    stateMachineRef.current = new WorkoutStateMachine(EXERCISE_CONFIGS[exercise]);
    stateMachineRef.current.reset();
    setReps(0);
    setVideoBlob(null);
    setDiagnostics(null);
    setIsWorkoutActive(true);
    setFeedback('Iniciando...');
    speak(`Iniciando análise de ${EXERCISE_CONFIGS[exercise].name}. Concentre-se na execução!`, true);
    startRecording();
  };

  const startRecording = () => {
    if (!canvasRef.current) return;
    recordedChunksRef.current = [];

    // Capture from CANVAS (includes the skeleton/pose drawing)
    const stream = canvasRef.current.captureStream(30);

    const options = { mimeType: 'video/webm;codecs=vp8' };

    try {
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        setVideoBlob(blob);
      };
      // Important: provide a timeslice (1000ms) to ensure the file is not corrupted on end
      mediaRecorderRef.current.start(1000);
    } catch (err) { console.error("Recording error:", err); }
  };

  const stopWorkout = () => {
    setIsWorkoutActive(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    const report = stateMachineRef.current.getSummary();
    setDiagnostics(report);
    setFeedback('Treino finalizado');
    speak('Treino finalizado. Confira seu diagnóstico.');
  };

  const downloadVideo = () => {
    if (!videoBlob) return;

    const url = URL.createObjectURL(videoBlob);
    const a = document.createElement('a');
    document.body.appendChild(a);
    a.style.display = 'none';
    a.href = url;

    // Check extension based on blob type
    const extension = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    a.download = `treino_${exercise}_${new Date().toLocaleDateString().replace(/\//g, '-')}.${extension}`;

    a.click();

    // Small delay to ensure browser handles the download before revoking the URL
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  };

  const [statusColor, setStatusColor] = useState('#00f2fe');

  const onPoseResults = (results) => {
    if (!canvasRef.current || !videoRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const width = videoRef.current.videoWidth || 640;
    const height = videoRef.current.videoHeight || 480;

    if (isCameraLoading && videoRef.current.videoWidth > 0) setIsCameraLoading(false);
    canvasRef.current.width = width;
    canvasRef.current.height = height;

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(results.image, 0, 0, width, height);

    if (results.poseLandmarks && results.poseLandmarks.length > 0) {
      setIsBodyDetected(true);
      lastDetectionRef.current = Date.now();

      const isError = isWorkoutActive && (stateMachineRef.current.isCorrecting || feedback.toLowerCase().includes('inválid'));
      const color = isError ? '#ff4d4d' : '#00ff88';
      setStatusColor(color);

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
          const oldFeedback = stateMachineRef.current.feedback;

          stateMachineRef.current.update(angle, landmarks);

          if (stateMachineRef.current.feedback !== oldFeedback) {
            setFeedback(stateMachineRef.current.feedback);
            if (isError || stateMachineRef.current.reps > oldReps) {
              speak(stateMachineRef.current.feedback, stateMachineRef.current.reps > oldReps);
            }
          }

          if (stateMachineRef.current.reps > oldReps) {
            setReps(stateMachineRef.current.reps);
            speak(`${stateMachineRef.current.reps} repetições`, true);
          }
        }
      }
    } else {
      if (Date.now() - lastDetectionRef.current > 1500) {
        setIsBodyDetected(false);
        if (isWorkoutActive && feedback !== 'Corpo não detectado!') {
          setFeedback('Corpo não detectado!');
          speak('Por favor, volte para a área visível.');
        }
      }
    }
    ctx.restore();
  };

  useEffect(() => {
    const pose = setupPose(onPoseResults);
    const camera = startCamera(videoRef.current, pose);
    return () => { camera.stop(); pose.close(); };
  }, [exercise, isWorkoutActive]);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Activity color="#00f2fe" size={32} />
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>AI TRAINER PRO</h1>
        </div>

        <nav style={{ flex: 1, marginTop: '20px' }}>
          <div className="stat-card" style={{ marginBottom: '15px' }}>
            <div className="stat-label">Exercício</div>
            <select value={exercise} disabled={isWorkoutActive} onChange={(e) => setExercise(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.1rem', cursor: 'pointer', width: '100%', marginTop: '5px' }}>
              <option value="SQUAT">Agachamento</option>
              <option value="PUSHUP">Flexão</option>
              <option value="LUNGE">Afundo</option>
              <option value="BICEP_CURL">Rosca Direta</option>
            </select>
          </div>
          <div className="stat-card" style={{ marginBottom: '15px' }}>
            <div className="stat-label">Reps Válidas</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{reps}</div>
          </div>
          <div className="stat-card" style={{ marginBottom: '15px' }}>
            <div className="stat-label">Ângulo Bio-Mecânico</div>
            <div className="stat-value">{currentAngle}°</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sistema Anti-Fraude</div>
            <div className="stat-value" style={{ fontSize: '1rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '10px' }}>
              <ShieldCheck size={16} /> Monitorando
            </div>
          </div>
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {!isWorkoutActive ? (
            <button className="btn" style={{ width: '100%' }} onClick={startWorkout}>
              <Play size={18} /> Iniciar Treino
            </button>
          ) : (
            <button className="btn" style={{ width: '100%', background: 'var(--error)', color: '#fff' }} onClick={stopWorkout}>
              <Square size={18} /> Finalizar Sessão
            </button>
          )}
        </div>
      </aside>

      <main className="main-view">
        {feedback && isWorkoutActive && (
          <div className={`feedback-overlay ${feedback.includes('!') || feedback.includes('curto') ? 'feedback-red' : 'feedback-green'}`}>
            {feedback}
          </div>
        )}

        <video ref={videoRef} className="camera-feed" style={{ visibility: 'hidden', position: 'absolute' }} playsInline muted />
        {isCameraLoading && (
          <div style={{ position: 'absolute', color: '#fff', textAlign: 'center' }}>
            <Activity className="animate-spin" size={32} color="var(--primary)" />
            <p>Conectando Visão Computacional...</p>
          </div>
        )}
        <canvas ref={canvasRef} className="canvas-overlay" />

        {!isWorkoutActive && (
          <div style={{ position: 'absolute', zIndex: 10, textAlign: 'center', background: 'rgba(0,0,0,0.92)', padding: '40px', borderRadius: '30px', backdropFilter: 'blur(20px)', maxWidth: '500px', border: '1px solid rgba(255,255,255,0.1)' }}>
            {!diagnostics ? (
              <>
                <h1 style={{ margin: 0, fontSize: '2.5rem', background: 'linear-gradient(to right, #00f2fe, #4facfe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800 }}>Treinador de Elite</h1>
                <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: '15px' }}>Sua análise bio-mecânica será gravada e salva localmente para envio ao personal.</p>
              </>
            ) : (
              <div style={{ textAlign: 'left' }}>
                <h2 style={{ margin: 0, color: 'var(--success)' }}>Diagnóstico Final</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '20px' }}>
                  <div className="stat-card"><div className="stat-label">Reps Perfeitas</div><div className="stat-value">{diagnostics.totalReps}</div></div>
                  <div className="stat-card"><div className="stat-label">Tentativas</div><div className="stat-value">{diagnostics.totalAttempts}</div></div>
                </div>

                <div style={{ marginTop: '20px', background: 'rgba(255,165,0,0.1)', padding: '15px', borderRadius: '15px', border: '1px solid rgba(255,165,0,0.2)' }}>
                  <h4 style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ffa500' }}>
                    <AlertTriangle size={18} /> PONTOS DE MELHORIA:
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: 'rgba(255,255,255,0.8)' }}>
                    {diagnostics.criticalErrors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </div>

                <div style={{ marginTop: '25px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn" style={{ flex: 1 }} onClick={downloadVideo} disabled={!videoBlob}>
                      <Download size={18} /> Baixar Vídeo
                    </button>
                    <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.1)', color: '#fff' }} onClick={() => setDiagnostics(null)}>
                      Nova Sessão
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                    Tip: Se o vídeo não abrir, arraste-o para o Google Chrome ou use o VLC Player.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
