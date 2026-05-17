#!/usr/bin/env node
/**
 * Video Compressor CLI
 * Usage: node src/cli.js input.mp4 output.mp4 [quality]
 * 
 * quality: 0 (highest compression) to 51 (least compression), default 23
 * Lower = better quality but larger file
 * 
 * Examples:
 *   node src/cli.js input.mp4 output.mp4        # default quality (23)
 *   node src/cli.js input.mp4 output.mp4 28    # more compression
 *   node src/cli.js input.mp4 output.mp4 18    # better quality
 */

import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { basename, extname } from 'path';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
🎬 Video Compressor CLI

Usage: vcompress <input.mp4> <output.mp4> [quality]

Arguments:
  input.mp4      Path to input video file
  output.mp4     Path to output compressed video
  quality        CRF value 0-51 (default: 23)
                 Lower = better quality, Higher = more compression

Examples:
  vcompress video.mp4 compressed.mp4
  vcompress video.mp4 compressed.mp4 28
  vcompress video.mp4 compressed.mp4 18

Tips for VLC compatibility:
  - Uses H.264 codec (best compatibility)
  - Adds faststart flag for smooth streaming
  - AAC audio codec
`);
  process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1];
const quality = parseInt(args[2]) || 23;

// Validate input file
if (!existsSync(inputPath)) {
  console.error(`❌ Error: Input file not found: ${inputPath}`);
  process.exit(1);
}

const inputSize = statSync(inputPath).size / (1024 * 1024); // MB

console.log(`
╔══════════════════════════════════════════════════════╗
║           🎬 Video Compressor                        ║
╠══════════════════════════════════════════════════════╣
║  Input:   ${inputPath.substring(0, 40).padEnd(40)}║
║  Output:  ${outputPath.substring(0, 40).padEnd(40)}║
║  Quality: CRF ${quality} (${quality < 23 ? 'lower = better quality' : quality > 23 ? 'higher = more compression' : 'balanced'})
║  Size:    ${inputSize.toFixed(2)} MB
╚══════════════════════════════════════════════════════╝
`);

console.log('⏳ Compressing... (this may take a while)\n');

// FFmpeg command for maximum compatibility with VLC
// - codec: H.264 (best VLC support)
// - codec audio: AAC
// - faststart: allows playback before full download
// - preset medium: balance between speed and compression
const ffmpegArgs = [
  '-i', inputPath,
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', quality.toString(),
  '-c:a', 'aac',
  '-b:a', '128k',
  '-movflags', '+faststart',
  '-y',
  outputPath
];

const ffmpeg = spawn('ffmpeg', ffmpegArgs);

ffmpeg.stderr.on('data', (data) => {
  // FFmpeg outputs progress to stderr
  const output = data.toString();
  
  // Extract time if available
  const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    const hours = timeMatch[1];
    const mins = timeMatch[2];
    const secs = timeMatch[3];
    process.stdout.write(`\r  Processing... ${hours}:${mins}:${secs}`);
  }
  
  // Show errors
  if (output.includes('Error') || output.includes('Invalid')) {
    console.log('\n⚠️  ' + output.trim());
  }
});

ffmpeg.on('close', (code) => {
  if (code === 0) {
    const outputSize = statSync(outputPath).size / (1024 * 1024); // MB
    const ratio = ((inputSize - outputSize) / inputSize * 100).toFixed(1);
    
    console.log(`
╔══════════════════════════════════════════════════════╗
║  ✅ Compression Complete!                             ║
╠══════════════════════════════════════════════════════╣
║  Input Size:   ${inputSize.toFixed(2)} MB
║  Output Size:  ${outputSize.toFixed(2)} MB
║  Reduced:      ${ratio}% smaller
╚══════════════════════════════════════════════════════╝
`);
    
    if (outputSize < inputSize) {
      console.log('🎉 File successfully compressed and ready for VLC!');
    } else {
      console.log('⚠️  Output larger than input. Try higher CRF value (e.g., 28)');
    }
  } else {
    console.log(`\n❌ Compression failed with code: ${code}`);
    process.exit(1);
  }
});

ffmpeg.on('error', (err) => {
  if (err.message.includes('ENOENT')) {
    console.log('❌ Error: FFmpeg not found. Install ffmpeg first:');
    console.log('   pkg install ffmpeg');
  } else {
    console.log('❌ Error:', err.message);
  }
  process.exit(1);
});