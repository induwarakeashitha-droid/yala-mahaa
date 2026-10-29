// Canal problem reports (API/routes/reportroutes.js). Photos are shrunk on the phone before
// upload; the API checks and re-encodes them again, so this is about saving mobile data.
import { authed, authedBlob } from './auth.js';

export const MAX_PHOTOS = 3;
const MAX_SIDE = 1600;
const MAX_PICK_BYTES = 25 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 90000;

// The database status -> the label key the portal shows
export const REPORT_STATUS = {
  new: 'received',
  forwarded: 'forwarded',
  in_progress: 'inProgress',
  resolved: 'fixed',
  rejected: 'reportClosed',
};

// A picked file -> a JPEG File at most 1600 px on its longest side.
// Throws 'photoNotImage' / 'photoNotSupported' (i18n keys) for files that can't be used.
export async function shrinkPhoto(file) {
  if (!file.type.startsWith('image/') || file.size > MAX_PICK_BYTES) throw new Error('photoNotImage');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // e.g. HEIC photos in browsers that can't read them
    throw new Error('photoNotSupported');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('photoNotSupported');
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

// report: { issueType, canal: { id } | { name }, description, location: { lat, lng } | null, photos: File[] }
export async function submitReport({ issueType, canal, description, location, photos }) {
  const form = new FormData();
  form.append('issue_type', issueType);
  if (canal.id != null) form.append('schedule_id', String(canal.id));
  else form.append('canal_name', canal.name);
  if (description) form.append('description', description);
  if (location?.lat != null) {
    form.append('latitude', String(location.lat));
    form.append('longitude', String(location.lng));
  }
  photos.forEach((photo) => form.append('photos', photo, 'photo.jpg'));
  const res = await authed('/api/reports', { method: 'POST', body: form, timeout: UPLOAD_TIMEOUT_MS });
  return res.data;
}

export async function fetchMyReports() {
  const res = await authed('/api/reports');
  return res.data;
}

// Photos need the sign-in token, so they are fetched and shown as object URLs
export async function fetchReportPhoto(reportId, photoId) {
  return URL.createObjectURL(await authedBlob(`/api/reports/${reportId}/photos/${photoId}`));
}
