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

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** The clean placeholder when there is no photo, or it is no longer kept (rev 198). */
function Initials({ name, size, label }: { name: string; size: number; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      style={{ width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--royal-soft, #e6eefc)', color: 'var(--royal, #0b4fb3)', fontWeight: 700, fontSize: Math.round(size * 0.36) }}
    >
      {initialsOf(name)}
    </div>
  );
}

function Thumb({ photo, alt, size = 96, initials, round }: { photo: Photo | undefined; alt: string; size?: number; initials?: string; round?: boolean }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!photo) return <Skeleton width={size} height={size} />;
  if (!photo.kept || !photo.url || broken) {
    if (initials) return <Initials name={initials} size={size} label={`${alt}: ${PHOTO_GONE}`} />;
    return (
      <div className="ceo-ph" style={{ width: size, minHeight: size, display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: 11 }} role="img" aria-label={`${alt}: ${PHOTO_GONE}`}>
        {PHOTO_GONE}
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in' }} aria-label={`Enlarge: ${alt}`}>
        <img src={photo.url} alt={alt} width={size} height={size} style={{ objectFit: 'cover', borderRadius: round ? '50%' : 8, display: 'block' }} onError={() => setBroken(true)} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={alt} width={640}>
        <img src={photo.url} alt={alt} style={{ width: '100%', height: 'auto', borderRadius: 8 }} onError={() => setBroken(true)} />
      </Modal>
    </>
  );
}

const NO_PHOTO: Photo = { kept: false, url: null, expiresInSeconds: 0 };

/**
 * The top of a profile (rev 198, "Photo at the top of every profile"): the
 * photo, then the name and the ID under it. Job seeker: the live selfie;
 * referral partner: the partner's photo; business: the shop's name-board
 * photo from the latest visit that has one. Initials when there is none.
 */
export function ProfileHero({
  kind,
  id,
  name,
  code,
  hasPhoto,
  visits,
}: {
  kind: 'job_seeker' | 'referral' | 'business';
  id: string;
  name: string;
  code: string;
  hasPhoto?: boolean;
  visits?: readonly VisitForPhotos[];
}) {
  const { api: base } = useRecordsPortal();
  const visit = kind === 'business' ? visits?.find((v) => v.id && v.hasBoardPhoto) : undefined;
  const path =
    kind === 'job_seeker'
      ? `${base}/job-seekers/${id}/selfie`
      : kind === 'referral'
        ? `${base}/referrals/${id}/photo`
        : visit
          ? `${base}/businesses/${id}/visits/${visit.id}/photos`
          : null;
  const enabled = Boolean(path) && hasPhoto !== false;
  const query = useQuery({
    queryKey: [base, kind, id, 'profile-photo', path],
    queryFn: async () => {
      const res = await api.get<Photo | { boardPhoto: Photo }>(path!);
      return 'boardPhoto' in res ? res.boardPhoto : res;
    },
    enabled,
    staleTime: LINK_FRESH_MS,
    refetchInterval: LINK_FRESH_MS,
  });
  const photo = !enabled || query.isError ? NO_PHOTO : query.data;
  const alt = kind === 'job_seeker' ? `Live selfie of ${name}` : kind === 'referral' ? `Photo of ${name}` : `Shop name board of ${name}`;
  return (
    <div className="ceo-profile-hero" data-testid="profile-hero" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginBottom: 16 }}>
      <Thumb photo={photo} alt={alt} size={112} initials={name} round={kind !== 'business'} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--navy)' }}>{name}</div>
        <div className="code" style={{ fontSize: 13 }}>{code}</div>
      </div>
    </div>
  );
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
