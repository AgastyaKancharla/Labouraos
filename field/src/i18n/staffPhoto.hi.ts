import type { staffPhotoEn } from './staffPhoto.en';

/** Hindi for the staff photo. Draft: a native speaker checks it (marked in the PR). */
export const staffPhotoHi: Record<keyof typeof staffPhotoEn, string> = {
  'staffPhoto.title': 'आपकी स्टाफ़ फ़ोटो',
  'staffPhoto.missing': 'लाइव सेल्फ़ी लें, ताकि जो आपको लॉगिन कोड दे वह देख सके कि यह आप ही हैं। यह लॉगिन कोड के अनुरोधों, स्टाफ़ सूचियों और आपकी प्रोफ़ाइल पर दिखती है।',
  'staffPhoto.retake': 'CEO ने आपकी नई फ़ोटो माँगी है। आगे बढ़ने के लिए अभी लें।',
  'staffPhoto.open': 'कैमरा खोलें',
  'staffPhoto.saving': 'आपकी फ़ोटो सेव हो रही है…',
  'staffPhoto.failed': 'फ़ोटो सेव नहीं हो सकी। अपना सिग्नल जाँचें और फिर से कोशिश करें।',
  'staffPhoto.signOut': 'साइन आउट',
};
