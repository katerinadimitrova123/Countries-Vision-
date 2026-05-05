import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

function detectGesture(lm) {
  const wrist = lm[0];
  const fingers = [
    { tip: 8, pip: 6 },
    { tip: 12, pip: 10 },
    { tip: 16, pip: 14 },
    { tip: 20, pip: 18 },
  ];
  let curled = 0;
  let extended = 0;
  for (const f of fingers) {
    const tipDist = dist3(lm[f.tip], wrist);
    const pipDist = dist3(lm[f.pip], wrist);
    if (tipDist < pipDist * 1.05) curled++;
    else extended++;
  }
  // Index extended, others curled = pointing
  const indexExtended =
    dist3(lm[8], wrist) > dist3(lm[6], wrist) * 1.1;
  const middleCurled =
    dist3(lm[12], wrist) < dist3(lm[10], wrist) * 1.05;
  const ringCurled =
    dist3(lm[16], wrist) < dist3(lm[14], wrist) * 1.05;

  if (curled === 4) return 'fist';
  if (indexExtended && middleCurled && ringCurled) return 'point';
  if (extended >= 3) return 'open';
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
    numHands: 2,
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

        // If two hands are visible, compute the distance between palm centers
        // (in image-normalized coords) so main.js can detect a clap.
        let twoHandsDist = null;
        if (result.landmarks.length >= 2) {
          const a = result.landmarks[0];
          const b = result.landmarks[1];
          // Average wrist + middle finger MCP for a more stable palm center
          const palmA = {
            x: (a[0].x + a[9].x) / 2,
            y: (a[0].y + a[9].y) / 2,
          };
          const palmB = {
            x: (b[0].x + b[9].x) / 2,
            y: (b[0].y + b[9].y) / 2,
          };
          twoHandsDist = Math.hypot(palmA.x - palmB.x, palmA.y - palmB.y);
        }

        onHand({
          x: smoothX,
          y: smoothY,
          gesture,
          landmarks: lm,
          twoHandsDist,
        });
      } else {
        onHand(null);
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
}
