// Fixed lists and text for the app. Live data (tanks, forecasts, river gauges, water issue
// schedule, rain) comes from the API and Open-Meteo: see src/api/.

// General flood safety steps shown with a river gauge warning.
export const FLOOD_STEPS = [
  'Move cattle and water pumps to higher ground',
  'Do not cross low causeways after rain',
  'Keep your phone charged — warnings come by SMS',
  'Store seed paddy and fertiliser off the floor',
  'If water enters your house, go to the nearest school or temple shelter',
];

export const CROP_CATALOG = {
  paddy: {
    label: 'Paddy (Rice)', color: '#6E8F3A',
    types: {
      'White Rice (BG)': ['BG 352 (3.5 months)', 'BG 300 (3 months)', 'BG 359 (3.5 months)', 'BG 366 (3.5 months)'],
      'Red Rice (AT)': ['AT 362 (3.5 months)', 'AT 307 (3 months)', 'AT 373 (3.5 months)'],
      Samba: ['Keeri Samba', 'Suwandel', 'BG 358 Samba'],
    },
  },
  vegetables: {
    label: 'Vegetables', color: '#E08A1E',
    types: {
      Tomato: ['Thilina', 'KWR', 'Padmini'],
      'Green Chilli': ['MI-2', 'MI Hot', 'KA-2'],
      Brinjal: ['Lena Iri', 'Padagoda', 'Thinnaveli Purple'],
      Okra: ['MI-5', 'Haritha'],
    },
  },
  fruit: {
    label: 'Fruit', color: '#D93B2B',
    types: {
      Banana: ['Ambul', 'Kolikuttu', 'Cavendish'],
      Papaya: ['Red Lady', 'Rathna'],
      Mango: ['TJC', 'Karthakolomban', 'Villard'],
    },
  },
  ofc: {
    label: 'Other Field Crops', short: 'OFC', color: '#C8A227',
    types: {
      Maize: ['Pacific 999', 'Pacific 984', 'Ruwan'],
      'Mung bean': ['MI 6', 'Ari'],
      Cowpea: ['Bombay', 'Waruni'],
    },
  },
  mixed: {
    label: 'Mixed Farming', short: 'Mixed', color: '#2F6FE0',
    types: { 'Mixed plot': ['Home garden mix', 'Vegetable + fruit'] },
  },
};

export const YIELD_UNITS = [
  { id: 'kg', label: 'kg / acre' },
  { id: 'bu', label: 'bushels / ac' },
  { id: 't', label: 'tons / acre' },
];

export const ISSUE_TYPES = [
  { id: 'blockage', key: 'blockage', icon: 'blockage' },
  { id: 'leak', key: 'leak', icon: 'leak' },
  { id: 'gate', key: 'gate', icon: 'gate' },
  { id: 'other', key: 'other', icon: 'dots' },
];

// Real photos (Wikimedia Commons, credits in public/photos/CREDITS.md).
const photo = (f) => `${import.meta.env.BASE_URL}photos/${f}`;
export const PHOTOS = {
  paddy: photo('paddy.jpg'),
  farmers: photo('farmers.jpg'),
  tank: photo('tank.jpg'),
  canal: photo('canal.jpg'),
  flood: photo('flood.jpg'),
  harvest: photo('harvest.jpg'),
};

// Where a farmer's field gets its water (registration step 2c).
export const WATER_SOURCES = [
  { id: 'tank', key: 'wsTank', icon: 'tank', ask: 'tank' },
  { id: 'canal', key: 'wsCanal', icon: 'drop', ask: 'canal' },
  { id: 'river', key: 'wsRiver', icon: 'leak', ask: 'river' },
  { id: 'well', key: 'wsWell', icon: 'target' },
  { id: 'rain', key: 'wsRain', icon: 'rain' },
];


// Google map defaults (Mahaweli B). Tanks with lat/lon appear on the map and are used for "nearest tank".
export const MAP_CENTER = { lat: 7.364212, lng: 81.02131 };

export const DISTRICTS = [
  'Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna',
  'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala',
  'Mullaitivu', 'Nuwara Eliya', 'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya',
];
