import type { DashboardMetrics, DemoSnapshot } from './types';
import { isBeforeToday, isWithinNextDays } from './date-label';

/**
 * Pure derivations shared by the live repository and the dashboard API.
 * Extracted from the removed in-memory store so that deleting
 * fixture data could not take working code with it.
 */

export function enrichSnapshot(store: DemoSnapshot): DemoSnapshot {
  const copy = JSON.parse(JSON.stringify(store)) as DemoSnapshot;
  copy.engagements = copy.engagements.map((engagement) => ({
    ...engagement,
    taskIds: copy.tasks.filter((task) => task.engagementId === engagement.id).map((task) => task.id),
  }));
  copy.staff = copy.staff.map((member) => {
    const owned = copy.tasks.filter((task) => task.assignedTo === member.id);
    return {
      ...member,
      assignedTasks: owned.length,
      completedTasks: owned.filter((task) => task.status === 'Completed').length,
      overdueTasks: owned.filter((task) => task.status !== 'Completed' && isBeforeToday(task.dueDate)).length,
      activeEngagements: copy.engagements.filter((engagement) => engagement.status !== 'Completed' && (engagement.managerId === member.id || engagement.teamIds.includes(member.id))).length,
    };
  });
  return copy;
}

export function getMetrics(store: DemoSnapshot): DashboardMetrics {
  return {
    activeClients: store.clients.filter((client) => client.status === 'Active').length,
    activeEngagements: store.engagements.filter((engagement) => engagement.status !== 'Completed').length,
    pendingTasks: store.tasks.filter((task) => task.status !== 'Completed').length,
    overdueTasks: store.tasks.filter((task) => task.status !== 'Completed' && isBeforeToday(task.dueDate)).length,
    upcomingDeadlines: store.engagements.filter((engagement) => engagement.status !== 'Completed' && isWithinNextDays(engagement.deadline, 14)).length,
    pendingReviews: store.engagements.filter((engagement) => engagement.status === 'Under Review' || store.tasks.some((task) => task.engagementId === engagement.id && task.status === 'Under Review')).length,
  };
}
