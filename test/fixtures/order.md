---
slug: order
tags: [entity, commerce, core]
relationships:
  depends-on: customer
  contains: [line-item, shipping-info]
  see-also: domain-driven-design
---

# Order

An Order represents a customer's intent to purchase.

## Attributes
- lineItems: [[line-item]][] (at least one required)
- customer: [[dep::customer]] reference

## Rules
- Total equals sum of [[dep::line-item#pricing]] values
- Must have valid [[shipping-info]]
