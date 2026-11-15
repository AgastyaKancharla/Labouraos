import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../../../i18n/I18nProvider';
import { Muted, Warn } from '../ui';
import { decodeQrImage } from './qrDecoder';

/**
 * "Aadhaar: scan the QR code" — the back camera, live, decoded in the browser.
 * No picture is taken, saved or uploaded: frames are read in memory and only
 * the QR's text is handed to `onText`. The middle of the frame is read at full
 * resolution, and "Zoom in" reads a smaller middle part (Secure QR codes are
 * very dense, so filling the frame matters).
 */
type CameraState = 'starting' | 'ready' | 'denied' | 'unavailable';

const SCAN_EVERY_MS = 300;
const ZOOMS = [1, 0.6] as const;

export function AadhaarQrScanner({ onText, onCancel, decode = decodeQrImage }: { onText: (text: string) => void; onCancel: () => void; decode?: (image: ImageData) => Promise<string | null> }) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zoomRef = useRef<number>(ZOOMS[0]);
  const doneRef = useRef(false);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [zoomed, setZoomed] = useState(false);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      // Continuous focus where the phone allows it (helps with the small, dense code).
      await track?.applyConstraints?.({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
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
    doneRef.current = false;
    void start();
    return () => {
      doneRef.current = true;
      stop();
    };
  }, [start, stop]);

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
  }, [camera, decode, onText, stop]);

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
      {camera === 'denied' && <Warn>{t('pub.selfie.denied')}</Warn>}
      {camera === 'unavailable' && <Warn>{t('pub.qr.unavailable')}</Warn>}
      {camera === 'denied' || camera === 'unavailable' ? (
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
