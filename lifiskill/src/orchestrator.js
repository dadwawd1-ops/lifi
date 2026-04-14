export async function runBatch(tasks, runtime) {
  if (!Array.isArray(tasks)) {
    throw new Error('runBatch expects an array of tasks')
  }
  if (!runtime || typeof runtime.run !== 'function') {
    throw new Error('runBatch expects a runtime with a run(task) function')
  }

  const results = []

  for (const task of tasks) {
    console.log('🚀 Running task:', task?.type ?? task?.skillId ?? 'unknown')
    const res = await runtime.run(task)
    results.push(res)
  }

  return results
}
