# Video Compressor

MP4 video compressor - smaller file size, better VLC compatibility.

## Problem
Large MP4 files (e.g., 500MB) often lag when played in VLC, especially on slower systems or streaming.

## Solution
Compress videos using H.264 codec with settings optimized for smooth VLC playback:
- Smaller file size
- Better seek/preview performance
- Works great with VLC, MPV, and other players

## Requirements

### Android (Termux)
```bash
pkg install ffmpeg
```

### macOS
```bash
brew install ffmpeg
```

### Linux (Ubuntu/Debian)
```bash
sudo apt install ffmpeg
```

### Windows
Download from https://ffmpeg.org/download.html

## Installation

```bash
npm install -g video-compressor
```

Or use directly:

```bash
git clone https://github.com/YOUR_USER/video-compressor.git
cd video-compressor
npm install
```

## Usage

```bash
vcompress input.mp4 output.mp4
```

### With custom quality

```bash
# More compression (smaller file, slightly lower quality)
vcompress input.mp4 output.mp4 28

# Better quality (larger file)
vcompress input.mp4 output.mp4 18

# Default quality is 23 (balanced)
```

### Quality Guide (CRF values)
- **18-20**: Visually lossless, larger file
- **23**: Default, good balance
- **26-28**: More compression, still good quality
- **30+**: Visible quality loss, very small file

## How it Works

Uses FFmpeg with H.264 codec and settings optimized for VLC:

- **H.264 codec**: Best compatibility across all players
- **Faststart**: Enables playback before full download (streaming-friendly)
- **AAC audio**: Compressed but clear audio
- **CRF encoding**: Constant quality, variable bitrate

## Examples

### Before & After

| Video | Size | VLC Performance |
|-------|------|----------------|
| Original | 500 MB | Laggy, slow to start |
| Compressed (CRF 23) | ~150 MB | Smooth playback |
| Compressed (CRF 28) | ~80 MB | Very smooth |

## License

MIT