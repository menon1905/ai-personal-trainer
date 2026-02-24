
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
        joints: {
            p1: 24, // hip
            p2: 26, // knee
            p3: 28  // ankle
        },
        thresholds: {
            up: 165,
            down: 95,
        },
        correctionThresholds: {
            backStraight: { joint: [12, 24, 26], minAngle: 60, msg: 'Mantenha as costas retas!' }
        }
    },
    PUSHUP: {
        name: 'Flexão de Braço',
        joints: {
            p1: 12, // shoulder
            p2: 14, // elbow
            p3: 16  // wrist
        },
        thresholds: {
            up: 160,
            down: 80,
        }
    },
    LUNGE: {
        name: 'Afundo',
        joints: {
            p1: 24, // hip
            p2: 26, // knee
            p3: 28  // ankle
        },
        thresholds: {
            up: 165,
            down: 100,
        }
    },
    PLANK: {
        name: 'Prancha',
        joints: {
            p1: 12, // shoulder
            p2: 24, // hip
            p3: 26  // knee
        },
        thresholds: {
            up: 185,
            down: 170, // Needs to stay in between
        },
        type: 'hold'
    },
    BICEP_CURL: {
        name: 'Rosca Direta',
        joints: {
            p1: 12, // shoulder
            p2: 14, // elbow
            p3: 16  // wrist
        },
        thresholds: {
            up: 40,
            down: 150,
        },
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

        const { up, down } = this.config.thresholds;

        // Rep counting logic
        if (this.state === 0 && currentAngle < up - 10) {
            this.state = 1; // Descending/Contracting
            this.feedback = 'Desça...';
        } else if (this.state === 1 && currentAngle <= down) {
            this.state = 2; // Bottom/Peak
            this.feedback = 'Excelente! Agora suba.';
        } else if (this.state === 2 && currentAngle > down + 10) {
            this.state = 3; // Ascending/Extending
            this.feedback = 'Subindo...';
        } else if (this.state === 3 && currentAngle >= up - 10) {
            this.state = 0; // Back to start
            this.reps++;
            this.feedback = 'Boa! Continue.';
        }

        // Dynamic Correction Feedback
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
                } else {
                    this.isCorrecting = false;
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
