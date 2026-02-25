
/**
 * Biomechanical Engine for AI Personal Trainer
 */

export const calculateAngle = (p1, p2, p3) => {
    if (!p1 || !p2 || !p3) return 180;
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);

    if (angle > 180.0) {
        angle = 360 - angle;
    }

    return angle;
};

export const EXERCISE_CONFIGS = {
    SQUAT: {
        name: 'Agachamento',
        joints: { p1: 24, p2: 26, p3: 28 }, // hip, knee, ankle
        thresholds: { up: 165, down: 110 },
        validate: (landmarks) => {
            const shoulderY = landmarks[12].y;
            const hipY = landmarks[24].y;
            const kneeY = landmarks[26].y;
            const ankleY = landmarks[28].y;

            const isStanding = shoulderY < hipY && hipY < kneeY;
            const isVisible = landmarks[24].visibility > 0.6 && landmarks[28].visibility > 0.6;

            // Check if too close to bottom edge (ankles)
            const isTooClose = ankleY > 0.95 || shoulderY < 0.05;

            if (!isVisible) return 'Afastar: Pés não visíveis!';
            if (!isStanding) return 'Fique de pé para começar!';
            if (isTooClose) return 'Centralize o corpo na tela!';

            return true;
        },
        requiresDisplacement: true,
        displacementJoint: 24, // hip
        minDisplacement: 0.12,  // Hip must move at least 12% of screen height
        invalidMsg: 'Posicione o corpo inteiro na câmera!',
        correctionThresholds: {
            backStraight: { joint: [12, 24, 26], minAngle: 60, msg: 'Mantenha as costas retas!' },
            kneeForward: { joint: [24, 26, 28], minAngle: 70, msg: 'Não jogue o joelho muito à frente!' }
        }
    },
    PUSHUP: {
        name: 'Flexão de Braço',
        joints: { p1: 12, p2: 14, p3: 16 }, // shoulder, elbow, wrist
        thresholds: { up: 160, down: 90 },
        validate: (landmarks) => {
            const shoulderY = landmarks[12].y;
            const hipY = landmarks[24].y;
            const diff = Math.abs(shoulderY - hipY);
            const isHorizontal = diff < 0.25 && Math.abs(landmarks[12].x - landmarks[24].x) > 0.2;
            const isVisible = landmarks[12].visibility > 0.6 && landmarks[14].visibility > 0.6;

            if (!isVisible) return 'Braço não visível!';
            if (!isHorizontal) return 'Fique na horizontal!';

            return true;
        },
        requiresDisplacement: true,
        displacementJoint: 12, // shoulder
        minDisplacement: 0.08,
        invalidMsg: 'Posicione-se para a flexão!',
        correctionThresholds: {
            hipDropping: { joint: [12, 24, 26], minAngle: 155, msg: 'Não deixe o quadril cair!' }
        }
    },
    LUNGE: {
        name: 'Afundo',
        joints: { p1: 24, p2: 26, p3: 28 },
        thresholds: { up: 165, down: 110 },
        validate: (landmarks) => landmarks[12].y < landmarks[24].y && landmarks[24].visibility > 0.5,
        requiresDisplacement: true,
        displacementJoint: 24,
        minDisplacement: 0.1,
        invalidMsg: 'Fique de pé e apareça por inteiro!'
    },
    PLANK: {
        name: 'Prancha',
        joints: { p1: 12, p2: 24, p3: 26 },
        thresholds: { up: 185, down: 170 },
        type: 'hold',
        validate: (landmarks) => Math.abs(landmarks[12].y - landmarks[24].y) < 0.1
    },
    BICEP_CURL: {
        name: 'Rosca Direta',
        joints: { p1: 12, p2: 14, p3: 16 },
        thresholds: { up: 150, down: 50 }, // Up (extended) -> Down (contracted)
        validate: (landmarks) => {
            const isVisible = landmarks[12].visibility > 0.7 && landmarks[14].visibility > 0.7 && landmarks[16].visibility > 0.7;
            const isStanding = landmarks[12].y < landmarks[24].y;
            return isVisible && isStanding;
        },
        requiresDisplacement: true,
        displacementJoint: 16, // wrist
        minDisplacement: 0.20, // Increased: Wrist must move at least 20% of screen height
        invalidMsg: 'Posicione o braço inteiro de forma visível!',
        correctionThresholds: {
            elbowStatic: { joint: [12, 14, 24], minAngle: 165, msg: 'Mantenha o cotovelo parado junto ao corpo!' }
        }
    }
};

export class WorkoutStateMachine {
    constructor(config) {
        this.config = config;
        this.state = 0; // 0: Start, 1: Moving to target, 2: At target, 3: Returning
        this.reps = 0;
        this.feedback = '';
        this.lastAngle = null;
        this.startJointPos = null;
        this.maxDisplacement = 0;
        this.isCorrecting = false;
        this.repHasError = false; // Track if current rep has a posture error
        this.diagnostics = {
            shortMovement: 0,
            badPosture: {},
            totalAttempts: 0
        };
    }

    update(currentAngle, landmarks) {
        // Step 0: Visibility Check
        const jointConfig = this.config.joints;
        if (!landmarks[jointConfig.p1] || !landmarks[jointConfig.p2] || !landmarks[jointConfig.p3]) {
            this.feedback = 'Articulações não visíveis!';
            return;
        }

        // Step 1: Validate Position
        const validationResult = this.config.validate ? this.config.validate(landmarks) : true;
        if (validationResult !== true) {
            this.feedback = typeof validationResult === 'string' ? validationResult : (this.config.invalidMsg || 'Posição inválida!');
            this.isCorrecting = true;
            return;
        }

        const { up, down } = this.config.thresholds;

        // Anti-Cheat: Displacement Tracking
        if (this.config.requiresDisplacement) {
            const currentPos = landmarks[this.config.displacementJoint].y;
            if (this.state === 0) {
                this.startJointPos = currentPos;
                this.maxDisplacement = 0;
            } else {
                const displacement = Math.abs(currentPos - this.startJointPos);
                if (displacement > this.maxDisplacement) this.maxDisplacement = displacement;
            }
        }

        // Rep counting logic
        const isFlexionExercise = up > down;

        if (this.state === 0) {
            const isAtStart = isFlexionExercise ? currentAngle >= up - 10 : currentAngle <= up + 10;
            if (isAtStart) {
                this.feedback = 'Comece o movimento!';
                this.startJointPos = landmarks[this.config.displacementJoint]?.y || 0;
                this.maxDisplacement = 0;
            } else {
                this.state = 1;
                this.repHasError = false; // Reset error flag for new attempt
                this.diagnostics.totalAttempts++;
            }
        }

        if (this.state === 1) {
            const hasReachedTarget = isFlexionExercise ? currentAngle <= down : currentAngle >= down;
            if (hasReachedTarget) {
                this.state = 2;
                this.feedback = 'Excelente! Agora volte.';
            } else {
                this.feedback = 'Continue descendo...';
            }
        } else if (this.state === 2) {
            const isReturning = isFlexionExercise ? currentAngle > down + 20 : currentAngle < down - 20;
            if (isReturning) {
                this.state = 3;
            }
        } else if (this.state === 3) {
            const isBackAtStart = isFlexionExercise ? currentAngle >= up - 15 : currentAngle <= up + 15;
            if (isBackAtStart) {
                let cheated = false;
                if (this.config.requiresDisplacement && this.maxDisplacement < this.config.minDisplacement) {
                    this.feedback = 'Movimento muito curto!';
                    this.diagnostics.shortMovement++;
                    cheated = true;
                }

                if (this.repHasError) {
                    this.feedback = 'Repetição inválida: Corrija a postura!';
                    cheated = true;
                }

                if (!cheated) {
                    this.reps++;
                    this.feedback = 'Boa repetição!';
                }
                this.state = 0;
            }
        }

        // Dynamic Correction Feedback
        this.isCorrecting = false;
        if (this.config.correctionThresholds) {
            Object.values(this.config.correctionThresholds).forEach(rule => {
                const angle = calculateAngle(
                    landmarks[rule.joint[0]],
                    landmarks[rule.joint[1]],
                    landmarks[rule.joint[2]]
                );
                if (angle < rule.minAngle) {
                    this.feedback = rule.msg;
                    this.isCorrecting = true;
                    if (this.state !== 0) this.repHasError = true; // Invalidate rep if error occurs during movement
                    this.diagnostics.badPosture[rule.msg] = (this.diagnostics.badPosture[rule.msg] || 0) + 1;
                }
            });
        }

        this.lastAngle = currentAngle;
    }

    getSummary() {
        const sortedPostureErrors = Object.entries(this.diagnostics.badPosture)
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0]);

        const criticalErrors = [];
        if (this.diagnostics.shortMovement > 0) criticalErrors.push('Aumentar amplitude');
        if (sortedPostureErrors.length > 0) criticalErrors.push(...sortedPostureErrors.slice(0, 2));

        // Logical fix for empty sessions
        if (this.reps === 0 && this.diagnostics.totalAttempts === 0) {
            criticalErrors.push('Nenhuma repetição iniciada. Posicione-se em frente à câmera.');
        } else if (this.reps === 0 && this.diagnostics.totalAttempts > 0) {
            criticalErrors.push('Tentativas detectadas, mas nenhuma repetição foi válida. Melhore a técnica.');
        } else if (criticalErrors.length === 0) {
            criticalErrors.push('Execução perfeita!');
        }

        return {
            totalReps: this.reps,
            totalAttempts: this.diagnostics.totalAttempts,
            criticalErrors
        };
    }

    reset() {
        this.reps = 0;
        this.state = 0;
        this.feedback = '';
        this.startJointPos = null;
        this.maxDisplacement = 0;
        this.diagnostics = { shortMovement: 0, badPosture: {}, totalAttempts: 0 };
    }
}
