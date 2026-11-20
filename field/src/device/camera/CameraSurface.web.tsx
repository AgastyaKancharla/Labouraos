import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CameraSurfaceHandle, CameraSurfaceProps } from './CameraSurface';
import { CameraStartError, openCameraStream, stopStream } from './webStream';

export type { CameraSurfaceHandle, CameraSurfaceProps } from './CameraSurface';

/** JPEG straight from the frame; burnStamp then scales it and adds the stamp. */
const FRAME_JPEG_QUALITY = 0.92;

/**
 * The live picture in the installed web app (17 Nov, item 4): our own
 * <video> on getUserMedia instead of expo-camera's web camera, so it works on
 * Android Chrome — one open per camera (no permission probe stream), a
 * constraints fallback chain, a retry while Android releases the camera,
 * the stream always stopped (on close, on switching camera, and if it arrives
 * after the screen closed), and the failure reported by kind so the screen
 * can say "allow the camera" apart from "camera in use". Camera only: there
 * is no file input and no gallery.
 */
export const CameraSurface = forwardRef<CameraSurfaceHandle, CameraSurfaceProps>(function CameraSurface({ facing, onReady, onError, style }, ref) {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const handlers = useRef({ onReady, onError });
  handlers.current = { onReady, onError };

  useEffect(() => {
    let closed = false;
    const element = video.current;
    const start = async () => {
      let opened: MediaStream;
      try {
        opened = await openCameraStream(facing, { cancelled: () => closed });
      } catch (error) {
        if (!closed) handlers.current.onError(error instanceof CameraStartError ? error.kind : 'in_use');
        return;
      }
      if (closed) {
        stopStream(opened);
        return;
      }
      stream.current = opened;
      // If Android takes the camera away (a call, another app), say so instead of a frozen picture.
      opened.getVideoTracks().forEach((track) => track.addEventListener('ended', () => !closed && handlers.current.onError('in_use')));
      if (!element || typeof element.play !== 'function') return;
      element.srcObject = opened;
      element.muted = true;
      const ready = () => {
        if (!closed && element.videoWidth > 0) handlers.current.onReady();
      };
      element.addEventListener('loadeddata', ready);
      element.addEventListener('playing', ready);
      try {
        await element.play();
      } catch {
        // autoplay of a muted inline video is allowed; "ready" still comes from loadeddata.
      }
      ready();
    };
    void start();
    return () => {
      closed = true;
      stopStream(stream.current);
      stream.current = null;
      if (element) element.srcObject = null;
    };
  }, [facing]);

  useImperativeHandle(ref, () => ({
    async takePicture() {
      const element = video.current;
      if (!element || element.videoWidth === 0) throw new Error('Camera not ready');
      const canvas = document.createElement('canvas');
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas');
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      return { uri: canvas.toDataURL('image/jpeg', FRAME_JPEG_QUALITY), width: canvas.width, height: canvas.height };
    },
  }));

  return (
    <View style={[styles.box, style]} testID="camera-surface">
      {createElement('video', {
        ref: video,
        autoPlay: true,
        muted: true,
        playsInline: true,
        style: { width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'front' ? 'scaleX(-1)' : undefined, backgroundColor: '#000' },
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#000' },
});
