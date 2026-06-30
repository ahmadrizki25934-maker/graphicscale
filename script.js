const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const fpsCounter = document.getElementById("fps-counter");

// Cache Offscreen Canvas super kecil untuk performa pikselasi instan dan sangat ringan
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
    modelComplexity: 1, // Tetap gunakan 1 agar seimbang antara akurasi dan kecepatan tinggi
    minDetectionConfidence: 0.65, // Dioptimalkan sedikit agar deteksi awal lebih cepat
    minTrackingConfidence: 0.65
});

hands.onResults(onHandResults);

// Sinkronisasi frame kamera menggunakan requestAnimationFrame bawaan browser agar super mulus
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

// ===== ANTI-JITTER ULTRA SMOOTH MULTI-LERP METHOD =====
function adaptiveLerp(current, target) {
    const distance = Math.hypot(target.x - current.x, target.y - current.y);
    
    // Jika pergerakan sangat kecil (getaran tangan/jitter), redam dengan lerp lambat.
    // Jika tangan bergerak cepat, naikkan responsivitas secara instan agar tidak terlambat.
    let lerpFactor = 0.25; 
    if (distance < 5) {
        lerpFactor = 0.08; 
    } else if (distance > 30) {
        lerpFactor = 0.45; 
    }
    
    current.x += (target.x - current.x) * lerpFactor;
    current.y += (target.y - current.y) * lerpFactor;
}

// ===== CORE PROCESSING PIPELINE =====
function onHandResults(results) {
    // Sinkronisasi resolusi internal 1:1 terhadap video
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
            
            // Gambar skeleton bawaan MediaPipe
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "rgba(0, 255, 128, 0.35)", lineWidth: 3 });
            drawLandmarks(ctx, landmarks, { color: "#00ff80", fillColor: "#ffffff", radius: 4 });

            if (label === "Left") leftHand = landmarks;
            if (label === "Right") rightHand = landmarks;
        });
    }

    // MAPPING KOORDINAT TARGET
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
        
        hudFrame.opacity = Math.min(1, hudFrame.opacity + 0.1); // Animasi fade in lebih responsif
    } else {
        hudFrame.isValid = false;
        hudFrame.opacity = Math.max(0, hudFrame.opacity - 0.08); // Animasi fade out mulus
    }

    // EKSEKUSI PERHITUNGAN SMOOTHING & RENDER HUD
    if (hudFrame.opacity > 0) {
        adaptiveLerp(hudFrame.topLeft, { x: hudFrame.topLeft.targetX, y: hudFrame.topLeft.targetY });
        adaptiveLerp(hudFrame.bottomLeft, { x: hudFrame.bottomLeft.targetX, y: hudFrame.bottomLeft.targetY });
        adaptiveLerp(hudFrame.topRight, { x: hudFrame.topRight.targetX, y: hudFrame.topRight.targetY });
        adaptiveLerp(hudFrame.bottomRight, { x: hudFrame.bottomRight.targetX, y: hudFrame.bottomRight.targetY });
        
        renderCyberHUDFrame();
    }

    // SELALU GAMBAR WATERMARK DI ATAS CANVAS (Tetap tampil walau tangan sedang tidak terdeteksi)
    renderWatermark();

    // FPS COUNTER LABS
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
    ctx.clip(); 

    // OPTIMASI PERFORMA: Kita persempit ukuran offscreen canvas menjadi jauh lebih kecil (misal: dibagi 24)
    // dan mengambil snapshot dari elemen Video secara langsung dengan resolusi rendah
    const pixelSize = 24; 
    offscreenCanvas.width = Math.max(1, canvas.width / pixelSize);
    offscreenCanvas.height = Math.max(1, canvas.height / pixelSize);
    
    offscreenCtx.imageSmoothingEnabled = false;
    // Menggambar video langsung ke kanvas mini berukuran sangat enteng
    offscreenCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreenCanvas, 0, 0, canvas.width, canvas.height);
    
    // Overlay Matrix Color Tint
    ctx.fillStyle = "rgba(0, 255, 128, 0.06)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Scanline Matrix Minimalis
    const scanlineY = (performance.now() * 0.08) % canvas.height;
    ctx.strokeStyle = "rgba(0, 255, 128, 0.12)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, scanlineY);
    ctx.lineTo(canvas.width, scanlineY);
    ctx.stroke();
    ctx.restore();

    // --- FITUR B: DYNAMIC CONNECTING LINES ---
    const glowIntensity = 4 + Math.sin(globalTime * 4) * 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = glowIntensity;
    ctx.shadowColor = "#00ff80";

    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.stroke();

    // --- FITUR C: HUD CORNER STYLE FORM (BENTUK SIKU HURUF L) ---
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#00ff80";
    
    const avgDist = Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y) * 0.12;
    const len = Math.max(12, Math.min(30, avgDist)); 

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

    // Teks Status Target di atas Box (Di-mirror balik agar tulisan tidak terbalik)
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
    // Taruh posisi watermark di sudut kanan bawah canvas secara dinamis
    const posX = canvas.width - 25;
    const posY = canvas.height - 25;

    ctx.font = "bold 16px 'Courier New', Courier, monospace";
    ctx.textAlign = "right";
    
    // Berikan efek glow neon warna hijau khas cyberpunk pada teks watermark Anda
    ctx.shadowColor = "#00ff80";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";

    // Karena container di-mirror secara global di CSS, tulisan string asli di canvas akan ikut terbalik.
    // Kita balikkan secara matematis di titik sumbunya agar tulisan terbaca normal dari kiri ke kanan.
    ctx.save();
    ctx.translate(posX, posY);
    ctx.scale(-1, 1);
    ctx.fillText("BY: RIZ_PROJECT", 0, 0);
    ctx.restore();

    ctx.restore();
}
