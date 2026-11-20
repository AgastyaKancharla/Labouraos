import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { CameraView } from 'expo-camera';
import type { CameraErrorKind, Facing } from './webStream';

export interface CameraSurfaceHandle {
  /** A JPEG of the live frame (file:// on the phone app, data: URL in the web app). */
  takePicture(): Promise<{ uri: string; width: number; height: number }>;
}

export interface CameraSurfaceProps {
  facing: Facing;
  onReady: () => void;
  onError: (kind: CameraErrorKind) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The live picture on the phone app: expo-camera (the permission is asked
 * by LiveCamera before this mounts). The web app has its own
 * CameraSurface.web.tsx.
 */
export const CameraSurface = forwardRef<CameraSurfaceHandle, CameraSurfaceProps>(function CameraSurface({ facing, onReady, onError, style }, ref) {
  const camera = useRef<CameraView>(null);
  useImperativeHandle(ref, () => ({
    async takePicture() {
      if (!camera.current) throw new Error('Camera not ready');
      const shot = await camera.current.takePictureAsync({ quality: 0.7, exif: false });
      return { uri: shot.uri, width: shot.width, height: shot.height };
    },
  }));
  return <CameraView ref={camera} style={style} facing={facing} mode="picture" onCameraReady={onReady} onMountError={() => onError('in_use')} />;
});
