/**
 * Video Playback Mode Constants
 *
 * openSight supports two video playback architectures. The mode is chosen
 * automatically based on whether the backend FFmpeg extraction succeeded:
 *
 *   fast_ffmpeg_mode  (FramePlayer component)
 *     - Backend FFmpeg extracts every frame as a JPEG file.
 *     - Frontend plays the JPEG sequence on a <canvas> via setInterval.
 *     - Sub-modes: "full-load" (small videos, all frames in memory)
 *                  and "on-demand" (large videos, sliding-window fetch).
 *     - Used by default when the backend is available.
 *
 *   raw_browser_mode  (VideoPlayer component)
 *     - Browser-native <video> element handles decoding and playback.
 *     - Frames are captured to <canvas> only for annotation overlay and
 *       detection (seek + drawImage).
 *     - Used as a fallback when FFmpeg extraction fails or the backend
 *       is unreachable.
 *
 * Selection logic lives in VideoEditor.tsx:
 *   if (activeVideo.preExtractedFrames || activeVideo.sessionId)
 *       → fast_ffmpeg_mode  (FramePlayer)
 *   else
 *       → raw_browser_mode  (VideoPlayer)
 */

export const FAST_FFMPEG_MODE = 'fast_ffmpeg_mode' as const;
export const RAW_BROWSER_MODE = 'raw_browser_mode' as const;

export type VideoPlaybackMode = typeof FAST_FFMPEG_MODE | typeof RAW_BROWSER_MODE;
