import { formatDate, titleCase } from '../utils/format'

// Crop categories as the farmer app names them (reactfarmerportalmekawenaskrpn/src/data.js)
export const CROP_CATEGORY_LABELS = {
  paddy: 'Paddy (rice)',
  vegetables: 'Vegetables',
  fruit: 'Fruit',
  ofc: 'Other field crops',
  mixed: 'Mixed farming',
  not_given: 'Not given',
}

// Older registrations saved the category ("paddy") as the crop name; show it by its proper name
export const cropName = (value) => (value ? CROP_CATEGORY_LABELS[value] || value : '—')

const CROP_COLORS = ['#2563eb', '#0d9488', '#d97706', '#4f46e5', '#7c3aed', '#db2777', '#a1a1aa']

export const WATER_SOURCE_LABELS = {
  tank: 'Tank or reservoir',
  canal: 'Canal',
  river: 'River or stream',
  well: 'Well',
  rain: 'Rain only',
  unknown: 'Not given',
}

// "94771234567" -> "+94 77 123 4567"
export const formatPhone = (phone = '') => {
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length !== 11 || !digits.startsWith('94')) return phone
  return `+94 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
}

// for csv: local 070 763 7312 form. a leading + makes excel treat it as a formula,
// and the spaces stop it turning into a number that drops the 0
export const csvPhone = (phone = '') => {
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length !== 11 || !digits.startsWith('94')) return phone || ''
  return `0${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
}

// A row from GET /admin/farmers (or /admin/farmers/:id)
export function farmerFromApi(row) {
  return {
    ...row,
    id: row.farmer_id,
    name: row.full_name,
    district: titleCase(row.district || ''),
    division: row.division || '',
    // The linked reservoir or Mahaweli tank, else the source the farmer named (canal, river, well)
    scheme: row.reservoir_name || row.tank_name || row.water_name || WATER_SOURCE_LABELS[row.water_source] || '—',
    crop: cropName(row.primary_crop),
    landAcres: row.land_acres === null ? null : Number(row.land_acres),
    phoneLabel: formatPhone(row.phone),
    status: row.is_active ? 'Active' : 'Inactive',
    joinedLabel: formatDate(row.created_at),
  }
}

const monthLabel = (month) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })

// GET /admin/data/farmer-stats
export function buildFarmerStats(stats) {
  if (!stats) {
    return {
      FARMER_SUMMARY: { registered: 0, active: 0, newThisMonth: 0, newLastMonth: 0, districts: 0, totalAcres: 0 },
      DISTRICT_FARMERS: [],
      FARMER_REGISTRATION_TREND: [],
      FARMER_CROP_DISTRIBUTION: [],
      FARMER_WATER_SOURCES: [],
    }
  }
  const cropTotal = stats.crops.reduce((total, crop) => total + crop.farmers, 0)
  const topCrops = stats.crops.slice(0, CROP_COLORS.length - 1)
  const otherCrops = stats.crops.slice(CROP_COLORS.length - 1).reduce((total, crop) => total + crop.farmers, 0)

  return {
    FARMER_SUMMARY: {
      registered: stats.registered,
      active: stats.active,
      newThisMonth: stats.new_this_month,
      newLastMonth: stats.new_last_month,
      districts: stats.districts,
      totalAcres: Number(stats.total_acres),
    },
    DISTRICT_FARMERS: stats.byDistrict,
    FARMER_REGISTRATION_TREND: stats.byMonth.map((row) => ({
      month: monthLabel(row.month),
      farmers: row.farmers,
      active: row.active,
    })),
    // value: the crop's share of all farmer-crop pairs (sizes the donut slices); farmers: how many grow it
    FARMER_CROP_DISTRIBUTION: [
      ...topCrops.map((crop, index) => ({ name: cropName(crop.crop), farmers: crop.farmers, color: CROP_COLORS[index] })),
      ...(otherCrops ? [{ name: 'Other', farmers: otherCrops, color: CROP_COLORS.at(-1) }] : []),
    ].map((crop) => ({ ...crop, value: cropTotal ? Math.round((crop.farmers / cropTotal) * 100) : 0 })),
    FARMER_WATER_SOURCES: stats.waterSources.map((row) => ({
      ...row,
      label: WATER_SOURCE_LABELS[row.source] || row.source,
    })),
  }
}
