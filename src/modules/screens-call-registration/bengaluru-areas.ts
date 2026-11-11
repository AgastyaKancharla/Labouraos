/**
 * Bengaluru areas offered on the registration forms (guide, Forms: "Areas:
 * picked from a list of Bengaluru areas that the CEO and Managers manage in
 * the Command Center").
 *
 * The Command Center screen that manages this list (C-Pricing-Areas) has no
 * table behind it yet, so this is the starting list. Each area carries a
 * typical pincode and the centre point the map pin starts from; the agent
 * can change both. Replace this constant with the managed list when it
 * exists — the endpoint's answer keeps the same shape.
 */
export interface BengaluruArea {
  name: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

export const BENGALURU_AREAS: readonly BengaluruArea[] = [
  { name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
  { name: 'Banashankari', pincode: '560070', latitude: 12.9255, longitude: 77.5468 },
  { name: 'Banaswadi', pincode: '560043', latitude: 13.0104, longitude: 77.6482 },
  { name: 'Basavanagudi', pincode: '560004', latitude: 12.9406, longitude: 77.5738 },
  { name: 'Bellandur', pincode: '560103', latitude: 12.9257, longitude: 77.6762 },
  { name: 'Bommanahalli', pincode: '560068', latitude: 12.9030, longitude: 77.6243 },
  { name: 'Domlur', pincode: '560071', latitude: 12.9610, longitude: 77.6387 },
  { name: 'Electronic City', pincode: '560100', latitude: 12.8452, longitude: 77.6602 },
  { name: 'Frazer Town', pincode: '560005', latitude: 12.9970, longitude: 77.6150 },
  { name: 'Gandhinagar (Majestic)', pincode: '560009', latitude: 12.9767, longitude: 77.5713 },
  { name: 'Hebbal', pincode: '560024', latitude: 13.0358, longitude: 77.5970 },
  { name: 'Hennur', pincode: '560043', latitude: 13.0358, longitude: 77.6380 },
  { name: 'HSR Layout', pincode: '560102', latitude: 12.9116, longitude: 77.6389 },
  { name: 'Indiranagar', pincode: '560038', latitude: 12.9784, longitude: 77.6408 },
  { name: 'Jalahalli', pincode: '560013', latitude: 13.0465, longitude: 77.5486 },
  { name: 'Jayanagar', pincode: '560041', latitude: 12.9250, longitude: 77.5938 },
  { name: 'JP Nagar', pincode: '560078', latitude: 12.9063, longitude: 77.5857 },
  { name: 'Kengeri', pincode: '560060', latitude: 12.9081, longitude: 77.4853 },
  { name: 'Koramangala', pincode: '560034', latitude: 12.9352, longitude: 77.6245 },
  { name: 'KR Puram', pincode: '560036', latitude: 13.0074, longitude: 77.6950 },
  { name: 'Kumaraswamy Layout', pincode: '560078', latitude: 12.9081, longitude: 77.5553 },
  { name: 'Madiwala', pincode: '560068', latitude: 12.9226, longitude: 77.6174 },
  { name: 'Mahadevapura', pincode: '560048', latitude: 12.9916, longitude: 77.7062 },
  { name: 'Malleshwaram', pincode: '560003', latitude: 13.0035, longitude: 77.5647 },
  { name: 'Marathahalli', pincode: '560037', latitude: 12.9569, longitude: 77.7011 },
  { name: 'Nagarbhavi', pincode: '560072', latitude: 12.9600, longitude: 77.5100 },
  { name: 'Peenya', pincode: '560058', latitude: 13.0329, longitude: 77.5273 },
  { name: 'Rajajinagar', pincode: '560010', latitude: 12.9915, longitude: 77.5545 },
  { name: 'RT Nagar', pincode: '560032', latitude: 13.0219, longitude: 77.5946 },
  { name: 'Sarjapur Road', pincode: '560035', latitude: 12.9010, longitude: 77.6860 },
  { name: 'Shivajinagar', pincode: '560051', latitude: 12.9857, longitude: 77.6057 },
  { name: 'Ulsoor', pincode: '560008', latitude: 12.9817, longitude: 77.6286 },
  { name: 'Uttarahalli', pincode: '560061', latitude: 12.9055, longitude: 77.5422 },
  { name: 'Vijayanagar', pincode: '560040', latitude: 12.9719, longitude: 77.5376 },
  { name: 'Whitefield', pincode: '560066', latitude: 12.9698, longitude: 77.7500 },
  { name: 'Wilson Garden', pincode: '560027', latitude: 12.9490, longitude: 77.5968 },
  { name: 'Yelahanka', pincode: '560064', latitude: 13.1007, longitude: 77.5963 },
  { name: 'Yeshwanthpur', pincode: '560022', latitude: 13.0285, longitude: 77.5409 },
];

/** Bengaluru pincodes run from 560001 to 560300 (India Post). */
export function cityForPincode(pincode: string): string | null {
  if (!/^\d{6}$/.test(pincode)) return null;
  const n = Number(pincode);
  return n >= 560001 && n <= 560300 ? 'Bengaluru' : null;
}
