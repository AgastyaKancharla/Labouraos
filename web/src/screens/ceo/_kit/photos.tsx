import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../../components/Modal';
import { Skeleton } from '../../../components/Skeleton';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { useRecordsPortal } from './records';

/**
 * Real photos on the CEO, Manager and Team Lead profiles (rev 194): the job
 * seeker's live selfie, and per visit the shop's name-board photo and the
 * agent's selfie. Each comes from the portal's own endpoint as a short-lived
 * private link (checked against the viewer's scope on the server); a link is
 * refreshed before it runs out. Aadhaar QR and ID card photos are never shown
 * (they are deleted after the check). A picture that is gone says so.
 */
interface Photo {
  kept: boolean;
  url: string | null;
  expiresInSeconds: number;
}

/** Signed links last 5 minutes: ask again after 4. */
const LINK_FRESH_MS = 4 * 60 * 1000;
export const PHOTO_GONE = 'Photo no longer kept';

function Thumb({ photo, alt, size = 96 }: { photo: Photo | undefined; alt: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!photo) return <Skeleton width={size} height={size} />;
  if (!photo.kept || !photo.url || broken) {
    return (
      <div className="ceo-ph" style={{ width: size, minHeight: size, display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: 11 }} role="img" aria-label={`${alt}: ${PHOTO_GONE}`}>
        {PHOTO_GONE}
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in' }} aria-label={`Enlarge: ${alt}`}>
        <img src={photo.url} alt={alt} width={size} height={size} style={{ objectFit: 'cover', borderRadius: 8, display: 'block' }} onError={() => setBroken(true)} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={alt} width={640}>
        <img src={photo.url} alt={alt} style={{ width: '100%', height: 'auto', borderRadius: 8 }} onError={() => setBroken(true)} />
      </Modal>
    </>
  );
}

/** C-JobSeeker: the live selfie taken during registration. */
export function SeekerSelfie({ id, name, hasSelfie }: { id: string; name: string; hasSelfie?: boolean }) {
  const { api: base } = useRecordsPortal();
  const query = useQuery({
    queryKey: [base, 'job-seeker', id, 'selfie'],
    queryFn: () => api.get<Photo>(`${base}/job-seekers/${id}/selfie`),
    enabled: hasSelfie !== false,
    staleTime: LINK_FRESH_MS,
    refetchInterval: LINK_FRESH_MS,
  });
  if (hasSelfie === false) return <span className="ceo-sub">Not taken</span>;
  if (query.isError) return <span className="ceo-sub">{PHOTO_GONE}</span>;
  return <Thumb photo={query.data} alt={`Live selfie of ${name}`} size={88} />;
}

export interface VisitForPhotos {
  id?: string;
  at: string;
  by: string | null;
  hasSelfie: boolean;
  hasBoardPhoto?: boolean;
  geofenceFlag: boolean;
}

/** C-Business: one visit's name-board photo and the agent's selfie, side by side. */
export function VisitPhotos({ businessId, businessName, visit }: { businessId: string; businessName: string; visit: VisitForPhotos }) {
  const { api: base } = useRecordsPortal();
  const query = useQuery({
    queryKey: [base, 'business', businessId, 'visit', visit.id, 'photos'],
    queryFn: () => api.get<{ boardPhoto: Photo; selfie: Photo }>(`${base}/businesses/${businessId}/visits/${visit.id}/photos`),
    enabled: Boolean(visit.id),
    staleTime: LINK_FRESH_MS,
    refetchInterval: LINK_FRESH_MS,
  });
  const gone: Photo = { kept: false, url: null, expiresInSeconds: 0 };
  const data = query.isError || !visit.id ? { boardPhoto: gone, selfie: gone } : query.data;
  const when = formatDateIST(visit.at);
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 6 }} data-testid="visit-photos">
      <div style={{ display: 'flex', gap: 8 }}>
        <Thumb photo={data?.boardPhoto} alt={`Shop name board of ${businessName}, visit on ${when}`} size={84} />
        <Thumb photo={data?.selfie} alt={`Selfie of ${visit.by ?? 'the agent'} at ${businessName}, ${when}`} size={84} />
      </div>
      <figcaption className="ceo-sub" style={{ fontSize: 11.5 }}>
        {when} · {visit.by ?? '—'}
        {visit.geofenceFlag ? ' · outside pin' : ''}
      </figcaption>
    </figure>
  );
}
