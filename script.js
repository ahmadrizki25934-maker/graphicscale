const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const fpsCounter = document.getElementById("fps-counter");

// Cache Offscreen Canvas super kecil untuk performa efek pikselasi instan dan sangat ringan
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d");

// ===== STATE CONFIGURATION & OPTIMIZED LERP =====
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;
let globalTime = 0;

const hudFrame = {
    topLeft:     { x: 0, y: 0, targetX: 0, targetY: 0 },
    bottomLeft:  { x: 0, y: 0, targetX: 0, targetY: 0 },
    topRight:    { x: 0, y: 0, targetX: 0, targetY: 0 },
    bottomRight: { x: 0, y: 0, targetX: 0, targetY: 0 },
    opacity: 0, 
    isValid: false
};

// Inisialisasi MediaPipe Hands
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1, 
    minDetectionConfidence: 0.65, // Dioptimalkan agar pencarian tangan awal lebih responsif
    minTrackingConfidence: 0.65
});

hands.onResults(onHandResults);

// Sinkronisasi frame kamera menggunakan requestAnimationFrame agar rendering 60 FPS mulus
const camera = new Camera(video, {
    onFrame: async () => {
        if (video.readyState >= 2) {
            await hands.send({ image: video });
        }
    },
    width: 1280,
    height: 720
});
camera.start();

// ===== ANTI-DELAY & ANTI-JITTER LERP MATHEMATICS =====
function adaptiveLerp(current, target) {
    const distance = Math.hypot(target.x - current.x, target.y - current.y);
    
    // Menggunakan rasio dinamis: Jika tangan bergerak cepat, respons ditingkatkan otomatis (No-Delay).
    // Jika diam, pergerakan diredam agar tidak bergetar (No-Jitter).
    let lerpFactor = 0.28; 
    if (distance < 4) {
        lerpFactor = 0.08; 
    } else if (distance > 25) {
        lerpFactor = 0.55; 
    }
    
    current.x += (target.x - current.x) * lerpFactor;
    current.y += (target.y - current.y) * lerpFactor;
}

// ===== CORE PROCESSING PIPELINE =====
function onHandResults(results) {
    // Sinkronisasi resolusi piksel internal 1:1 terhadap ukuran video webcam asli
    if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let leftHand = null;
    let rightHand = null;

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, index) => {
            const label = results.multiHandedness[index].label; 
            
            // Gambar skeleton bawaan MediaPipe (Ketebalan diperkecil agar beban render berkurang)
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "rgba(0, 255, 128, 0.3)", lineWidth: 3 });
            drawLandmarks(ctx, landmarks, { color: "#00ff80", fillColor: "#ffffff", radius: 4 });

            if (label === "Left") leftHand = landmarks;
            if (label === "Right") rightHand = landmarks;
        });
    }

    // MAPPING KOORDINAT SKELETON KE HUD TARGET
    if (leftHand && rightHand) {
        hudFrame.isValid = true;
        
        hudFrame.topLeft.targetX     = leftHand[8].x * canvas.width;
        hudFrame.topLeft.targetY     = leftHand[8].y * canvas.height;
        hudFrame.bottomLeft.targetX  = leftHand[4].x * canvas.width;
        hudFrame.bottomLeft.targetY  = leftHand[4].y * canvas.height;

        hudFrame.topRight.targetX    = rightHand[8].x * canvas.width;
        hudFrame.topRight.targetY    = rightHand[8].y * canvas.height;
        hudFrame.bottomRight.targetX = rightHand[4].x * canvas.width;
        hudFrame.bottomRight.targetY = rightHand[4].y * canvas.height;
        
        hudFrame.opacity = Math.min(1, hudFrame.opacity + 0.12); // Efek memudar muncul lebih cepat
    } else {
        hudFrame.isValid = false;
        hudFrame.opacity = Math.max(0, hudFrame.opacity - 0.1); 
    }

    // PROSES SMOOTHING & RENDER HUD UTAMA
    if (hudFrame.opacity > 0) {
        adaptiveLerp(hudFrame.topLeft, { x: hudFrame.topLeft.targetX, y: hudFrame.topLeft.targetY });
        adaptiveLerp(hudFrame.bottomLeft, { x: hudFrame.bottomLeft.targetX, y: hudFrame.bottomLeft.targetY });
        adaptiveLerp(hudFrame.topRight, { x: hudFrame.topRight.targetX, y: hudFrame.topRight.targetY });
        adaptiveLerp(hudFrame.bottomRight, { x: hudFrame.bottomRight.targetX, y: hudFrame.bottomRight.targetY });
        
        renderCyberHUDFrame();
    }

    // SELALU TAMPILKAN WATERMARK "BY: RIZ_PROJECT"
    renderWatermark();

    // PERFORMANCE COUNTER ENGINE
    frameCount++;
    const now = performance.now();
    globalTime = now * 0.002; 
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
        fpsCounter.innerText = `SYS_FPS: ${fps}`;
    }
}

// ===== ADVANCED CANVAS RENDERING API =====
function renderCyberHUDFrame() {
    ctx.save();
    ctx.globalAlpha = hudFrame.opacity;

    const pTL = hudFrame.topLeft;
    const pBL = hudFrame.bottomLeft;
    const pTR = hudFrame.topRight;
    const pBR = hudFrame.bottomRight;

    // --- FITUR A: LIGHTWEIGHT DYNAMIC PIXEL BLUR MASKING (SUPER RINGAN) ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.clip(); // Membatasi area gambar efek blur hanya di dalam polygon bentukan jari

    // OPTIMASI UTAMA: Ukuran diturunkan menjadi bagi 32 agar pemrosesan gambar sangat enteng
    const pixelSize = 32; 
    offscreenCanvas.width = Math.max(1, canvas.width / pixelSize);
    offscreenCanvas.height = Math.max(1, canvas.height / pixelSize);
    
    offscreenCtx.imageSmoothingEnabled = false;
    // Mengambil snapshot instan langsung dari element video
    offscreenCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreenCanvas, 0, 0, canvas.width, canvas.height);
    
    // Overlay Matrix Green Color Tint
    ctx.fillStyle = "rgba(0, 255, 128, 0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Efek Scanline Neon Minimalis
    const scanlineY = (performance.now() * 0.08) % canvas.height;
    ctx.strokeStyle = "rgba(0, 255, 128, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, scanlineY);
    ctx.lineTo(canvas.width, scanlineY);
    ctx.stroke();
    ctx.restore();

    // --- FITUR B: DYNAMIC CONNECTING LINES ---
    const glowIntensity = 4 + Math.sin(globalTime * 4) * 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = glowIntensity;
    ctx.shadowColor = "#00ff80";

    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.stroke();

    // --- FITUR C: HUD SIKU POINTER (BENTUK L DI UJUNG JARI) ---
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 6;
    ctx.shadowColor = "#00ff80";
    
    const avgDist = Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y) * 0.12;
    const len = Math.max(12, Math.min(28, avgDist)); 

    ctx.beginPath();
    ctx.moveTo(pTL.x + len, pTL.y); ctx.lineTo(pTL.x, pTL.y); ctx.lineTo(pTL.x, pTL.y + len);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pTR.x - len, pTR.y); ctx.lineTo(pTR.x, pTR.y); ctx.lineTo(pTR.x, pTR.y + len);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pBR.x - len, pBR.y); ctx.lineTo(pBR.x, pBR.y); ctx.lineTo(pBR.x, pBR.y - len);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pBL.x + len, pBL.y); ctx.lineTo(pBL.x, pBL.y); ctx.lineTo(pBL.x, pBL.y - len);
    ctx.stroke();

    // Teks Indikator di atas Box (Di-mirror balik secara horizontal agar tulisan tidak terbalik)
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px monospace";
    
    ctx.save();
    ctx.translate(pTL.x, pTL.y - 8);
    ctx.scale(-1, 1); 
    ctx.fillText("AI_STRETCH_MASK_MATRIX", -170, 0); 
    ctx.restore();

    ctx.restore();
}

// ===== FITUR D: DIGITAL CYBERPUNK WATERMARK SYSTEM =====
function renderWatermark() {
    ctx.save();
    // Koordinat penempatan statis di pojok kanan bawah area canvas
    const posX = canvas.width - 25;
    const posY = canvas.height - 25;

    ctx.font = "bold 16px 'Courier New', Courier, monospace";
    ctx.textAlign = "right";
    
    // Gaya Glow Neon Hijau Cyber
    ctx.shadowColor = "#00ff80";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";

    // Teknik Inversi Matriks Teks: Membalik arah gambar sumbu X lokal 
    // agar tulisan string di layar cermin (CSS Mirror) tetap terbaca normal dari kiri ke kanan.
    ctx.save();
    ctx.translate(posX, posY);
    ctx.scale(-1, 1);
    ctx.fillText("BY: RIZ_PROJECT", 0, 0);
    ctx.restore();

    ctx.restore();
}
