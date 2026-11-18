// the summary the person approves, in the one element a browser agent reads it from: the runtime's text, verbatim
export const ConfirmationSummary = ({ summary }: { summary: string }) => (
  <p data-confirmation-summary className="rounded-md border p-4">
    {summary}
  </p>
)
