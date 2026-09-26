import { config } from './config.js';

const ENDPOINT = 'https://api.openjev.sh/v1/systemone';

const questions = {
  action: {
    type: 'choice',
    instructions:
      'A buyback bot holds `furnace.budget_eth` to buy its own token and burn it. Looking at `market`, should it buy right now or wait for a better entry?',
    criteria: {
      buy_now: 'Price is dipping or sellers are active, so a buy absorbs sells and gets more tokens per ETH. Also right when the market is calm and the bot has been idle a long time.',
      wait: 'Price is spiking on other buyers and a buy would chase the pump, or the bot bought very recently and nothing has changed since.',
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
