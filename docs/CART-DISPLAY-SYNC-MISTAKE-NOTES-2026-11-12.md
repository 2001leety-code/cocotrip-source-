# Cart display and synchronization regression, 2026-11-12

## Confirmed problem

The isolated Preview displayed a USD250 tour and a KRW124800 charter in the same cart review, but showed Total USD250.00. The cart actually retained both items. A separately stale header/panel initially showed one item until navigation.

- CharterNewPage omitted priceUSD when adding a charter.
- CartCheckout treated missing USD as zero and presented a partial USD sum as Total.
- Each useCart instance had independent guest state with no same-tab or storage-event subscription.

No cart PayPal order was created in the failing Preview reproduction. This does not establish an actual undercharge.

## Scoped correction

- New charter cart entries carry USD from the existing charterUsdFromKrw pricing policy.
- A shared display helper also handles existing KRW-only cart entries. It rounds each line using that policy and adds integer cents. Missing/invalid line prices yield the existing Shown at payment label, never a partial total.
- Guest storage changes notify all mounted cart hooks; native storage events synchronize other tabs. Listener cleanup and storage-area/key filtering are tested.
- Review lines stay tied to submitted items while an order is being created or paid. A prior server total is not shown beside a changed cart after an SDK error or during retry.

No server amount calculation, exchange rate, capture, authorization, recovery, external notification or deployment setting was changed.

## Regression evidence

New component regression reproduced four failures before the fix. Focused tests cover USD342 from USD250 + USD92, legacy entries, incomplete prices, same-tab count/remove/clear, another-tab changes, submitted-item pinning, error/retry display, listener cleanup, sessionStorage exclusion and remount persistence. Price tests compare the same fixture with the existing backend pure resolver and per-line rounding policy.

Actual local Chrome inspection used the real cart components with synthetic data and an explicitly offline harness. API, Firebase, PayPal and external access were blocked. Desktop and 390px mobile showed Cart2, both prices and Total USD342.00. Cross-tab changes, removal, clear and reload were exercised. This is local UI evidence, not Sandbox payment evidence.

## Separate limitations

- A newly published isolated Preview is needed for changed-code PayPal Sandbox checkout. Local tests do not replace provider capture and booking verification.
- Real signed-in account transition was not tested in this change.
- Pre-existing completion behavior clears the full guest cart, including items another tab may add after order submission. This patch preserves that behavior and does not claim to fix it.
- QR amount discrepancy and all other prior report findings remain untouched.