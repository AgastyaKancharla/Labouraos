/* The staff photo (guide, login codes, 14 Nov): taken on the invite page and,
   for anyone without one or asked for a new one by the CEO, at sign-in before
   going on (auth/StaffPhotoGate). Kannada and Hindi need a native speaker's review. */

export const staffPhotoEn = {
  'staffPhoto.inviteLater': 'No camera on this device? Take it when you first sign in',
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

export const staffPhotoKn: Record<StaffPhotoKey, string> = {
  'staffPhoto.inviteLater': 'ಈ ಸಾಧನದಲ್ಲಿ ಕ್ಯಾಮೆರಾ ಇಲ್ಲವೇ? ಮೊದಲ ಬಾರಿ ಸೈನ್ ಇನ್ ಮಾಡುವಾಗ ತೆಗೆಯಿರಿ',
  'staffPhoto.title': 'ನಿಮ್ಮ ಸಿಬ್ಬಂದಿ ಫೋಟೋ ತೆಗೆಯಿರಿ',
  'staffPhoto.retakeTitle': 'ಹೊಸ ಸಿಬ್ಬಂದಿ ಫೋಟೋ ತೆಗೆಯಿರಿ',
  'staffPhoto.intro': 'ನಿಮಗೆ ಲಾಗಿನ್ ಕೋಡ್ ಕೊಡುವವರು ಇದು ನೀವೇ ಎಂದು ನೋಡಲು, ಲೈವ್ ಕ್ಯಾಮೆರಾ ಸೆಲ್ಫಿ. ಇದು ಲಾಗಿನ್ ಕೋಡ್ ವಿನಂತಿಗಳು, ಸಿಬ್ಬಂದಿ ಪಟ್ಟಿಗಳು ಮತ್ತು ನಿಮ್ಮ ಪ್ರೊಫೈಲ್‌ನಲ್ಲಿ ಕಾಣುತ್ತದೆ.',
  'staffPhoto.retakeIntro': 'CEO ಅವರು ನಿಮ್ಮ ಹೊಸ ಫೋಟೋ ಕೇಳಿದ್ದಾರೆ. ಮುಂದುವರಿಯಲು ಈಗ ತೆಗೆಯಿರಿ.',
  'staffPhoto.tips': 'ಮುಖ ಅಂಡಾಕಾರದೊಳಗೆ ಇರಲಿ, ಒಳ್ಳೆಯ ಬೆಳಕು, ಟೋಪಿ ಅಥವಾ ಕಪ್ಪು ಕನ್ನಡಕ ಬೇಡ.',
  'staffPhoto.noCamera': 'ಈ ಸಾಧನದಲ್ಲಿ ಕ್ಯಾಮೆರಾ ಇಲ್ಲವೇ? ಕ್ಯಾಮೆರಾ ಇರುವ ಫೋನ್ ಅಥವಾ ಕಂಪ್ಯೂಟರ್‌ನಿಂದ ಒಮ್ಮೆ ಸೈನ್ ಇನ್ ಮಾಡಿ ಅಲ್ಲಿ ತೆಗೆಯಿರಿ.',
  'staffPhoto.take': 'ಫೋಟೋ ತೆಗೆಯಿರಿ',
  'staffPhoto.saving': 'ನಿಮ್ಮ ಫೋಟೋ ಉಳಿಸಲಾಗುತ್ತಿದೆ…',
  'staffPhoto.signOut': 'ಸೈನ್ ಔಟ್',
  'staffPhoto.inviteStep': 'ಮೊದಲು, ನಿಮ್ಮ ಫೋಟೋ',
  'staffPhoto.inviteDone': 'ಫೋಟೋ ಉಳಿಸಲಾಗಿದೆ. ಈಗ ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ಆಯ್ಕೆಮಾಡಿ.',
};

export const staffPhotoHi: Record<StaffPhotoKey, string> = {
  'staffPhoto.inviteLater': 'इस डिवाइस में कैमरा नहीं है? पहली बार साइन इन करते समय लें',
  'staffPhoto.title': 'अपनी स्टाफ़ फ़ोटो लें',
  'staffPhoto.retakeTitle': 'नई स्टाफ़ फ़ोटो लें',
  'staffPhoto.intro': 'लाइव कैमरा से एक सेल्फ़ी, ताकि जो आपको लॉगिन कोड दे वह देख सके कि यह आप ही हैं। यह लॉगिन कोड के अनुरोधों, स्टाफ़ सूचियों और आपकी प्रोफ़ाइल पर दिखती है।',
  'staffPhoto.retakeIntro': 'CEO ने आपकी नई फ़ोटो माँगी है। आगे बढ़ने के लिए अभी लें।',
  'staffPhoto.tips': 'चेहरा अंडाकार के अंदर रखें, अच्छी रोशनी में, टोपी या काला चश्मा नहीं।',
  'staffPhoto.noCamera': 'इस डिवाइस में कैमरा नहीं है? कैमरे वाले फ़ोन या कंप्यूटर से एक बार साइन इन करें और वहाँ फ़ोटो लें।',
  'staffPhoto.take': 'फ़ोटो लें',
  'staffPhoto.saving': 'आपकी फ़ोटो सेव हो रही है…',
  'staffPhoto.signOut': 'साइन आउट',
  'staffPhoto.inviteStep': 'पहले, आपकी फ़ोटो',
  'staffPhoto.inviteDone': 'फ़ोटो सेव हो गई। अब अपना पासवर्ड चुनें।',
};
