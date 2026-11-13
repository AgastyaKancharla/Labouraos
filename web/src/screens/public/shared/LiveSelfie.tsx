import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import { Muted, Warn } from './ui';
import './public.css';

/**
 * The live camera selfie used by every page that asks for one: the job
 * seeker's registration link (P01c), the referral partner's link and the
 * staff photo (invite page, and at sign-in when a photo is missing).
 *
 * Camera only: there is no file picker, so a gallery photo can't be sent
 * (the APIs refuse anything not marked as a live capture). The front camera
 * opens when `active` is true; "Take selfie" freezes the frame, stops the
 * camera and hands the JPEG to `onCapture`. If that answers 'retry' (the
 * upload failed), the camera opens again.
 */
type CameraState = 'starting' | 'ready' | 'denied' | 'unavailable';

export function LiveSelfie({
  active,
  onCapture,
  tips,
  takeLabel,
  savingLabel,
  error,
}: {
  active: boolean;
  onCapture: (photo: Blob) => Promise<'done' | 'retry'>;
  tips?: ReactNode;
  takeLabel?: string;
  savingLabel?: string;
  /** An upload error, shown above the button. */
  error?: ReactNode;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setCamera('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamera('ready');
    } catch (e) {
      setCamera(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void start();
    return stop;
  }, [active, start, stop]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return;
    setPreview(canvas.toDataURL('image/jpeg', 0.6));
    stop();
    setUploading(true);
    try {
      const outcome = await onCapture(blob);
      if (outcome === 'retry') {
        setPreview(null);
        void start();
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="lb-camera">
        <video ref={videoRef} playsInline muted aria-label={t('pub.selfie.cameraLabel')} hidden={Boolean(preview)} />
        {preview && <img src={preview} alt={t('pub.selfie.previewAlt')} />}
        <div className="lb-camera__oval" aria-hidden="true" />
      </div>
      {tips && <Muted>{tips}</Muted>}
      {camera === 'denied' && <Warn>{t('pub.selfie.denied')}</Warn>}
      {camera === 'unavailable' && <Warn>{t('pub.selfie.unavailable')}</Warn>}
      {error}
      {camera === 'denied' || camera === 'unavailable' ? (
        <button type="button" className="btn bs full" onClick={() => void start()}>
          {t('common.retry')}
        </button>
      ) : (
        <button type="button" className="btn bp full" disabled={camera !== 'ready' || uploading} aria-busy={uploading || undefined} onClick={() => void capture()}>
          {uploading ? (savingLabel ?? t('pub.selfie.saving')) : (takeLabel ?? t('pub.selfie.take'))}
        </button>
      )}
      <span className="sub lb-pub-center">{t('pub.selfie.noGallery')}</span>
    </>
  );
}
