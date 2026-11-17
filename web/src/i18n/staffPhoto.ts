/* The staff photo (guide, login codes, 14 Nov): taken on the invite page and,
   for anyone without one or asked for a new one by the CEO, at sign-in before
   going on (auth/StaffPhotoGate). */

export const staffPhotoEn = {
  'staffPhoto.title': 'Take your staff photo',
  'staffPhoto.retakeTitle': 'Take a new staff photo',
  'staffPhoto.intro': 'A live camera selfie, so whoever gives you a login code can see it is you. It shows on login code requests, staff lists and your profile.',
  'staffPhoto.retakeIntro': 'The CEO asked for a new photo of you. Take it now to carry on.',
  'staffPhoto.tips': 'Face in the oval, good light, no cap or sunglasses.',
  'staffPhoto.noCamera': 'No camera on this device? Sign in once from a phone or a computer with a camera and take it there.',
  'staffPhoto.take': 'Take photo',
  'staffPhoto.saving': 'Saving your photo…',
  'staffPhoto.signOut': 'Sign out',
  'staffPhoto.inviteStep': 'First, your photo',
  'staffPhoto.inviteDone': 'Photo saved. Now choose your password.',
} as const;

export type StaffPhotoKey = keyof typeof staffPhotoEn;

