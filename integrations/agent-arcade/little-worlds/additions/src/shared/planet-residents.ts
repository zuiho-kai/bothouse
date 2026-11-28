export const residentActivities = ['idle','thinking','working','talking','waiting','offline','unknown'] as const;
export const residentBodyLooks = ['orange','dragon','whale','rainbow','grok','lanxi'] as const;
export interface PlanetResident {
  id: string;
  displayName: string;
  appearanceKey: string;
  activity: typeof residentActivities[number];
}
