// Features: database row shapes for the reference tables

export type StationRow = {
  code: string;
  name: string;
  name_hi: string | null;
  lat: number | null;
  lon: number | null;
  zone: string | null;
};

export type TrainRow = {
  number: string;
  name: string;
  origin: string;
  destination: string;
  runs_on: number | null;
  top_speed_kmh: number | null;
};

export type TimetableStopRow = {
  train_number: string;
  seq: number;
  station_code: string;
  sched_arr: number | null;
  sched_dep: number | null;
  km: number;
};
