export interface Activity {
  id: number;
  label: string;
  startedAt: number;
}
let sequence = 0;
let activities: readonly Activity[] = [];
const listeners = new Set<() => void>();
export function getActivities() {
  return activities;
}
export function subscribeActivities(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function beginActivity(label: string) {
  const id = ++sequence;
  activities = [...activities, { id, label, startedAt: Date.now() }];
  listeners.forEach((listener) => listener());
  return () => {
    if (!activities.some((activity) => activity.id === id)) return;
    activities = activities.filter((activity) => activity.id !== id);
    listeners.forEach((listener) => listener());
  };
}
