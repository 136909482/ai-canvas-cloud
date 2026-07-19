import type { GenerateTask } from '@/types'

export type TaskQueueFilter = 'all' | 'active' | 'finished'

export function filterTaskQueueTasks(tasks: GenerateTask[], filter: TaskQueueFilter) {
  if (filter === 'all') {
    return tasks
  }

  const active = filter === 'active'
  return tasks.filter((task) => (task.status === 'queued' || task.status === 'running') === active)
}
