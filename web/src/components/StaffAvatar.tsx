import { useEffect, useState } from 'react';

/**
 * A staff member's photo (guide, 14 Nov: shown on login code requests, staff
 * lists and profiles), from the short-lived signed link the API gives; their
 * initials when there is no photo or the link can't be loaded.
 *
 * Sizes: `sm` (26 px, list rows — the designs' `.avatar`), `md` (44 px),
 * `lg` (64 px, login code cards and profiles, so a senior can see who is asking).
 */
export function staffInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function StaffAvatar({
  name,
  photoUrl,
  size = 'sm',
  tone = 'av-royal',
  noPhotoLabel,
}: {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  tone?: string;
  /** Written under the initials when there is no photo (login code cards: "No photo"). */
  noPhotoLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const cls = `avatar lb-staffphoto lb-staffphoto--${size} ${tone}`;
  if (photoUrl && !failed) {
    // The name is always written next to the photo, so the image itself is not read out twice.
    return <img className={cls} src={photoUrl} alt="" data-testid="staff-photo" onError={() => setFailed(true)} />;
  }
  const initials = (
    <span className={cls} aria-hidden="true" data-testid="staff-initials">
      {staffInitials(name)}
    </span>
  );
  if (!noPhotoLabel) return initials;
  return (
    <span className="lb-staffphoto-none">
      {initials}
      <span className="lb-staffphoto-none__label">{noPhotoLabel}</span>
    </span>
  );
}
