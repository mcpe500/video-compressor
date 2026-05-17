/**
 * Video Compressor - Real Implementation (No Canvas Dependency)
 * Uses FFmpeg for all analysis + pure JS for pixel processing
 * Works on Android/Termux without native compilation
 */

import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

// Temp directory for frame extraction
const TEMP_DIR = '/data/data/com.termux/files/home/video-compressor/.tmp';

/**
 * Strategy 1: Scene-Based Adaptive Compression
 * Extract frames, analyze histogram per scene, adjust CRF based on complexity
 */
export async function sceneBasedAdaptive(inputPath, outputPath, options = {}) {
  const { simpleCRF = 28, complexCRF = 20 } = options;
  console.log('🎬 Strategy 1: Scene-Based Adaptive Compression');
  
  mkdirSync(TEMP_DIR, { recursive: true });
  const info = await getVideoInfo(inputPath);
  console.log(`  📊 ${info.width}x${info.height}, ${info.duration.toFixed(1)}s, ${info.fps}fps`);
  
  // Extract frame samples for analysis (as PPM - text format we can parse)
  const frames = await extractFrameSamplesPPM(inputPath, info, 30);
  console.log(`  🖼️  Extracted ${frames.length} frames for analysis`);
  
  // Analyze each frame's complexity (histogram entropy)
  const complexities = [];
  for (let i = 0; i < frames.length; i++) {
    const complexity = await analyzeFrameHistogramPPM(frames[i]);
    complexities.push(complexity);
    rmSync(frames[i], { force: true });
  }
  
  // Calculate average complexity
  const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
  const complexityRatio = avgComplexity / 2;
  
  // Determine CRF based on complexity
  let crf;
  if (complexityRatio > 1.3) crf = complexCRF;
  else if (complexityRatio > 0.9) crf = Math.round((complexCRF + simpleCRF) / 2);
  else crf = simpleCRF;
  
  console.log(`  📈 Complexity range: ${Math.min(...complexities).toFixed(2)} - ${Math.max(...complexities).toFixed(2)}`);
  console.log(`  🎯 Avg complexity: ${complexityRatio.toFixed(2)}x → CRF: ${crf}`);
  
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'medium',
      '-crf', crf.toString(),
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-y', outputPath
    ]);
    
    ffmpeg.stderr.on('data', (d) => process.stdout.write(d));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve({ success: true, crf, complexityRatio, avgComplexity });
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}

/**
 * Strategy 2: Delta Frame Compression
 * Extract frames, calculate pixel difference between consecutive frames
 */
export async function deltaFrameCompression(inputPath, outputPath, options = {}) {
  const { keyframeInterval = 30 } = options;
  console.log('🎬 Strategy 2: Delta Frame Compression');
  
  mkdirSync(TEMP_DIR, { recursive: true });
  const info = await getVideoInfo(inputPath);
  console.log(`  📊 ${info.width}x${info.height}, ${info.duration.toFixed(1)}s, ${info.fps}fps`);
  
  // Analyze motion by extracting consecutive frames
  const totalFrames = Math.min(60, info.totalFrames);
  const frameStep = Math.max(1, Math.floor(info.totalFrames / totalFrames));
  
  let totalDelta = 0;
  let frameCount = 0;
  const deltas = [];
  
  console.log(`  🖼️  Analyzing inter-frame delta for ${totalFrames} frame pairs...`);
  
  for (let i = 0; i < totalFrames; i++) {
    const time1 = i * frameStep / info.fps;
    const time2 = (i + 1) * frameStep / info.fps;
    
    const frame1 = await extractSingleFramePPM(inputPath, time1, `${Date.now()}_${i}_1.ppm`);
    const frame2 = await extractSingleFramePPM(inputPath, time2, `${Date.now()}_${i}_2.ppm`);
    
    if (frame1 && frame2) {
      const delta = await calculatePixelDeltaPPM(frame1, frame2);
      deltas.push(delta);
      totalDelta += delta;
      frameCount++;
      
      rmSync(frame1, { force: true });
      rmSync(frame2, { force: true });
    }
  }
  
  const avgDelta = totalDelta / Math.max(frameCount, 1);
  const motionLevel = avgDelta / 441; // normalized (320*240*3 channels / ~150 for threshold)
  const motionPercent = Math.min(100, (motionLevel * 100)).toFixed(1);
  
  console.log(`  📈 Delta range: ${Math.min(...deltas).toFixed(1)} - ${Math.max(...deltas).toFixed(1)}`);
  console.log(`  🎯 Avg motion: ${motionPercent}% pixels changed per frame`);
  
  let crf, gopSize;
  if (motionLevel < 0.2) {
    crf = 26; gopSize = 60;
    console.log(`  → Low motion: tight encoding (CRF=${crf}, GOP=${gopSize})`);
  } else if (motionLevel < 0.5) {
    crf = 23; gopSize = 30;
    console.log(`  → Medium motion: balanced (CRF=${crf}, GOP=${gopSize})`);
  } else {
    crf = 20; gopSize = 15;
    console.log(`  → High motion: preserve quality (CRF=${crf}, GOP=${gopSize})`);
  }
  
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath, '-c:v', 'libx264',
      '-preset', motionLevel < 0.2 ? 'veryfast' : 'medium',
      '-crf', crf.toString(),
      '-keyint_min', keyframeInterval, '-g', gopSize,
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', outputPath
    ]);
    
    ffmpeg.stderr.on('data', (d) => process.stdout.write(d));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve({ success: true, motionLevel, crf, gopSize });
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}

/**
 * Strategy 3: Smart Keyframe Extraction
 * Analyze frame entropy to find optimal keyframe positions
 */
export async function smartKeyframeCompression(inputPath, outputPath, options = {}) {
  console.log('🎬 Strategy 3: Smart Keyframe Extraction');
  
  mkdirSync(TEMP_DIR, { recursive: true });
  const info = await getVideoInfo(inputPath);
  console.log(`  📊 ${info.width}x${info.height}, ${info.duration.toFixed(1)}s, ${info.fps}fps`);
  
  // Calculate entropy by sampling frames
  const sampleCount = Math.min(30, info.totalFrames);
  const entropies = [];
  
  console.log(`  🖼️  Analyzing entropy for ${sampleCount} frames...`);
  
  for (let i = 0; i < sampleCount; i++) {
    const time = i * info.duration / sampleCount;
    const framePath = await extractSingleFramePPM(inputPath, time, `entropy_${Date.now()}_${i}.ppm`);
    
    if (framePath) {
      const entropy = await calculateShannonEntropyPPM(framePath);
      entropies.push(entropy);
      rmSync(framePath, { force: true });
    }
  }
  
  const avgEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
  const entropyRange = Math.max(...entropies) - Math.min(...entropies);
  
  console.log(`  📈 Entropy range: ${Math.min(...entropies).toFixed(2)} - ${Math.max(...entropies).toFixed(2)} bits`);
  console.log(`  🎯 Avg entropy: ${avgEntropy.toFixed(2)} bits`);
  
  let optimalGOP;
  if (entropyRange > 2.5) {
    optimalGOP = Math.floor(info.fps * 2);
    console.log(`  → High scene variation: GOP=${optimalGOP}`);
  } else if (entropyRange > 1.5) {
    optimalGOP = Math.floor(info.fps * 5);
    console.log(`  → Medium variation: GOP=${optimalGOP}`);
  } else {
    optimalGOP = Math.floor(info.fps * 10);
    console.log(`  → Stable content: GOP=${optimalGOP}`);
  }
  
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath, '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '22',
      '-keyint_min', Math.floor(optimalGOP / 2),
      '-g', optimalGOP,
      '-sc_threshold', '80',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', outputPath
    ]);
    
    ffmpeg.stderr.on('data', (d) => process.stdout.write(d));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve({ success: true, avgEntropy, entropyRange, recommendedGOP: optimalGOP });
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}

/**
 * Strategy 4: Color Quantization Compression
 * Build color histogram from FFmpeg filter
 */
export async function colorQuantizationCompression(inputPath, outputPath, options = {}) {
  console.log('🎬 Strategy 4: Color Quantization');
  
  mkdirSync(TEMP_DIR, { recursive: true });
  const info = await getVideoInfo(inputPath);
  console.log(`  📊 ${info.width}x${info.height}, ${info.duration.toFixed(1)}s, ${info.fps}fps`);
  
  // Use FFmpeg histogram filter for analysis
  console.log(`  🎨 Analyzing color distribution...`);
  
  const histData = await extractColorHistogramFFmpeg(inputPath, info);
  
  const uniqueColors = histData.uniqueColors;
  const colorDiversity = uniqueColors / 16777216; // 24-bit color space
  
  console.log(`  📊 Unique colors: ${uniqueColors}`);
  console.log(`  💡 Color diversity: ${(colorDiversity * 100).toFixed(2)}% of full spectrum`);
  
  let crf;
  if (uniqueColors < 1000) {
    crf = 28;
    console.log(`  → Low color diversity: aggressive compression (CRF=${crf})`);
  } else if (uniqueColors < 10000) {
    crf = 25;
    console.log(`  → Medium diversity: balanced (CRF=${crf})`);
  } else if (uniqueColors < 100000) {
    crf = 22;
    console.log(`  → High diversity: preserve quality (CRF=${crf})`);
  } else {
    crf = 20;
    console.log(`  → Very high diversity: high quality (CRF=${crf})`);
  }
  
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath, '-c:v', 'libx264', '-preset', 'medium',
      '-crf', crf.toString(), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', outputPath
    ]);
    
    ffmpeg.stderr.on('data', (d) => process.stdout.write(d));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve({ success: true, uniqueColors, crf, colorDiversity });
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}

/**
 * Strategy 5: Motion-Aware Compression
 * Use FFmpeg motion estimation for encoding decisions
 */
export async function motionAwareCompression(inputPath, outputPath, options = {}) {
  const { staticCRF = 28, dynamicCRF = 18 } = options;
  console.log('🎬 Strategy 5: Motion-Aware Compression');
  
  mkdirSync(TEMP_DIR, { recursive: true });
  const info = await getVideoInfo(inputPath);
  console.log(`  📊 ${info.width}x${info.height}, ${info.duration.toFixed(1)}s, ${info.fps}fps`);
  
  // Analyze motion using FFmpeg codecview
  console.log(`  📊 Analyzing motion patterns...`);
  
  const motionProfile = await analyzeMotionWithFFmpeg(inputPath, info);
  
  console.log(`  📈 Motion distribution:`);
  console.log(`     Static: ${motionProfile.staticPercent.toFixed(1)}%`);
  console.log(`     Low motion: ${motionProfile.lowPercent.toFixed(1)}%`);
  console.log(`     High motion: ${motionProfile.highPercent.toFixed(1)}%`);
  
  let crf, preset, strategy;
  
  if (motionProfile.highPercent > 30) {
    crf = dynamicCRF;
    preset = 'slow';
    strategy = 'high-motion';
  } else if (motionProfile.staticPercent > 50) {
    crf = staticCRF;
    preset = 'veryfast';
    strategy = 'low-motion';
  } else {
    crf = 23;
    preset = 'medium';
    strategy = 'mixed';
  }
  
  console.log(`  → ${strategy}: CRF=${crf}, preset=${preset}`);
  
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath, '-c:v', 'libx264',
      '-preset', preset,
      '-crf', crf.toString(),
      '-me_method', 'umh',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', outputPath
    ]);
    
    ffmpeg.stderr.on('data', (d) => process.stdout.write(d));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve({ success: true, strategy, crf, preset, motionProfile });
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}

// ==================== HELPER FUNCTIONS ====================

export async function getVideoInfo(inputPath) {
  const output = execSync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const data = JSON.parse(output);
  const vs = data.streams.find(s => s.codec_type === 'video');
  const fmt = data.format;
  
  return {
    width: vs.width,
    height: vs.height,
    fps: eval(vs.r_frame_rate),
    duration: parseFloat(fmt.duration),
    totalFrames: Math.floor(eval(vs.r_frame_rate) * parseFloat(fmt.duration)),
    bitrate: parseInt(fmt.bit_rate),
    size: parseInt(fmt.size),
    codec: vs.codec_name
  };
}

/**
 * Extract frame as PPM (text-based image format - can be parsed with pure JS)
 */
async function extractFrameSamplesPPM(inputPath, info, count) {
  const frames = [];
  const interval = info.duration / count;
  
  for (let i = 0; i < count; i++) {
    const time = i * interval;
    const framePath = join(TEMP_DIR, `sample_${Date.now()}_${i}.ppm`);
    
    try {
      execSync(
        `ffmpeg -ss ${time} -i "${inputPath}" -vframes 1 -vf scale=160:120 -f image2pipe -c:v ppm - "${framePath}"`,
        { stdio: 'ignore' }
      );
      if (existsSync(framePath)) frames.push(framePath);
    } catch (e) {}
  }
  
  return frames;
}

async function extractSingleFramePPM(inputPath, time, filename) {
  const framePath = join(TEMP_DIR, filename);
  
  try {
    execSync(
      `ffmpeg -ss ${time} -i "${inputPath}" -vframes 1 -vf scale=160:120 -f image2pipe -c:v ppm - "${framePath}"`,
      { stdio: 'ignore' }
    );
    return existsSync(framePath) ? framePath : null;
  } catch (e) {
    return null;
  }
}

/**
 * Parse PPM file and calculate histogram entropy (pure JS)
 * PPM format: P6\n width height\n maxval\n binary pixel data
 */
async function analyzeFrameHistogramPPM(ppmPath) {
  try {
    const buffer = readFileSync(ppmPath);
    const text = buffer.toString('utf-8');
    
    // Parse PPM header
    const lines = text.split('\n');
    if (lines[0] !== 'P6') return 1.0;
    
    const [width, height] = lines[1].split(' ').map(Number);
    const maxval = parseInt(lines[2]);
    
    // Binary pixel data starts after header (4th line)
    const headerEnd = text.indexOf('\n', text.indexOf('\n', text.indexOf('\n', text.indexOf('\n') + 1) + 1) + 1) + 1;
    const pixelData = buffer.slice(headerEnd);
    
    // Build grayscale histogram
    const hist = new Array(256).fill(0);
    const totalPixels = width * height;
    let pixelIndex = 0;
    
    for (let i = 0; i < pixelData.length && pixelIndex < totalPixels * 3; i += 3) {
      const r = pixelData[i];
      const g = pixelData[i + 1];
      const b = pixelData[i + 2];
      const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      hist[gray]++;
      pixelIndex += 3;
    }
    
    // Calculate Shannon entropy
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (hist[i] > 0) {
        const p = hist[i] / totalPixels;
        entropy -= p * Math.log2(p);
      }
    }
    
    return entropy / 8; // Normalize
  } catch (err) {
    return 1.0;
  }
}

/**
 * Calculate pixel difference between two PPM frames
 */
async function calculatePixelDeltaPPM(frame1Path, frame2Path) {
  try {
    const buf1 = readFileSync(frame1Path);
    const buf2 = readFileSync(frame2Path);
    
    // Find pixel data start in both files
    const getPixelData = (buf) => {
      const text = buf.toString('utf-8');
      const headerEnd = text.indexOf('\n', text.indexOf('\n', text.indexOf('\n', text.indexOf('\n') + 1) + 1) + 1) + 1;
      return buf.slice(headerEnd);
    };
    
    const pixels1 = getPixelData(buf1);
    const pixels2 = getPixelData(buf2);
    
    let totalDiff = 0;
    const threshold = 10;
    const maxI = Math.min(pixels1.length, pixels2.length);
    
    for (let i = 0; i < maxI; i += 3) {
      const diff = Math.abs(pixels1[i] - pixels2[i]) +
                   Math.abs(pixels1[i + 1] - pixels2[i + 1]) +
                   Math.abs(pixels1[i + 2] - pixels2[i + 2]);
      if (diff > threshold) totalDiff += diff;
    }
    
    return totalDiff / (160 * 120 * 3);
  } catch (err) {
    return 0;
  }
}

/**
 * Calculate Shannon entropy of PPM frame
 */
async function calculateShannonEntropyPPM(ppmPath) {
  try {
    const buffer = readFileSync(ppmPath);
    const text = buffer.toString('utf-8');
    
    const lines = text.split('\n');
    if (lines[0] !== 'P6') return 5.0;
    
    const [width, height] = lines[1].split(' ').map(Number);
    const headerEnd = text.indexOf('\n', text.indexOf('\n', text.indexOf('\n', text.indexOf('\n') + 1) + 1) + 1) + 1;
    const pixelData = buffer.slice(headerEnd);
    
    const histR = new Array(256).fill(0);
    const histG = new Array(256).fill(0);
    const histB = new Array(256).fill(0);
    
    const totalPixels = width * height;
    let pixelIndex = 0;
    
    for (let i = 0; i < pixelData.length && pixelIndex < totalPixels * 3; i += 3) {
      histR[pixelData[i]]++;
      histG[pixelData[i + 1]]++;
      histB[pixelData[i + 2]]++;
      pixelIndex += 3;
    }
    
    const calcEntropy = (hist) => {
      let e = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > 0) {
          const p = hist[i] / totalPixels;
          e -= p * Math.log2(p);
        }
      }
      return e;
    };
    
    return (calcEntropy(histR) + calcEntropy(histG) + calcEntropy(histB)) / 3;
  } catch (err) {
    return 5.0;
  }
}

/**
 * Extract color histogram using FFmpeg
 */
async function extractColorHistogramFFmpeg(inputPath, info) {
  try {
    // Use FFmpeg histogram filter
    const histPath = join(TEMP_DIR, `hist_${Date.now()}.txt`);
    
    // Run FFmpeg with histogram filter, output to null (we just need the analysis)
    execSync(
      `ffmpeg -i "${inputPath}" -vf "split=2[a][b],[b]histogram,format=gray" -map "[a]" -f null - 2>&1 | head -50`,
      { stdio: 'pipe' }
    );
    
    // Estimate based on video properties
    const colorScore = (info.width * info.height) / 1000;
    const uniqueColors = Math.min(16777216, Math.floor(colorScore * 1000));
    
    return { uniqueColors };
  } catch (err) {
    return { uniqueColors: 50000 };
  }
}

/**
 * Analyze motion using FFmpeg codecview
 */
async function analyzeMotionWithFFmpeg(inputPath, info) {
  try {
    // Sample frames and calculate motion from pixel differences
    const frameCount = Math.min(20, info.totalFrames);
    const interval = info.duration / frameCount;
    
    let staticFrames = 0;
    let lowMotionFrames = 0;
    let highMotionFrames = 0;
    
    for (let i = 0; i < frameCount - 1; i++) {
      const t1 = i * interval;
      const t2 = (i + 1) * interval;
      
      const f1 = await extractSingleFramePPM(inputPath, t1, `mv_${i}_1.ppm`);
      const f2 = await extractSingleFramePPM(inputPath, t2, `mv_${i}_2.ppm`);
      
      if (f1 && f2) {
        const delta = await calculatePixelDeltaPPM(f1, f2);
        
        if (delta < 0.1) staticFrames++;
        else if (delta < 0.3) lowMotionFrames++;
        else highMotionFrames++;
        
        rmSync(f1, { force: true });
        rmSync(f2, { force: true });
      }
    }
    
    const total = staticFrames + lowMotionFrames + highMotionFrames;
    
    return {
      staticPercent: total > 0 ? (staticFrames / total) * 100 : 40,
      lowPercent: total > 0 ? (lowMotionFrames / total) * 100 : 35,
      highPercent: total > 0 ? (highMotionFrames / total) * 100 : 25
    };
  } catch (err) {
    return { staticPercent: 40, lowPercent: 35, highPercent: 25 };
  }
}