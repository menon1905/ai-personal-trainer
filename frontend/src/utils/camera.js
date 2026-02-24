
import { Pose } from '@mediapipe/pose';
import * as cam from '@mediapipe/camera_utils';

export const setupPose = (onResults) => {
    const pose = new Pose({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        },
    });

    pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });

    pose.onResults(onResults);

    return pose;
};

export const startCamera = (videoElement, poseInstance) => {
    const camera = new cam.Camera(videoElement, {
        onFrame: async () => {
            await poseInstance.send({ image: videoElement });
        },
        width: 640,
        height: 480,
    });
    camera.start();
    return camera;
};
