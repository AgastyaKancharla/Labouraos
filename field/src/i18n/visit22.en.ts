/**
 * Laboura Field shop visit simplified (Master Guide rev 207 and 208, owner's
 * field test, 22 Nov): area names for GPS fixes, "Use where I am", one row
 * per business, the status chip in the header, closing a revisit, the
 * Businesses list. Spread into en.ts (English only).
 */
export const visit22En = {
  'place.accuracy': '±{meters} m',
  'place.finding': 'finding the area…',
  'place.offline': 'area shown when online',
  'addr.useWhereIAm': 'Use where I am',
  'addr.finding': 'Getting your location…',
  'addr.filled': 'Filled from where you are: {fields}. Add the shop number, floor or street and correct anything that is wrong.',
  'addr.pinOnly': 'Pin set where you are. The map has no address for this spot: type the address below.',
  'addr.offline': 'Pin set where you are. The address fills in when you have signal; you can also type it below.',
  'addr.checkMap': 'Is the pin on the shop? Check the map and the address.',
  'addr.orType': 'Or type the address / paste a Google Maps link',
  'addr.locality': 'locality',
} as const;
