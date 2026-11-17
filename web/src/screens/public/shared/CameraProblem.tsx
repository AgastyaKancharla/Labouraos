import { useT } from '../../../i18n/I18nProvider';
import type { CameraErrorKind } from '../../../lib/camera/openCamera';
import { Warn } from './ui';

/**
 * Why the camera did not start, in words the person can act on (17 Nov):
 * blocked → allow it; busy → close other apps and try again; no camera →
 * the page's own fallback (`noCamera`); not https → open the link again.
 */
export function CameraProblem({ kind, noCamera }: { kind: CameraErrorKind; noCamera: string }) {
  const t = useT();
  const text = kind === 'denied' ? t('pub.selfie.denied') : kind === 'in_use' ? t('pub.camera.inUse') : kind === 'insecure' ? t('pub.camera.insecure') : noCamera;
  return (
    <div data-testid="camera-problem" data-kind={kind}>
      <Warn>{text}</Warn>
    </div>
  );
}
