/**
 * Video Compressor Library
 * Import and use: import { compress, getVideoInfo } from 'video-compressor'
 */

import * as strategies from './strategies.js';

export { strategies };

/**
 * Main compression function
 */
export async function compress(inputPath, outputPath, options = {}) {
  const { strategy = 'scene', quality = 23 } = options;
  
  const strategyMap = {
    'scene': () => strategies.sceneBasedAdaptive(inputPath, outputPath, { simpleCRF: quality, complexCRF: quality - 5 }),
    'delta': () => strategies.deltaFrameCompression(inputPath, outputPath, { threshold: 10 }),
    'keyframe': () => strategies.smartKeyframeCompression(inputPath, outputPath),
    'color': () => strategies.colorQuantizationCompression(inputPath, outputPath),
    'motion': () => strategies.motionAwareCompression(inputPath, outputPath)
  };
  
  const fn = strategyMap[strategy];
  if (!fn) throw new Error(`Unknown strategy: ${strategy}`);
  return fn();
}

/**
 * Get video information
 */
export async function getVideoInfo(inputPath) {
  const { execSync } = await import('child_process');
  const output = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`, { encoding: 'utf-8' });
  const data = JSON.parse(output);
  const vs = data.streams.find(s => s.codec_type === 'video');
  const fmt = data.format;
  return {
    width: vs.width,
    height: vs.height,
    fps: eval(vs.r_frame_rate),
    duration: parseFloat(fmt.duration),
    bitrate: parseInt(fmt.bit_rate),
    size: parseInt(fmt.size),
    codec: vs.codec_name
  };
}