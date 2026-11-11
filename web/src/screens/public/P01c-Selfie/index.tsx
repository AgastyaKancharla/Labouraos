import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi } from '../shared/api';
import { useStepGuard } from '../shared/registration';
import { ActionError, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, StepsBar, Warn } from '../shared/ui';

/**
 * P01c-Selfie: a live camera picture only — there is no file picker, so a
 * gallery photo can't be sent (the API refuses anything not marked as a
 * live capture). It becomes his profile photo.
 */
type CameraState = 'starting' | 'ready' | 'denied' | 'unavailable';

export default function Selfie() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = useStepGuard('selfie');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);

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

  const ready = Boolean(status);
  useEffect(() => {
    if (!ready) return;
    void start();
    return stop;
  }, [ready, start, stop]);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

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
    setError(null);
    try {
      await registrationApi.selfie(token, requestId, blob);
      await queryClient.invalidateQueries({ queryKey: ['registration', token] });
      navigate(to('P01d-IDCheck', { token }));
    } catch (e) {
      if (isOtpExpired(e)) {
        backToStart();
        return;
      }
      setError(e);
      setPreview(null);
      void start();
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <StepsBar current={2} label={t('pub.selfie.stepLabel')} />
      <PageTitle>{t('pub.selfie.title')}</PageTitle>
      <div className="lb-camera">
        <video ref={videoRef} playsInline muted aria-label={t('pub.selfie.cameraLabel')} hidden={Boolean(preview)} />
        {preview && <img src={preview} alt={t('pub.selfie.previewAlt')} />}
        <div className="lb-camera__oval" aria-hidden="true" />
      </div>
      <Muted>{t('pub.selfie.tips')}</Muted>
      {camera === 'denied' && <Warn>{t('pub.selfie.denied')}</Warn>}
      {camera === 'unavailable' && <Warn>{t('pub.selfie.unavailable')}</Warn>}
      <ActionError error={error} />
      {camera === 'denied' || camera === 'unavailable' ? (
        <button type="button" className="btn bs full" onClick={() => void start()}>
          {t('common.retry')}
        </button>
      ) : (
        <button type="button" className="btn bp full" disabled={camera !== 'ready' || uploading} aria-busy={uploading || undefined} onClick={() => void capture()}>
          {uploading ? t('pub.selfie.saving') : t('pub.selfie.take')}
        </button>
      )}
      <span className="sub lb-pub-center">{t('pub.selfie.noGallery')}</span>
    </>
  );
}
