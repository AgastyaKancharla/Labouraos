import { useState, type ReactNode } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import { useLiveCamera } from '../../../lib/camera/useLiveCamera';
import { CameraProblem } from './CameraProblem';
import { Muted } from './ui';
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
 *
 * With `facing="environment"` the same live camera photographs an ID card
 * (another ID, rev 154): the back camera, not mirrored, a card-shaped frame.
 */
export function LiveSelfie({
  active,
  onCapture,
  tips,
  takeLabel,
  savingLabel,
  error,
  facing = 'user',
  cameraLabel,
  previewAlt,
  noGalleryLabel,
}: {
  active: boolean;
  onCapture: (photo: Blob) => Promise<'done' | 'retry'>;
  tips?: ReactNode;
  takeLabel?: string;
  savingLabel?: string;
  /** An upload error, shown above the button. */
  error?: ReactNode;
  /** user: the front camera (a selfie); environment: the back camera (a photo of an ID card). */
  facing?: 'user' | 'environment';
  cameraLabel?: string;
  previewAlt?: string;
  noGalleryLabel?: string;
}) {
  const t = useT();
  // One getUserMedia per open (also the permission prompt), looser constraints when needed, a retry while
  // Android still releases the camera, and the stream always stopped (lib/camera, 17 Nov).
  const { videoRef, state: camera, start, stop } = useLiveCamera(active, facing);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    // A selfie: at most 960 wide. A card: its longest side at most 1280 (the server refuses bigger card photos).
    const scale = facing === 'user' ? Math.min(1, 960 / video.videoWidth) : Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (facing === 'user') {
      // A selfie is shown mirrored, as in a mirror; a card is kept as it is (its number readable).
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
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
      <div className={facing === 'user' ? 'lb-camera' : 'lb-camera lb-camera--card'}>
        <video ref={videoRef} playsInline muted aria-label={cameraLabel ?? t('pub.selfie.cameraLabel')} hidden={Boolean(preview)} />
        {preview && <img src={preview} alt={previewAlt ?? t('pub.selfie.previewAlt')} />}
        <div className={facing === 'user' ? 'lb-camera__oval' : 'lb-camera__card'} aria-hidden="true" />
      </div>
      {tips && <Muted>{tips}</Muted>}
      {camera !== 'starting' && camera !== 'ready' && <CameraProblem kind={camera} noCamera={t('pub.selfie.unavailable')} />}
      {error}
      {camera !== 'starting' && camera !== 'ready' ? (
        <button type="button" className="btn bs full" onClick={() => void start()}>
          {t('common.retry')}
        </button>
      ) : (
        <button type="button" className="btn bp full" disabled={camera !== 'ready' || uploading} aria-busy={uploading || undefined} onClick={() => void capture()}>
          {uploading ? (savingLabel ?? t('pub.selfie.saving')) : (takeLabel ?? t('pub.selfie.take'))}
        </button>
      )}
      <span className="sub lb-pub-center">{noGalleryLabel ?? t('pub.selfie.noGallery')}</span>
    </>
  );
}
