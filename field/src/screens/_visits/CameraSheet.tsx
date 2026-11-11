import { Modal } from 'react-native';
import { LiveCamera, type CapturedPhoto } from '@/device/camera';

/** The live camera full screen, over the visit screen. */
export function CameraSheet({
  open,
  facing,
  label,
  onCapture,
  onClose,
}: {
  open: boolean;
  facing: 'back' | 'front';
  label?: string;
  onCapture: (photo: CapturedPhoto) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      {open ? (
        <LiveCamera
          facing={facing}
          label={label}
          onCapture={(photo) => {
            onClose();
            onCapture(photo);
          }}
          onCancel={onClose}
        />
      ) : null}
    </Modal>
  );
}
