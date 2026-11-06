export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapBusinessPoint {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  verificationStatus: string | null;
  accountAgentName: string | null;
}

export interface MapVacancyPoint {
  id: string;
  code: string;
  latitude: number;
  longitude: number;
  roleTitle: string | null;
  trade: string;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
}

export interface MapCandidateCell {
  latitude: number;
  longitude: number;
  count: number;
  trades: string[];
}

export interface MapPoints {
  businesses: MapBusinessPoint[];
  vacancies: MapVacancyPoint[];
  candidateCells: MapCandidateCell[];
}
