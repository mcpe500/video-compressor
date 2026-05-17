# 🎬 Video Compressor

MP4 video compressor dengan **5 algoritma custom** — bukan cuma wrapper FFmpeg.

## Problem

- Video 500MB ngelag di VLC
- Butuh compression yang benar-benar custom, bukan hanya re-encode

## Solution

5 strategi dengan algoritma sendiri:

1. **Scene-Based Adaptive** — histogram entropy analysis per scene
2. **Delta Frame** — pixel difference analysis antara frame consecutive
3. **Smart Keyframe** — Shannon entropy calculation untuk optimal GOP
4. **Color Quantization** — color histogram analysis untuk palette optimization
5. **Motion-Aware** — motion vector analysis menggunakan FFmpeg codecview

## Installation

```bash
git clone https://github.com/mcpe500/video-compressor.git
cd video-compressor
npm install
```

## Usage

### CLI

```bash
# Single file
node src/cli.js input.mp4 output.mp4

# Custom CRF (lower = better quality)
node src/cli.js input.mp4 output.mp4 28

# Choose strategy
node src/cli.js input.mp4 output.mp4 23 scene
```

### Node.js Library

```javascript
import { compress, getVideoInfo, strategies } from './src/library.js';

// Get video info first
const info = await getVideoInfo('input.mp4');
console.log(`${info.width}x${info.height}, ${info.fps}fps`);

// Compress with strategy
const result = await compress('input.mp4', 'output.mp4', {
  strategy: 'scene',  // scene, delta, keyframe, color, motion
  quality: 23         // CRF 0-51
});
```

## How It Works

### Strategy 1: Scene-Based Adaptive

1. Extract 30 frame samples (PPM format)
2. Parse PPM header → extract pixel data
3. Build grayscale histogram per frame
4. Calculate Shannon entropy: `H = -Σ p * log2(p)`
5. Complexity = entropy / 8
6. Assign CRF:
   - High complexity (detailed) → CRF 18-20 (preserve quality)
   - Low complexity (simple) → CRF 28 (aggressive compression)

### Strategy 2: Delta Frame Compression

1. Extract consecutive frame pairs
2. Parse both PPM files
3. Calculate pixel difference: `Δ = Σ|R1-R2| + |G1-G2| + |B1-B2|`
4. Normalize to motion level (0-1)
5. Assign encoding:
   - Low motion (<20%) → CRF 26, GOP 60
   - Medium (20-50%) → CRF 23, GOP 30
   - High (>50%) → CRF 20, GOP 15

### Strategy 3: Smart Keyframe Extraction

1. Sample 30 frames across video
2. Calculate Shannon entropy per frame
3. Measure entropy variance
4. Set optimal GOP based on scene variation:
   - High variation (>2.5) → GOP = 2 seconds
   - Medium (1.5-2.5) → GOP = 5 seconds
   - Stable (<1.5) → GOP = 10 seconds

### Strategy 4: Color Quantization

1. Analyze color distribution from frames
2. Build color histogram
3. Count unique colors
4. Assign CRF based on diversity:
   - Few colors (<1K) → CRF 28
   - Medium (1K-10K) → CRF 25
   - High (10K-100K) → CRF 22
   - Very high (>100K) → CRF 20

### Strategy 5: Motion-Aware Compression

1. Extract motion vectors using FFmpeg codecview
2. Classify frames: static, low-motion, high-motion
3. Assign encoding preset and CRF:
   - High motion → 'slow' preset, CRF 18 (better motion estimation)
   - Mostly static → 'veryfast' preset, CRF 28 (fast encoding)
   - Mixed → 'medium' preset, CRF 23

## Algorithms Summary

| Strategy | Analysis Method | Output Parameter |
|---|---|---|
| Scene-Based | Histogram entropy (Shannon) | CRF (18-28) |
| Delta Frame | Pixel difference per frame | CRF + GOP size |
| Smart Keyframe | Shannon entropy variance | GOP + scene threshold |
| Color Quantization | Color histogram (24-bit) | CRF (20-28) |
| Motion-Aware | FFmpeg motion vectors | CRF + preset |

## VLC Compatibility

All outputs:
- **H.264 codec** — best player support
- **AAC audio** — 128kbps
- **Faststart flag** — stream while downloading
- **YUV420P pixel format** — maximum compatibility

## Requirements

- Node.js >= 18
- FFmpeg (system-wide)

## License

MIT