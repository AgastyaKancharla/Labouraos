/* App sign-ups in the office (customer app proposal 4.4): the new screens'
   titles and nav label, and the "Registered in the app" label on job seekers,
   businesses and referral partners. Kannada and Hindi need a native speaker's review. */

export const appSignupsEn = {
  'nav.appSignups': 'App sign-ups',
  'screen.C-AppSignups': 'App sign-ups',
  'screen.MG-AppSignups': 'App sign-ups',
  'screen.T-AppSignups': 'App sign-ups',
  'appSignup.registeredInApp': 'Registered in the app',
  'appSignup.usesApp': 'Uses the app',
  'appSignup.pushOn': 'notifications on',
} as const;

export const appSignupsKn: Record<keyof typeof appSignupsEn, string> = {
  'nav.appSignups': 'ಆ್ಯಪ್ ನೋಂದಣಿಗಳು',
  'screen.C-AppSignups': 'ಆ್ಯಪ್ ನೋಂದಣಿಗಳು',
  'screen.MG-AppSignups': 'ಆ್ಯಪ್ ನೋಂದಣಿಗಳು',
  'screen.T-AppSignups': 'ಆ್ಯಪ್ ನೋಂದಣಿಗಳು',
  'appSignup.registeredInApp': 'ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಂದಾಯಿಸಿದ್ದಾರೆ',
  'appSignup.usesApp': 'ಆ್ಯಪ್ ಬಳಸುತ್ತಾರೆ',
  'appSignup.pushOn': 'ಅಧಿಸೂಚನೆಗಳು ಆನ್',
};

export const appSignupsHi: Record<keyof typeof appSignupsEn, string> = {
  'nav.appSignups': 'ऐप साइन-अप',
  'screen.C-AppSignups': 'ऐप साइन-अप',
  'screen.MG-AppSignups': 'ऐप साइन-अप',
  'screen.T-AppSignups': 'ऐप साइन-अप',
  'appSignup.registeredInApp': 'ऐप में रजिस्टर किया',
  'appSignup.usesApp': 'ऐप इस्तेमाल करते हैं',
  'appSignup.pushOn': 'सूचनाएँ चालू',
};
