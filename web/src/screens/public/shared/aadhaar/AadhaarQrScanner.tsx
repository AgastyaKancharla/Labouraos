import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../i18n/I18nProvider';
import { useLiveCamera } from '../../../../lib/camera/useLiveCamera';
import { CameraProblem } from '../CameraProblem';
import { Muted } from '../ui';
import { decodeQrImage } from './qrDecoder';

/**
 * "Aadhaar: scan the QR code" — the back camera, live, decoded in the browser.
 * No picture is taken, saved or uploaded: frames are read in memory and only
 * the QR's text is handed to `onText`. The middle of the frame is read at full
 * resolution, and "Zoom in" reads a smaller middle part (Secure QR codes are
 * very dense, so filling the frame matters).
 */
const SCAN_EVERY_MS = 300;
const ZOOMS = [1, 0.6] as const;

export function AadhaarQrScanner({ onText, onCancel, decode = decodeQrImage }: { onText: (text: string) => void; onCancel: () => void; decode?: (image: ImageData) => Promise<string | null> }) {
  const t = useT();
  // The back camera through lib/camera (17 Nov): retries while Android releases a camera, looser constraints
  // when needed, and the stream always stopped — also one that arrives after "Back".
  const { videoRef, state: camera, start, stop } = useLiveCamera(true, 'environment');
  const zoomRef = useRef<number>(ZOOMS[0]);
  const doneRef = useRef(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    doneRef.current = false;
    return () => {
      doneRef.current = true;
    };
  }, []);

  // Continuous focus where the phone allows it (helps with the small, dense code).
  useEffect(() => {
    if (camera !== 'ready') return;
    const stream = videoRef.current?.srcObject as MediaStream | null | undefined;
    const track = stream?.getVideoTracks?.()[0];
    void track?.applyConstraints?.({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
  }, [camera, videoRef]);

  useEffect(() => {
    if (camera !== 'ready') return;
    let busy = false;
    const canvas = document.createElement('canvas');
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (busy || doneRef.current || !video || !video.videoWidth) return;
      const side = Math.round(Math.min(video.videoWidth, video.videoHeight) * zoomRef.current);
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, side, side);
      const frame = ctx.getImageData(0, 0, side, side);
      busy = true;
      void decode(frame)
        .then((text) => {
          if (text && !doneRef.current) {
            doneRef.current = true;
            stop();
            onText(text);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, SCAN_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [camera, decode, onText, stop, videoRef]);

  const toggleZoom = () => {
    const next = !zoomed;
    zoomRef.current = next ? ZOOMS[1] : ZOOMS[0];
    setZoomed(next);
  };

  return (
    <div className="lb-aq" data-testid="aadhaar-qr-scanner">
      <div className="lb-camera lb-aq__camera">
        <video ref={videoRef} playsInline muted aria-label={t('pub.qr.cameraLabel')} className={zoomed ? 'lb-aq__video zoomed' : 'lb-aq__video'} />
        <div className={zoomed ? 'lb-aq__frame zoomed' : 'lb-aq__frame'} aria-hidden="true" />
      </div>
      <Muted>{camera === 'ready' ? t('pub.qr.scanning') : t('pub.qr.starting')}</Muted>
      <ul className="lb-aq__tips">
        <li>{t('pub.qr.tipLight')}</li>
        <li>{t('pub.qr.tipFill')}</li>
        <li>{t('pub.qr.tipSteady')}</li>
      </ul>
      {camera !== 'starting' && camera !== 'ready' && <CameraProblem kind={camera} noCamera={t('pub.qr.unavailable')} />}
      {camera !== 'starting' && camera !== 'ready' ? (
        <button type="button" className="btn bs full" onClick={() => void start()}>
          {t('common.retry')}
        </button>
      ) : (
        <button type="button" className="btn bs full" aria-pressed={zoomed} disabled={camera !== 'ready'} onClick={toggleZoom}>
          {zoomed ? t('pub.qr.zoomOut') : t('pub.qr.zoomIn')}
        </button>
      )}
      <button type="button" className="btn bs full" onClick={onCancel}>
        {t('pub.qr.back')}
      </button>
      <span className="sub lb-pub-center">{t('pub.qr.noUpload')}</span>
    </div>
  );
}
