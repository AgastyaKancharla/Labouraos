/**
 * Attendance start (Master Guide rev 206, decided 22 Nov): the day opens at
 * sign-in in Start of day; Active is the name shown for Available and
 * After-call work for after-call notes. Spread into en.ts (English only).
 */
export const attendanceStart22En = {
  'status.start_of_day': 'Start of day',
  'day.startOfDayTitle': 'Start of day · since {time}',
  'day.startOfDayBody': 'Your day started when you signed in. Pick your status to start work. Start of day does not count as production.',
  'day.startWork': 'Start work — Active',
  'day.signInStarts': 'Your day starts when you sign in. Sign out and sign in again to start it.',
  'day.signInAgain': 'Sign in again',
  'day.saveLocation': 'Save my location',
  'day.savingLocation': 'Getting location…',
  'day.locationNeeded': 'Your location for today is not saved yet. It is saved once a day, when your day starts.',
  'today.statusSignIn': 'Now: Start of day (since you signed in). Pick a status to start work.',
} as const;
