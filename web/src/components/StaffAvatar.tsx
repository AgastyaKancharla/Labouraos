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
}: {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  tone?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const cls = `avatar lb-staffphoto lb-staffphoto--${size} ${tone}`;
  if (photoUrl && !failed) {
    // The name is always written next to the photo, so the image itself is not read out twice.
    return <img className={cls} src={photoUrl} alt="" data-testid="staff-photo" onError={() => setFailed(true)} />;
  }
  return (
    <span className={cls} aria-hidden="true" data-testid="staff-initials">
      {staffInitials(name)}
    </span>
  );
}
