import { config } from './config.js';

const ENDPOINT = 'https://api.openjev.sh/v1/systemone';

const questions = {
  action: {
    type: 'choice',
    instructions:
      'A buyback-and-burn furnace holds `furnace.budget_eth` of creator fees whose only job is to buy its own token and burn it, steadily. Holding the budget earns nothing. Looking at `market`, should it buy right now, or is this one of the rare moments to hold off?',
    criteria: {
      buy_now: 'The default. Price is flat, calm, cooling off or dipping, or trading is quiet: a steady buyback is exactly what the furnace is for. Especially right when sellers are active or the furnace has been idle a few minutes.',
      wait: 'Only when price is spiking hard right now on other buyers and sits at its recent high, so a buy would chase the pump.',
    },
  },
  size: {
    type: 'score',
    instructions: 'If the bot buys now, how much of `furnace.budget_eth` does this moment deserve, judging by `market`?',
    criteria: [
      'A nibble: conditions are only mildly favourable',
      'A standard buy: a fair, ordinary moment',
      'A heavy buy: a clear dip with strong sell pressure to absorb',
    ],
  },
  sell_pressure: {
    type: 'noul',
    instructions: 'Are sellers dominating buyers in `market.last_15m`?',
    criteria: { true: 'Sell volume clearly exceeds buy volume', false: 'Buyers lead, or the flow is balanced or empty' },
  },
  chasing: {
    type: 'noul',
    instructions: 'Would buying now be chasing a pump, given `market.price_change_15m_pct` and `market.vs_2h_high_pct`?',
    criteria: { true: 'Price has run up sharply and sits at or near its recent high', false: 'Price is flat, down, or well below its recent high' },
  },
};

export async function askJev(state) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.jevKey}` },
    body: JSON.stringify({ model: 'openjev', state, questions }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`jev ${res.status}`);
  const { answers } = await res.json();
  return {
    choice: answers.action.choice,
    confidence: answers.action.confidence,
    probabilities: answers.action.probabilities,
    size: answers.size.score,
    sizeConfidence: answers.size.confidence,
    sellPressure: answers.sell_pressure.noul,
    chasing: answers.chasing.noul,
  };
}
