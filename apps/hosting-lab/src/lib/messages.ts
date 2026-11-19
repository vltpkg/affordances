// the sentences an agent repeats to the user after a call, as v0's actions and the runtime's handlers both say them
export const messages = {
  cancelled: () => 'The project renews as Hobby at the end of the month',
  deployed: ({ output }: { output: unknown }) => {
    const d = output as { id: string; status: string }
    return `Deployment ${d.id} is ${d.status}`
  },
  rolledBack: ({ output }: { output: unknown }) =>
    `${(output as { current: string }).current} is published again`,
}
