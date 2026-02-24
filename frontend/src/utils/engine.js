
/**
 * Biomechanical Engine for AI Personal Trainer
 */

export const calculateAngle = (p1, p2, p3) => {
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
        thresholds: { up: 165, down: 100 },
        validate: (landmarks) => {
            // Must be standing: Shoulder y < Hip y < Knee y
            const shoulderY = landmarks[12].y;
            const hipY = landmarks[24].y;
            const kneeY = landmarks[26].y;
            return shoulderY < hipY && hipY < kneeY;
        },
        invalidMsg: 'Fique de pé para começar o agachamento!',
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
            // Must be horizontal: Shoulder Y and Hip Y should be similar
            const shoulderY = landmarks[12].y;
            const hipY = landmarks[24].y;
            const diff = Math.abs(shoulderY - hipY);
            // In pushup position, shoulders and hips should be relatively close in Y
            return diff < 0.15 && Math.abs(landmarks[12].x - landmarks[24].x) > 0.1;
        },
        invalidMsg: 'Parece que você está sentado. Posicione-se para flexão!',
        correctionThresholds: {
            hipDropping: { joint: [12, 24, 26], minAngle: 155, msg: 'Não deixe o quadril cair!' }
        }
    },
    LUNGE: {
        name: 'Afundo',
        joints: { p1: 24, p2: 26, p3: 28 },
        thresholds: { up: 165, down: 110 },
        validate: (landmarks) => landmarks[12].y < landmarks[24].y,
        invalidMsg: 'Fique de pé para o afundo!'
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
        thresholds: { up: 40, down: 150 },
        validate: (landmarks) => landmarks[12].y < landmarks[24].y,
        invalidMsg: 'Fique de pé para melhor execução!'
    }
};

export class WorkoutStateMachine {
    constructor(config) {
        this.config = config;
        this.state = 0; // 0: Up/Start, 1: Descending, 2: Max/Bottom, 3: Ascending
        this.reps = 0;
        this.feedback = '';
        this.lastAngle = null;
    }

    update(currentAngle, landmarks) {
        if (this.lastAngle === null) {
            this.lastAngle = currentAngle;
            return;
        }

        // Step 1: Validate Position (Anti-Sitting Logic)
        if (this.config.validate && !this.config.validate(landmarks)) {
            this.feedback = this.config.invalidMsg || 'Posição inválida!';
            this.isValidPosition = false;
            this.isCorrecting = true;
            this.lastAngle = currentAngle;
            return;
        }
        this.isValidPosition = true;

        const { up, down } = this.config.thresholds;

        // Rep counting logic
        if (this.state === 0 && currentAngle < up - 15) {
            this.state = 1;
            this.feedback = 'Desça mais...';
        } else if (this.state === 1 && currentAngle <= down) {
            this.state = 2;
            this.feedback = 'Excelente! Agora suba.';
        } else if (this.state === 2 && currentAngle > down + 15) {
            this.state = 3;
            this.feedback = 'Subindo...';
        } else if (this.state === 3 && currentAngle >= up - 15) {
            this.state = 0;
            this.reps++;
            this.feedback = 'Perfeito!';
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
                }
            });
        }

        this.lastAngle = currentAngle;
    }

    reset() {
        this.reps = 0;
        this.state = 0;
        this.feedback = '';
    }
}
