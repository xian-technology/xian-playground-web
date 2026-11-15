/** Starter contracts offered in the Examples menu. */

import { DEFAULT_CONTRACT, DEFAULT_CONTRACT_NAME } from "@/lib/workspace/model";

export interface Example {
  id: string;
  title: string;
  description: string;
  contractName: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "token",
    title: "Demo token",
    description: "Balances, transfers and a constructor.",
    contractName: DEFAULT_CONTRACT_NAME,
    code: DEFAULT_CONTRACT,
  },
  {
    id: "counter",
    title: "Counter",
    description: "A Variable, an owner check and an event.",
    contractName: "con_counter",
    code: `count = Variable()
owner = Variable()

Incremented = LogEvent(
    "Incremented",
    {"by": {"type": str, "idx": True}, "value": {"type": int}},
)


@construct
def seed(start: int = 0):
    count.set(start)
    owner.set(ctx.caller)


@export
def increment(step: int = 1):
    assert step > 0, 'Step must be positive.'
    count.set(count.get() + step)
    Incremented({"by": ctx.caller, "value": count.get()})
    return count.get()


@export
def reset():
    assert ctx.caller == owner.get(), 'Only the owner can reset.'
    count.set(0)
`,
  },
  {
    id: "decimals",
    title: "Exact decimals",
    description: "Decimal math, timestamps and dict storage.",
    contractName: "con_savings",
    code: `deposits = Hash(default_value=None)
rate = Variable()


@construct
def seed():
    rate.set(decimal('0.05'))


@export
def deposit(amount: decimal, note: str = ''):
    assert amount > 0, 'Deposit must be positive.'
    deposits[ctx.caller] = {
        'amount': amount,
        'note': note,
        'at': now,
    }


@export
def projected(account: str, years: int):
    entry = deposits[account]
    assert entry is not None, 'No deposit for this account.'
    value = entry['amount']
    for year in range(years):
        value = value * (1 + rate.get())
    return value
`,
  },
];
