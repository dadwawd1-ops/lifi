import { LiFiClient } from './lifi-client.js'
import {
  formatQuotePreview,
  summarizeQuote,
} from '../../lifi-feature/src/route-preview.js'

export class LiFiQuoteTool {
  constructor(options = {}) {
    this.client = options.client ?? new LiFiClient(options.clientOptions ?? {})
  }

  async run(input) {
    const quote = await this.client.getQuote(input)
    const summary = summarizeQuote(quote)
    return {
      quote,
      summary,
      text: formatQuotePreview(summary),
    }
  }
}

export class LiFiStatusTool {
  constructor(options = {}) {
    this.client = options.client ?? new LiFiClient(options.clientOptions ?? {})
  }

  async run(input) {
    return this.client.getStatus(input)
  }
}

export class LiFiExecuteTool {
  constructor(options = {}) {
    this.client = options.client ?? new LiFiClient(options.clientOptions ?? {})
  }

  async run(input) {
    if (!input?.quote) {
      throw new Error('LiFiExecuteTool requires `quote` in input')
    }

    // This is intentionally minimal for Week 2.
    // Wallet signing / broadcasting is expected to be handled by an executor service.
    if (typeof this.client.executeRoute === 'function') {
      return this.client.executeRoute(input)
    }

    if (typeof this.client.execute === 'function') {
      return this.client.execute(input)
    }

    throw new Error('No execute capability on LI.FI client')
  }
}
