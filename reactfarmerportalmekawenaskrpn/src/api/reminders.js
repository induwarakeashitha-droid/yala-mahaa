// SMS reminders the day before a canal's water issue starts (API/routes/reminderroutes.js).
import { authed } from './auth.js';
import { useApiData } from './reservoirs.js';

export const fetchReminders = () => authed('/api/reminders').then((res) => res.data);

export function useReminders(farmId) {
  return useApiData(farmId ? `reminders:${farmId}` : null, fetchReminders);
}

export const addReminder = (scheduleId) => authed('/api/reminders', { method: 'POST', body: { schedule_id: scheduleId } });
export const removeReminder = (scheduleId) => authed(`/api/reminders/${scheduleId}`, { method: 'DELETE' });
