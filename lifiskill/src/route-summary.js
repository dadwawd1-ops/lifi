import {
  formatQuotePreview,
  summarizeQuote,
} from '../../lifi-feature/src/route-preview.js'

export { summarizeQuote }

export function formatQuoteSummary(summary) {
  return formatQuotePreview(summary)
}
