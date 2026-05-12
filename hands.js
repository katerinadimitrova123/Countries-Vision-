import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleAt(joint, a, b) {
  const v1x = a.x - joint.x, v1y = a.y - joint.y;
  const v2x = b.x - joint.x, v2y = b.y - joint.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (mag === 0) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag)));
}

const CURL_THRESHOLD = 2.0; // ~115° — finger is curled if PIP angle < this
function isCurled(lm, mcp, pip, tip) {
  return angleAt(lm[pip], lm[mcp], lm[tip]) < CURL_THRESHOLD;
}

function detectGesture(lm) {
  const indexCurled = isCurled(lm, 5, 6, 8);
  const middleCurled = isCurled(lm, 9, 10, 12);
  const ringCurled = isCurled(lm, 13, 14, 16);
  const pinkyCurled = isCurled(lm, 17, 18, 20);
  // Thumb: extended if tip is much farther from wrist than IP
  const thumbExtended =
    dist2(lm[4], lm[0]) > dist2(lm[3], lm[0]) * 1.15;

  const downCount =
    (indexCurled ? 1 : 0) + (middleCurled ? 1 : 0) +
    (ringCurled ? 1 : 0) + (pinkyCurled ? 1 : 0);

  // Victory ✌️ : index + middle extended, ring + pinky curled
  if (!indexCurled && !middleCurled && ringCurled && pinkyCurled) {
    return 'victory';
  }
  // ILoveYou 🤟 : thumb + index + pinky extended, middle + ring curled
  if (thumbExtended && !indexCurled && middleCurled && ringCurled && !pinkyCurled) {
    return 'love';
  }
  // Fist: all four fingers curled
  if (downCount === 4) return 'fist';
  // Open palm: 3+ extended
  if (downCount <= 1) return 'open';
  return 'partial';
}


export async function setupHands(onHand) {
  const video = document.getElementById('video');

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm'
  );
  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
  });

  // Smoothing for cursor
  let smoothX = 0.5, smoothY = 0.5;
  const SMOOTHING = 0.35;

  let lastVideoTime = -1;
  function loop() {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = handLandmarker.detectForVideo(video, performance.now());
      if (result.landmarks && result.landmarks.length > 0) {
        const lm = result.landmarks[0];
        // Use the average of index tip + middle tip for a stable cursor
        const ax = (lm[8].x + lm[12].x) / 2;
        const ay = (lm[8].y + lm[12].y) / 2;
        // Webcam is mirrored on screen, so flip x
        let nx = 1 - ax;
        let ny = ay;
        // Expand range so the user doesn't need full reach
        nx = Math.max(0, Math.min(1, (nx - 0.15) / 0.7));
        ny = Math.max(0, Math.min(1, (ny - 0.15) / 0.7));

        smoothX = smoothX + (nx - smoothX) * SMOOTHING;
        smoothY = smoothY + (ny - smoothY) * SMOOTHING;

        const gesture = detectGesture(lm);

        onHand({
          x: smoothX,
          y: smoothY,
          gesture,
          rawGesture: gesture,
          landmarks: lm,
        });
      } else {
        onHand(null);
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
}
